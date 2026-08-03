import { randomUUID } from 'node:crypto'
import { Logger } from '@aws-lambda-powertools/logger'
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import type { Schema } from '../../data/resource'
import { amplifyItem, ddb, tableName } from '../shared/ddb'
import { hashIp } from '../shared/hash'
import { callerFrom } from '../shared/identity'
import { enforceRateLimit, RATE_LIMITS } from '../shared/rate-limit'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger()

type Result = Schema['submitQuestion']['returnType']

const MIN_LENGTH = 10
const MAX_LENGTH = 500
const MAX_CATEGORY = 64
const URL_PATTERN = /https?:\/\/\S+/gi

export const handler: Schema['submitQuestion']['functionHandler'] = async (event) => {
  const caller = callerFrom(event.identity)
  if (!caller) return fail(CODE.UNAUTHENTICATED) as Result

  const questionText = (event.arguments.questionText ?? '').replace(/\s+/g, ' ').trim()
  const category = event.arguments.category?.trim().slice(0, MAX_CATEGORY) || undefined
  const articleId = event.arguments.articleId ?? undefined
  const liveEventId = event.arguments.liveEventId ?? undefined

  logger.appendKeys({ userSub: caller.sub })

  if (questionText.length < MIN_LENGTH || questionText.length > MAX_LENGTH) {
    return fail(CODE.INVALID_INPUT) as Result
  }
  // A question is a question, not a link drop.
  if (URL_PATTERN.test(questionText)) return fail(CODE.INVALID_INPUT) as Result

  const limit = await enforceRateLimit(RATE_LIMITS.question(`u_${caller.sub}`))
  if (!limit.allowed) return fail(CODE.RATE_LIMITED) as Result

  const QUESTION_TABLE = tableName('AUDIENCE_QUESTION_TABLE_NAME')
  const PROFILE_TABLE = tableName('USER_PROFILE_TABLE_NAME')

  const profile = (
    await ddb.send(
      new GetCommand({
        TableName: PROFILE_TABLE,
        Key: { id: caller.sub },
        ProjectionExpression: 'displayName, preferredLanguage, isSuspended, suspendedUntil',
      }),
    )
  ).Item

  if (!profile) return fail(CODE.FORBIDDEN) as Result

  const now = new Date().toISOString()
  if (profile.isSuspended === true) {
    const until = typeof profile.suspendedUntil === 'string' ? profile.suspendedUntil : null
    if (!until || until > now) return fail(CODE.SUSPENDED) as Result
  }

  const ipSalt = process.env.RATE_LIMIT_IP_SALT
  const ipHash = caller.sourceIp && ipSalt ? hashIp(caller.sourceIp, ipSalt) : undefined
  const questionId = randomUUID()

  // No queueKey: the public resolver reads a sparse GSI on that attribute, so
  // a PENDING_REVIEW question is absent from the index entirely. Approval adds
  // the key; rejection never does.
  await ddb.send(
    new PutCommand({
      TableName: QUESTION_TABLE,
      Item: amplifyItem(
        'AudienceQuestion',
        {
          id: questionId,
          questionText,
          category,
          language: String(profile.preferredLanguage ?? 'HI'),
          articleId,
          liveEventId,
          askerProfileId: caller.sub,
          askerDisplayName: String(profile.displayName ?? 'सदस्य'),
          status: 'PENDING_REVIEW',
          upvoteCount: 0,
          ipHash,
        },
        now,
      ),
      ConditionExpression: 'attribute_not_exists(#id)',
      ExpressionAttributeNames: { '#id': 'id' },
    }),
  )

  logger.info('question queued for moderation', { questionId })
  return ok({ id: questionId, status: 'PENDING_REVIEW' }) as Result
}
