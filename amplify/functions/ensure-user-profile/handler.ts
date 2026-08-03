import { Logger } from '@aws-lambda-powertools/logger'
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Schema } from '../../data/resource'
import { amplifyItem, ddb, isConditionalCheckFailed, tableName } from '../shared/ddb'
import { callerFrom } from '../shared/identity'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger()

type Result = Schema['ensureUserProfile']['returnType']

const MAX_DISPLAY_NAME = 40
const MIN_DISPLAY_NAME = 2

/**
 * Creates the caller's UserProfile if it does not exist, keyed on the verified
 * Cognito sub.
 *
 * The profile id IS `event.identity.sub`. There is no argument that could
 * point this at another user's row.
 *
 * Idempotent by design: it is called on every sign-in, and the create is
 * guarded by attribute_not_exists so a concurrent double-call cannot produce
 * two rows or clobber an existing display name.
 */
export const handler: Schema['ensureUserProfile']['functionHandler'] = async (event) => {
  const caller = callerFrom(event.identity)
  if (!caller) return fail(CODE.UNAUTHENTICATED) as Result

  logger.appendKeys({ userSub: caller.sub })

  const PROFILE_TABLE = tableName('USER_PROFILE_TABLE_NAME')
  const now = new Date().toISOString()

  const requested = event.arguments.displayName?.replace(/\s+/g, ' ').trim() ?? ''
  const language = event.arguments.preferredLanguage === 'EN' ? 'EN' : 'HI'

  // Fall back to the local part of the username rather than exposing an email
  // address as a public display name.
  const fallback = caller.username.includes('@')
    ? (caller.username.split('@')[0] ?? 'सदस्य')
    : caller.username
  const displayName =
    requested.length >= MIN_DISPLAY_NAME
      ? requested.slice(0, MAX_DISPLAY_NAME)
      : fallback.slice(0, MAX_DISPLAY_NAME)

  try {
    await ddb.send(
      new PutCommand({
        TableName: PROFILE_TABLE,
        Item: amplifyItem(
          'UserProfile',
          {
            id: caller.sub,
            displayName,
            preferredLanguage: language,
            isStaffAuthor: false,
            isSuspended: false,
            commentCount: 0,
            questionCount: 0,
          },
          now,
        ),
        ConditionExpression: 'attribute_not_exists(#id)',
        ExpressionAttributeNames: { '#id': 'id' },
      }),
    )

    logger.info('profile created')
    return ok({}) as Result
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      logger.error('profile create failed', { error: error as Error })
      throw error
    }
  }

  // The profile already exists. Only apply an explicitly requested rename —
  // never overwrite a chosen display name with the username fallback.
  if (requested.length >= MIN_DISPLAY_NAME) {
    await ddb.send(
      new UpdateCommand({
        TableName: PROFILE_TABLE,
        Key: { id: caller.sub },
        UpdateExpression: 'SET displayName = :name, preferredLanguage = :lang, updatedAt = :now',
        ConditionExpression: 'attribute_exists(#id)',
        ExpressionAttributeNames: { '#id': 'id' },
        ExpressionAttributeValues: {
          ':name': requested.slice(0, MAX_DISPLAY_NAME),
          ':lang': language,
          ':now': now,
        },
      }),
    )
    logger.info('profile updated')
  }

  return ok({}) as Result
}
