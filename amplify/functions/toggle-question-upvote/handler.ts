import { Logger } from '@aws-lambda-powertools/logger'
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { Schema } from '../../data/resource'
import { amplifyItem, cancelledAt, ddb, isTransactionCancelled, tableName } from '../shared/ddb'
import { hashIp } from '../shared/hash'
import { callerFrom } from '../shared/identity'
import { enforceRateLimit, RATE_LIMITS } from '../shared/rate-limit'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger()

type Result = Schema['toggleQuestionUpvote']['returnType']

const ITEM_UPVOTE = 0
const ITEM_QUESTION = 1

/**
 * The mutation takes a desired STATE (`upvoted: true | false`), not a toggle.
 *
 * A blind toggle is not idempotent: a double-tap on a flaky mobile connection,
 * or an automatic client retry, silently inverts the result and there is no
 * way to tell a retry from a genuine second tap. With a desired state, retries
 * converge on the same answer.
 */
export const handler: Schema['toggleQuestionUpvote']['functionHandler'] = async (event) => {
  const { questionId, upvoted } = event.arguments

  const caller = callerFrom(event.identity)
  if (!caller) return fail(CODE.UNAUTHENTICATED) as Result

  logger.appendKeys({ questionId, userSub: caller.sub })

  const limit = await enforceRateLimit(RATE_LIMITS.upvote(`u_${caller.sub}`))
  if (!limit.allowed) return fail(CODE.RATE_LIMITED) as Result

  const QUESTION_TABLE = tableName('AUDIENCE_QUESTION_TABLE_NAME')
  const UPVOTE_TABLE = tableName('QUESTION_UPVOTE_TABLE_NAME')

  const question = (
    await ddb.send(
      new GetCommand({
        TableName: QUESTION_TABLE,
        Key: { id: questionId },
        ProjectionExpression: '#status, upvoteCount',
        ExpressionAttributeNames: { '#status': 'status' },
      }),
    )
  ).Item

  if (!question) return fail(CODE.NOT_FOUND) as Result

  // Upvoting a PENDING_REVIEW question would confirm that it exists before a
  // moderator has seen it — an information leak, not just a UX wrinkle.
  const openForUpvotes =
    question.status === 'APPROVED' ||
    question.status === 'ANSWERED' ||
    question.status === 'PLANNED'
  if (!openForUpvotes) return fail(CODE.NOT_AVAILABLE) as Result

  const upvoteId = `${questionId}#${caller.sub}`
  const now = new Date().toISOString()
  const ipSalt = process.env.RATE_LIMIT_IP_SALT
  const ipHash = caller.sourceIp && ipSalt ? hashIp(caller.sourceIp, ipSalt) : undefined
  const currentCount = Number(question.upvoteCount ?? 0)

  const items = upvoted
    ? [
        {
          Put: {
            TableName: UPVOTE_TABLE,
            Item: amplifyItem(
              'QuestionUpvote',
              { id: upvoteId, questionId, userSub: caller.sub, votedAt: now, ipHash },
              now,
            ),
            ConditionExpression: 'attribute_not_exists(#id)',
            ExpressionAttributeNames: { '#id': 'id' },
          },
        },
        {
          Update: {
            TableName: QUESTION_TABLE,
            Key: { id: questionId },
            UpdateExpression:
              'SET upvoteCount = if_not_exists(upvoteCount, :zero) + :one, updatedAt = :now',
            ConditionExpression: '#status IN (:approved, :answered, :planned)',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':zero': 0,
              ':one': 1,
              ':now': now,
              ':approved': 'APPROVED',
              ':answered': 'ANSWERED',
              ':planned': 'PLANNED',
            },
          },
        },
      ]
    : [
        {
          Delete: {
            TableName: UPVOTE_TABLE,
            Key: { id: upvoteId },
            ConditionExpression: 'attribute_exists(#id)',
            ExpressionAttributeNames: { '#id': 'id' },
          },
        },
        {
          Update: {
            TableName: QUESTION_TABLE,
            Key: { id: questionId },
            UpdateExpression:
              'SET upvoteCount = if_not_exists(upvoteCount, :zero) - :one, updatedAt = :now',
            ConditionExpression: 'attribute_exists(id) AND upvoteCount > :zero',
            ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':now': now },
          },
        },
      ]

  try {
    await ddb.send(
      new TransactWriteCommand({
        // No ClientRequestToken: the items embed `now`, so reusing a
        // deterministic token on a retry would fail with
        // IdempotentParameterMismatch. The conditional guards on item 0 are
        // what make this idempotent — see cast-vote for the full note.
        TransactItems: items,
      }),
    )

    const nextCount = Math.max(0, currentCount + (upvoted ? 1 : -1))
    logger.info('upvote applied', { upvoted, upvoteCount: nextCount })
    return ok({ questionId, upvoted, upvoteCount: nextCount }) as Result
  } catch (error) {
    if (!isTransactionCancelled(error)) {
      logger.error('upvote transaction failed', { error: error as Error })
      throw error
    }

    // Item 0 failing means the row already existed (when adding) or was
    // already gone (when removing). Either way the DESIRED STATE ALREADY
    // HOLDS — report success and leave the counter alone. This is precisely
    // what makes the operation idempotent under retry.
    if (cancelledAt(error, ITEM_UPVOTE)) {
      logger.info('already in the desired state', { upvoted })
      return ok({ questionId, upvoted, upvoteCount: currentCount }) as Result
    }

    if (cancelledAt(error, ITEM_QUESTION)) return fail(CODE.NOT_AVAILABLE) as Result

    logger.error('unexpected upvote cancellation', { error: error as Error })
    return fail(CODE.CONFLICT) as Result
  }
}
