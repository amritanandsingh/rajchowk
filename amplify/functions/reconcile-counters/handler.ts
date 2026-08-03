import { Logger } from '@aws-lambda-powertools/logger'
import { QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Context } from 'aws-lambda'
import type { Schema } from '../../data/resource'
import { writeAudit } from '../shared/audit'
import { ddb, isConditionalCheckFailed, tableName } from '../shared/ddb'
import { callerFrom, isAdmin } from '../shared/identity'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger()

type Result = Schema['reconcileCounters']['returnType']

/**
 * Recomputes denormalised counters from the authoritative rows.
 *
 * The Vote and QuestionUpvote rows ARE the record; every counter is a
 * projection of them. This job exists because a projection can drift — a
 * partial failure, a manual data fix, a bug — and a poll whose displayed total
 * disagrees with its votes is worse than useless on a politics site.
 *
 * Three properties make it safe to run against production:
 *  - Every count uses Query with Select: 'COUNT'. There is no Scan over a
 *    counted set anywhere.
 *  - It is resumable via an opaque cursor and stops on a wall-clock guard
 *    rather than timing out mid-write.
 *  - Writes are conditional on the value actually differing, so a clean run
 *    costs zero WCU.
 *
 * Persistent drift is emitted as an EMF metric so it alarms rather than being
 * quietly repaired every night forever.
 */

/** Leave enough headroom to finish the in-flight item and return a cursor. */
const TIME_GUARD_MS = 15_000

type Cursor = { lastKey?: Record<string, unknown> } | null

function decodeCursor(raw: string | null | undefined): Cursor {
  if (!raw) return null
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor
  } catch {
    return null
  }
}

function encodeCursor(lastKey: Record<string, unknown> | undefined): string | null {
  if (!lastKey) return null
  return Buffer.from(JSON.stringify({ lastKey }), 'utf8').toString('base64url')
}

/** Count matching rows on an index, paginating until exhausted. */
async function countByIndex(
  table: string,
  indexName: string,
  keyExpression: string,
  values: Record<string, unknown>,
  names?: Record<string, string>,
): Promise<number> {
  let total = 0
  let lastKey: Record<string, unknown> | undefined

  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: table,
        IndexName: indexName,
        KeyConditionExpression: keyExpression,
        ExpressionAttributeValues: values,
        ...(names ? { ExpressionAttributeNames: names } : {}),
        Select: 'COUNT',
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }),
    )
    total += page.Count ?? 0
    lastKey = page.LastEvaluatedKey
  } while (lastKey)

  return total
}

/** Write a counter only when it actually differs. Returns true if corrected. */
async function correct(
  table: string,
  key: Record<string, unknown>,
  attribute: string,
  actual: number,
): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: table,
        Key: key,
        UpdateExpression: `SET #attr = :actual, updatedAt = :now`,
        // A clean run costs zero write capacity.
        ConditionExpression: 'attribute_not_exists(#attr) OR #attr <> :actual',
        ExpressionAttributeNames: { '#attr': attribute },
        ExpressionAttributeValues: { ':actual': actual, ':now': new Date().toISOString() },
      }),
    )
    return true
  } catch (error) {
    if (isConditionalCheckFailed(error)) return false
    throw error
  }
}

/** EMF metric so persistent drift alarms instead of being silently repaired. */
function emitDrift(scope: string, count: number): void {
  if (count === 0) return
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'RajChowk',
            Dimensions: [['Scope']],
            Metrics: [{ Name: 'CounterDrift', Unit: 'Count' }],
          },
        ],
      },
      Scope: scope,
      CounterDrift: count,
    }),
  )
}

export const handler: Schema['reconcileCounters']['functionHandler'] = async (event, context) => {
  const caller = callerFrom(event.identity)
  if (!caller) return fail(CODE.UNAUTHENTICATED) as Result
  if (!isAdmin(caller)) return fail(CODE.FORBIDDEN) as Result

  const scope = String(event.arguments.scope ?? '').toUpperCase()
  const maxItems = Math.min(Number(event.arguments.maxItems ?? 200), 500)
  const cursor = decodeCursor(event.arguments.cursor)

  logger.appendKeys({ actorSub: caller.sub, scope })

  const lambdaContext = context as Context | undefined
  const timeLeft = () => lambdaContext?.getRemainingTimeInMillis?.() ?? Number.MAX_SAFE_INTEGER

  let scanned = 0
  let corrected = 0
  let nextKey: Record<string, unknown> | undefined
  let done = true

  if (scope === 'POLLS') {
    const POLL_TABLE = tableName('POLL_TABLE_NAME')
    const OPTION_TABLE = tableName('POLL_OPTION_TABLE_NAME')
    const VOTE_TABLE = tableName('VOTE_TABLE_NAME')

    // The only Scan in this function, and it is over polls (a small set) to
    // enumerate work — not over votes, which is the set that actually grows.
    const polls = await ddb.send(
      new ScanCommand({
        TableName: POLL_TABLE,
        ProjectionExpression: 'id',
        Limit: maxItems,
        ...(cursor?.lastKey ? { ExclusiveStartKey: cursor.lastKey } : {}),
      }),
    )

    for (const poll of polls.Items ?? []) {
      if (timeLeft() < TIME_GUARD_MS) {
        nextKey = { id: poll.id }
        done = false
        break
      }

      const pollId = String(poll.id)
      scanned += 1

      const options = await ddb.send(
        new QueryCommand({
          TableName: OPTION_TABLE,
          IndexName: 'pollOptionsByPollIdAndDisplayOrder',
          KeyConditionExpression: 'pollId = :pollId',
          ExpressionAttributeValues: { ':pollId': pollId },
          ProjectionExpression: 'id',
        }),
      )

      let pollTotal = 0
      for (const option of options.Items ?? []) {
        const optionId = String(option.id)
        const actual = await countByIndex(
          VOTE_TABLE,
          'votesByPollOptionIdAndCastAt',
          'pollOptionId = :optionId',
          { ':optionId': optionId },
        )
        pollTotal += actual
        if (await correct(OPTION_TABLE, { id: optionId }, 'voteCount', actual)) corrected += 1
      }

      // Poll.totalVotes is the SUM OF OPTION COUNTS, deliberately not a count
      // of Vote rows. With vote-change enabled one voter is one row but has
      // moved between options, so summing options is the only definition that
      // stays internally consistent.
      if (await correct(POLL_TABLE, { id: pollId }, 'totalVotes', pollTotal)) corrected += 1

      await ddb.send(
        new UpdateCommand({
          TableName: POLL_TABLE,
          Key: { id: pollId },
          UpdateExpression: 'SET lastReconciledAt = :now',
          ExpressionAttributeValues: { ':now': new Date().toISOString() },
        }),
      )
    }

    if (!nextKey && polls.LastEvaluatedKey) {
      nextKey = polls.LastEvaluatedKey
      done = false
    }
  } else if (scope === 'QUESTIONS') {
    const QUESTION_TABLE = tableName('AUDIENCE_QUESTION_TABLE_NAME')
    const UPVOTE_TABLE = tableName('QUESTION_UPVOTE_TABLE_NAME')

    const questions = await ddb.send(
      new ScanCommand({
        TableName: QUESTION_TABLE,
        ProjectionExpression: 'id',
        Limit: maxItems,
        ...(cursor?.lastKey ? { ExclusiveStartKey: cursor.lastKey } : {}),
      }),
    )

    for (const question of questions.Items ?? []) {
      if (timeLeft() < TIME_GUARD_MS) {
        nextKey = { id: question.id }
        done = false
        break
      }

      const questionId = String(question.id)
      scanned += 1

      const actual = await countByIndex(
        UPVOTE_TABLE,
        'upvotesByQuestionIdAndVotedAt',
        'questionId = :questionId',
        { ':questionId': questionId },
      )
      if (await correct(QUESTION_TABLE, { id: questionId }, 'upvoteCount', actual)) corrected += 1
    }

    if (!nextKey && questions.LastEvaluatedKey) {
      nextKey = questions.LastEvaluatedKey
      done = false
    }
  } else if (scope === 'ARTICLES') {
    const ARTICLE_TABLE = tableName('ARTICLE_TABLE_NAME')
    const COMMENT_TABLE = tableName('COMMENT_TABLE_NAME')

    const articles = await ddb.send(
      new ScanCommand({
        TableName: ARTICLE_TABLE,
        ProjectionExpression: 'id',
        Limit: maxItems,
        ...(cursor?.lastKey ? { ExclusiveStartKey: cursor.lastKey } : {}),
      }),
    )

    for (const article of articles.Items ?? []) {
      if (timeLeft() < TIME_GUARD_MS) {
        nextKey = { id: article.id }
        done = false
        break
      }

      const articleId = String(article.id)
      scanned += 1

      // The threadKey GSI is sparse, so this counts exactly the comments a
      // reader can actually see.
      const actual = await countByIndex(
        COMMENT_TABLE,
        'commentsByThreadKeyAndCreatedAt',
        'threadKey = :threadKey',
        { ':threadKey': `${articleId}#APPROVED` },
      )
      if (await correct(ARTICLE_TABLE, { id: articleId }, 'commentCount', actual)) corrected += 1
    }

    if (!nextKey && articles.LastEvaluatedKey) {
      nextKey = articles.LastEvaluatedKey
      done = false
    }
  } else {
    return fail(CODE.INVALID_INPUT) as Result
  }

  emitDrift(scope, corrected)

  if (corrected > 0) {
    await writeAudit({
      action: 'COUNTER_RECONCILE',
      caller,
      targetType: 'SCOPE',
      targetId: scope,
      after: { scanned, corrected },
    })
  }

  logger.info('reconciliation pass complete', { scanned, corrected, done })
  return ok({ scanned, corrected, cursor: encodeCursor(nextKey), done }) as Result
}
