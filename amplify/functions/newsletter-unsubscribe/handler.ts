import { Logger } from '@aws-lambda-powertools/logger'
import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Schema } from '../../data/resource'
import { ddb, isConditionalCheckFailed, tableName } from '../shared/ddb'
import { safeCompare, signUnsubscribe } from '../shared/hash'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger()

type Result = Schema['newsletterUnsubscribe']['returnType']

/**
 * One-click unsubscribe (RFC 8058).
 *
 * Verification is STATELESS: the signature is recomputed from the id and the
 * secret and compared in constant time, with no database read. That is what
 * makes the POST fast enough for Gmail's one-click requirement, and it means
 * an unsubscribe still works even if the read path is degraded.
 *
 * Unsubscribing must never fail loudly. A reader who wants out and is shown an
 * error will mark the message as spam instead, which costs sender reputation
 * far more than a silently-idempotent no-op.
 */
export const handler: Schema['newsletterUnsubscribe']['functionHandler'] = async (event) => {
  const id = String(event.arguments.id ?? '')
  const signature = String(event.arguments.signature ?? '')

  if (!id || !signature) return fail(CODE.INVALID_INPUT) as Result

  const secret = process.env.NEWSLETTER_TOKEN_SECRET
  if (!secret) {
    logger.error('NEWSLETTER_TOKEN_SECRET is not configured')
    return fail(CODE.INTERNAL) as Result
  }

  if (!safeCompare(signature, signUnsubscribe(id, secret))) {
    logger.warn('unsubscribe signature mismatch')
    return fail(CODE.INVALID_INPUT) as Result
  }

  logger.appendKeys({ subscriberId: id })

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName('NEWSLETTER_TABLE_NAME'),
        Key: { id },
        UpdateExpression:
          'SET #status = :unsubscribed, unsubscribedAt = :now, updatedAt = :now ' +
          'REMOVE tokenHash, tokenExpiresAt',
        // Do not resurrect a BOUNCED or COMPLAINED row into UNSUBSCRIBED — the
        // suppression reason matters for deliverability reporting.
        ConditionExpression: 'attribute_exists(id) AND #status IN (:pending, :confirmed)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':unsubscribed': 'UNSUBSCRIBED',
          ':pending': 'PENDING',
          ':confirmed': 'CONFIRMED',
          ':now': new Date().toISOString(),
        },
      }),
    )
    logger.info('unsubscribed')
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      // Already unsubscribed, or already suppressed. The reader's desired
      // outcome holds either way, so report success.
      logger.info('already unsubscribed or suppressed')
      return ok({}) as Result
    }
    logger.error('unsubscribe failed', { error: error as Error })
    return fail(CODE.INTERNAL) as Result
  }

  return ok({}) as Result
}
