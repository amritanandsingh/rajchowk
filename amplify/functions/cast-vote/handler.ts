import { Logger } from '@aws-lambda-powertools/logger'
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { Schema } from '../../data/resource'
import { writeAudit } from '../shared/audit'
import {
  amplifyItem,
  cancelledAt,
  ddb,
  isTransactionCancelled,
  tableName,
} from '../shared/ddb'
import { hashIp } from '../shared/hash'
import { callerFrom } from '../shared/identity'
import { enforceRateLimit, RATE_LIMITS } from '../shared/rate-limit'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger()

type Result = Schema['castVote']['returnType']

/**
 * TransactWriteItems positions. `CancellationReasons` is POSITIONAL, so these
 * indices are what let us tell "already voted" from "poll closed".
 */
const ITEM_VOTE = 0
const ITEM_OPTION = 1
const ITEM_POLL = 2

const MAX_EXPLANATION = 1000

export const handler: Schema['castVote']['functionHandler'] = async (event) => {
  const { pollId, pollOptionId } = event.arguments
  const explanation = event.arguments.explanation?.trim().slice(0, MAX_EXPLANATION) || undefined

  // ---- 1. Identity comes ONLY from the verified Cognito token. -------------
  // Note there is no userSub argument on this mutation. There is nothing for a
  // caller to forge.
  const caller = callerFrom(event.identity)
  if (!caller) {
    logger.warn('castVote called without a Cognito identity')
    return fail(CODE.UNAUTHENTICATED) as Result
  }

  logger.appendKeys({ pollId, userSub: caller.sub, correlationId: `${pollId}#${caller.sub}` })

  // ---- 2. Rate limit before spending anything billable. -------------------
  const limit = await enforceRateLimit(RATE_LIMITS.vote(`u_${caller.sub}`))
  if (!limit.allowed) {
    logger.warn('rate limited', { retryAfter: limit.retryAfterSeconds, scope: limit.scope })
    return fail(CODE.RATE_LIMITED) as Result
  }

  const POLL_TABLE = tableName('POLL_TABLE_NAME')
  const OPTION_TABLE = tableName('POLL_OPTION_TABLE_NAME')
  const VOTE_TABLE = tableName('VOTE_TABLE_NAME')

  // ---- 3. Validate the poll is open and the option belongs to THIS poll. --
  const [pollResult, optionResult] = await Promise.all([
    ddb.send(
      new GetCommand({
        TableName: POLL_TABLE,
        Key: { id: pollId },
        ProjectionExpression:
          '#status, opensAt, closesAt, allowVoteChange, maxVoteChanges, totalVotes',
        ExpressionAttributeNames: { '#status': 'status' },
      }),
    ),
    ddb.send(
      new GetCommand({
        TableName: OPTION_TABLE,
        Key: { id: pollOptionId },
        ProjectionExpression: 'pollId',
      }),
    ),
  ])

  const poll = pollResult.Item
  const option = optionResult.Item
  const now = new Date().toISOString()

  if (!poll) return fail(CODE.NOT_FOUND) as Result
  if (poll.status !== 'OPEN') return fail(CODE.POLL_CLOSED) as Result
  if (typeof poll.opensAt === 'string' && poll.opensAt > now)
    return fail(CODE.POLL_CLOSED) as Result
  if (typeof poll.closesAt === 'string' && poll.closesAt <= now) {
    return fail(CODE.POLL_CLOSED) as Result
  }

  // Cross-poll option injection: without this check a caller could add a vote
  // to an option belonging to a different, still-open poll.
  if (!option || option.pollId !== pollId) {
    logger.warn('option does not belong to poll', { pollOptionId, actualPollId: option?.pollId })
    return fail(CODE.INVALID_OPTION) as Result
  }

  const voteId = `${pollId}#${caller.sub}`
  const ipSalt = process.env.RATE_LIMIT_IP_SALT
  const ipHash = caller.sourceIp && ipSalt ? hashIp(caller.sourceIp, ipSalt) : undefined

  // ---- 4. The vote transaction. -------------------------------------------
  try {
    await ddb.send(
      new TransactWriteCommand({
            // NO ClientRequestToken here, deliberately.
            //
            // A deterministic token plus a non-deterministic item is a bug:
            // the items embed `now`, so a genuine client retry inside
            // DynamoDB's 10-minute window reuses the token with DIFFERENT
            // parameters and the call fails with
            // IdempotentParameterMismatch — an unhandled 500 exactly when the
            // reader is retrying on a flaky connection.
            //
            // It bought nothing either: the conditional write below already
            // gives exact-once semantics. A duplicate attempt fails
            // attribute_not_exists(id), which the catch block turns into the
            // idempotent-replay path. Found by tests/integration/vote.test.ts.
        TransactItems: [
          {
            Put: {
              TableName: VOTE_TABLE,
              // amplifyItem adds __typename/createdAt/updatedAt. Without
              // __typename this row is invisible to every GraphQL read.
              Item: amplifyItem(
                'Vote',
                {
                  id: voteId,
                  pollId,
                  pollOptionId,
                  userSub: caller.sub,
                  explanation,
                  castAt: now,
                  changeCount: 0,
                  ipHash,
                },
                now,
              ),
              // THE one-vote-per-user guarantee. The id is deterministic, so
              // this is genuine mutual exclusion — not the no-op that
              // attribute_not_exists on a random UUID would be.
              ConditionExpression: 'attribute_not_exists(#id)',
              ExpressionAttributeNames: { '#id': 'id' },
            },
          },
          {
            Update: {
              TableName: OPTION_TABLE,
              Key: { id: pollOptionId },
              // `ADD` fails outright on a NULL attribute, which is exactly what
              // a freshly created option has. if_not_exists is the safe form.
              UpdateExpression:
                'SET voteCount = if_not_exists(voteCount, :zero) + :one, updatedAt = :now',
              ConditionExpression: 'attribute_exists(id) AND pollId = :pollId',
              ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':now': now, ':pollId': pollId },
            },
          },
          {
            Update: {
              TableName: POLL_TABLE,
              Key: { id: pollId },
              UpdateExpression:
                'SET totalVotes = if_not_exists(totalVotes, :zero) + :one, updatedAt = :now',
              // Re-checks openness ATOMICALLY with the write, closing the gap
              // between the GetItem above and the commit.
              ConditionExpression:
                '#status = :open AND (attribute_not_exists(closesAt) OR closesAt > :now)',
              ExpressionAttributeNames: { '#status': 'status' },
              ExpressionAttributeValues: {
                ':zero': 0,
                ':one': 1,
                ':now': now,
                ':open': 'OPEN',
              },
            },
          },
        ],
      }),
    )

    logger.info('vote cast', { pollOptionId })
    return ok({
      pollId,
      pollOptionId,
      totalVotes: Number(poll.totalVotes ?? 0) + 1,
      changed: false,
    }) as Result
  } catch (error) {
    if (!isTransactionCancelled(error)) {
      logger.error('vote transaction failed', { error: error as Error })
      throw error
    }

    if (cancelledAt(error, ITEM_POLL)) return fail(CODE.POLL_CLOSED) as Result
    if (cancelledAt(error, ITEM_OPTION)) return fail(CODE.INVALID_OPTION) as Result
    if (!cancelledAt(error, ITEM_VOTE)) {
      logger.error('unexpected transaction cancellation', { error: error as Error })
      return fail(CODE.CONFLICT) as Result
    }

    // ---- 5. A vote already exists: idempotent replay, or a change. --------
    return handleExistingVote({
      voteId,
      pollId,
      pollOptionId,
      explanation,
      caller,
      poll,
      now,
      ipHash,
      tables: { VOTE_TABLE, OPTION_TABLE },
    })
  }
}

type ExistingVoteArgs = {
  voteId: string
  pollId: string
  pollOptionId: string
  explanation: string | undefined
  caller: NonNullable<ReturnType<typeof callerFrom>>
  poll: Record<string, unknown>
  now: string
  ipHash: string | undefined
  tables: { VOTE_TABLE: string; OPTION_TABLE: string }
}

async function handleExistingVote(args: ExistingVoteArgs): Promise<Result> {
  const { voteId, pollId, pollOptionId, caller, poll, now, ipHash, tables } = args

  const existing = (
    await ddb.send(
      new GetCommand({
        TableName: tables.VOTE_TABLE,
        Key: { id: voteId },
        ProjectionExpression: 'pollOptionId, changeCount',
      }),
    )
  ).Item

  if (!existing) return fail(CODE.CONFLICT) as Result

  const previousOptionId = String(existing.pollOptionId)
  const totalVotes = Number(poll.totalVotes ?? 0)

  // Same option: a retry. Report success and touch no counter.
  if (previousOptionId === pollOptionId) {
    logger.info('idempotent replay of an identical vote')
    return ok({ pollId, pollOptionId, totalVotes, changed: false }) as Result
  }

  if (poll.allowVoteChange !== true) return fail(CODE.ALREADY_VOTED) as Result

  const maxChanges = Number(poll.maxVoteChanges ?? 1)

  try {
    await ddb.send(
      new TransactWriteCommand({
        // See the note on the first-vote transaction: no ClientRequestToken,
        // because the items carry `now` and the conditional guards below
        // already make this exactly-once.
        TransactItems: [
          {
            Update: {
              TableName: tables.VOTE_TABLE,
              Key: { id: voteId },
              UpdateExpression:
                'SET pollOptionId = :next, updatedAt = :now, castAt = :now, ' +
                'changeCount = if_not_exists(changeCount, :zero) + :one' +
                (args.explanation === undefined ? '' : ', explanation = :explanation'),
              // Guards against a concurrent change AND caps flip-flop abuse.
              ConditionExpression:
                'pollOptionId = :previous AND ' +
                '(attribute_not_exists(changeCount) OR changeCount < :maxChanges)',
              ExpressionAttributeValues: {
                ':next': pollOptionId,
                ':previous': previousOptionId,
                ':now': now,
                ':zero': 0,
                ':one': 1,
                ':maxChanges': maxChanges,
                ...(args.explanation === undefined ? {} : { ':explanation': args.explanation }),
              },
            },
          },
          {
            Update: {
              TableName: tables.OPTION_TABLE,
              Key: { id: previousOptionId },
              UpdateExpression:
                'SET voteCount = if_not_exists(voteCount, :zero) - :one, updatedAt = :now',
              // A counter can never go negative.
              ConditionExpression: 'attribute_exists(id) AND voteCount > :zero',
              ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':now': now },
            },
          },
          {
            Update: {
              TableName: tables.OPTION_TABLE,
              Key: { id: pollOptionId },
              UpdateExpression:
                'SET voteCount = if_not_exists(voteCount, :zero) + :one, updatedAt = :now',
              ConditionExpression: 'attribute_exists(id) AND pollId = :pollId',
              ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':now': now, ':pollId': pollId },
            },
          },
        ],
        // NOTE: Poll.totalVotes is deliberately NOT touched here. The number of
        // voters has not changed, only their distribution. Incrementing it on a
        // change is the classic way these counters drift.
      }),
    )
  } catch (error) {
    if (isTransactionCancelled(error)) {
      if (cancelledAt(error, 0)) return fail(CODE.CHANGE_LIMIT) as Result
      if (cancelledAt(error, 1)) return fail(CODE.CONFLICT) as Result
      if (cancelledAt(error, 2)) return fail(CODE.INVALID_OPTION) as Result
    }
    logger.error('vote change failed', { error: error as Error })
    throw error
  }

  // Audit CHANGES only. A first vote is already recorded by the Vote row
  // itself; auditing every cast would multiply write cost for no extra signal.
  await writeAudit({
    action: 'VOTE_CHANGE',
    caller,
    targetType: 'POLL',
    targetId: pollId,
    before: { pollOptionId: previousOptionId },
    after: { pollOptionId },
    ...(ipHash === undefined ? {} : { ipHash }),
  })

  logger.info('vote changed', { from: previousOptionId, to: pollOptionId })
  return ok({ pollId, pollOptionId, totalVotes, changed: true }) as Result
}
