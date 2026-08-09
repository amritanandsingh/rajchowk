import { randomUUID } from 'node:crypto'
import { Logger } from '@aws-lambda-powertools/logger'
import { QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Schema } from '../../data/resource'
import { amplifyItem, cancelledAt, ddb, isTransactionCancelled, tableName } from '../shared/ddb'
import { hashIp } from '../shared/hash'
import { callerFrom } from '../shared/identity'
import { enforceRateLimit, RATE_LIMITS } from '../shared/rate-limit'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger()

type Result = Schema['submitReport']['returnType']

const TARGET_TYPES = new Set(['COMMENT', 'QUESTION', 'ARTICLE'])
const REASONS = new Set([
  'SPAM',
  'ABUSE',
  'HATE_SPEECH',
  'MISINFORMATION',
  'OFF_TOPIC',
  'PERSONAL_INFO',
  'IMPERSONATION',
  'COPYRIGHT',
  'OTHER',
])
const MAX_DETAILS = 1000

export const handler: Schema['submitReport']['functionHandler'] = async (event) => {
  const caller = callerFrom(event.identity)
  if (!caller) return fail(CODE.UNAUTHENTICATED) as Result

  const targetType = String(event.arguments.targetType ?? '')
  const targetId = String(event.arguments.targetId ?? '')
  const reason = String(event.arguments.reason ?? '')
  const details = event.arguments.details?.trim().slice(0, MAX_DETAILS) || undefined

  // Allow-list rather than pass-through: these become enum values on the row.
  if (!TARGET_TYPES.has(targetType) || !REASONS.has(reason) || !targetId) {
    return fail(CODE.INVALID_INPUT) as Result
  }

  logger.appendKeys({ userSub: caller.sub, targetType, targetId })

  const limit = await enforceRateLimit(RATE_LIMITS.report(`u_${caller.sub}`))
  if (!limit.allowed) return fail(CODE.RATE_LIMITED) as Result

  const REPORT_TABLE = tableName('CONTENT_REPORT_TABLE_NAME')
  const COMMENT_TABLE = tableName('COMMENT_TABLE_NAME')

  // One report per user per target. A second report from the same reader adds
  // no moderation signal and would inflate reportCount, which moderators sort by.
  const existing = await ddb.send(
    new QueryCommand({
      TableName: REPORT_TABLE,
      IndexName: 'reportsByTargetAndCreatedAt',
      KeyConditionExpression: 'targetId = :targetId',
      FilterExpression: 'reportedBySub = :sub',
      ExpressionAttributeValues: { ':targetId': targetId, ':sub': caller.sub },
      Limit: 50,
      Select: 'COUNT',
    }),
  )
  if ((existing.Count ?? 0) > 0) {
    // Report success: telling the reader their duplicate was rejected invites
    // them to retry, and the outcome they care about is already true.
    logger.info('duplicate report ignored')
    return ok({ id: null, status: 'OPEN' }) as Result
  }

  const ipSalt = process.env.RATE_LIMIT_IP_SALT
  const ipHash = caller.sourceIp && ipSalt ? hashIp(caller.sourceIp, ipSalt) : undefined
  const now = new Date().toISOString()
  const reportId = randomUUID()

  const reportItem = amplifyItem(
    'ContentReport',
    {
      id: reportId,
      targetType,
      targetId,
      reportedBySub: caller.sub,
      reason,
      details,
      status: 'OPEN',
      ipHash,
    },
    now,
  )

  if (targetType === 'COMMENT') {
    // Keep the comment's reportCount in step with the report rows atomically,
    // since moderators triage by that number.
    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: REPORT_TABLE,
                Item: reportItem,
                ConditionExpression: 'attribute_not_exists(#id)',
                ExpressionAttributeNames: { '#id': 'id' },
              },
            },
            {
              Update: {
                TableName: COMMENT_TABLE,
                Key: { id: targetId },
                UpdateExpression:
                  'SET reportCount = if_not_exists(reportCount, :zero) + :one, updatedAt = :now',
                ConditionExpression: 'attribute_exists(id)',
                ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':now': now },
              },
            },
          ],
        }),
      )
    } catch (error) {
      if (isTransactionCancelled(error) && cancelledAt(error, 1)) {
        return fail(CODE.NOT_FOUND) as Result
      }
      logger.error('report write failed', { error: error as Error })
      throw error
    }
  } else {
    await ddb.send(
      new UpdateCommand({
        TableName: REPORT_TABLE,
        Key: { id: reportId },
        UpdateExpression:
          'SET #tn = :tn, createdAt = :now, updatedAt = :now, targetType = :targetType, ' +
          'targetId = :targetId, reportedBySub = :sub, reason = :reason, #status = :status' +
          (details === undefined ? '' : ', details = :details') +
          (ipHash === undefined ? '' : ', ipHash = :ipHash'),
        ExpressionAttributeNames: { '#tn': '__typename', '#status': 'status' },
        ExpressionAttributeValues: {
          ':tn': 'ContentReport',
          ':now': now,
          ':targetType': targetType,
          ':targetId': targetId,
          ':sub': caller.sub,
          ':reason': reason,
          ':status': 'OPEN',
          ...(details === undefined ? {} : { ':details': details }),
          ...(ipHash === undefined ? {} : { ':ipHash': ipHash }),
        },
      }),
    )
  }

  logger.info('report recorded', { reportId })
  return ok({ id: reportId, status: 'OPEN' }) as Result
}
