import { Logger } from '@aws-lambda-powertools/logger'
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Schema } from '../../data/resource'
import { ddb, isConditionalCheckFailed, tableName } from '../shared/ddb'
import { hashIp, safeCompare, sha256Hex } from '../shared/hash'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger()

type Result = Schema['newsletterVerify']['returnType']

/**
 * Confirms a subscription.
 *
 * Unlike subscribe, this one DOES distinguish success from failure: the reader
 * clicked a link and needs to know whether it worked. It still reveals nothing
 * about addresses, because the caller must already hold a token that was only
 * ever sent to the mailbox in question.
 *
 * The token is compared as a hash, in constant time, and is DESTROYED on
 * success so the link cannot be replayed.
 */
export const handler: Schema['newsletterVerify']['functionHandler'] = async (event) => {
  const id = String(event.arguments.id ?? '')
  const token = String(event.arguments.token ?? '')

  if (!id || !token) return fail(CODE.INVALID_INPUT) as Result

  logger.appendKeys({ subscriberId: id })

  const TABLE = tableName('NEWSLETTER_TABLE_NAME')
  const now = new Date().toISOString()

  const record = (
    await ddb.send(
      new GetCommand({
        TableName: TABLE,
        Key: { id },
        ProjectionExpression: '#status, tokenHash, tokenExpiresAt',
        ExpressionAttributeNames: { '#status': 'status' },
      }),
    )
  ).Item

  // A missing record and a wrong token are the same answer: the link is not
  // usable. Distinguishing them would leak whether an id exists.
  if (!record || typeof record.tokenHash !== 'string') {
    return fail(CODE.INVALID_INPUT) as Result
  }

  if (record.status === 'CONFIRMED') {
    // Clicking the link twice is normal (mail clients prefetch links). Report
    // success rather than an error the reader cannot act on.
    return ok({}) as Result
  }

  if (typeof record.tokenExpiresAt === 'string' && record.tokenExpiresAt <= now) {
    logger.info('verification token expired')
    return fail(CODE.INVALID_INPUT) as Result
  }

  if (!safeCompare(sha256Hex(token), record.tokenHash)) {
    logger.warn('verification token mismatch')
    return fail(CODE.INVALID_INPUT) as Result
  }

  const identity = event.identity as { sourceIp?: string[] } | undefined
  const sourceIp = identity?.sourceIp?.[0]
  const ipSalt = process.env.RATE_LIMIT_IP_SALT
  const consentIpHash = sourceIp && ipSalt ? hashIp(sourceIp, ipSalt) : undefined

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        // REMOVE destroys the token: a spent verification link is not replayable.
        UpdateExpression:
          'SET #status = :confirmed, verifiedAt = :now, consentAt = :now, updatedAt = :now' +
          (consentIpHash ? ', consentIpHash = :ipHash' : '') +
          ' REMOVE tokenHash, tokenExpiresAt',
        ConditionExpression: '#status = :pending',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':confirmed': 'CONFIRMED',
          ':pending': 'PENDING',
          ':now': now,
          ...(consentIpHash ? { ':ipHash': consentIpHash } : {}),
        },
      }),
    )
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      // Raced with another click of the same link.
      return ok({}) as Result
    }
    logger.error('verification failed', { error: error as Error })
    return fail(CODE.INTERNAL) as Result
  }

  logger.info('subscription confirmed')
  return ok({}) as Result
}
