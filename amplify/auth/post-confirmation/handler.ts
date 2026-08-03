import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import type { PostConfirmationTriggerHandler } from 'aws-lambda'

const client = new CognitoIdentityProviderClient()

/**
 * Read from process.env rather than the typed `$amplify/env/*` module.
 *
 * That module is code-generated into .amplify/generated/ by `ampx sandbox`, so
 * importing it makes `npm run typecheck` fail on a fresh clone until someone
 * has deployed. Every other function in this codebase reads process.env for
 * the same reason; `tableName()` in shared/ddb.ts does the same with a
 * fail-fast check.
 */
const DEFAULT_GROUP = process.env.DEFAULT_GROUP ?? 'MEMBER'

/**
 * Adds a newly confirmed user to the MEMBER group.
 *
 * The user pool id comes from `event.userPoolId`, which Cognito supplies in
 * the trigger payload — so this needs no environment wiring to the auth
 * resource and no cross-stack reference of any kind.
 *
 * Two rules this handler must never break:
 *  - It must be idempotent. Cognito retries triggers, and AdminAddUserToGroup
 *    is naturally idempotent, but any future addition here must be too.
 *  - It must never throw for a non-fatal reason. A thrown error fails the
 *    user's sign-up. A member who somehow lands outside the MEMBER group can
 *    be repaired; a user who cannot complete registration is lost.
 */
export const handler: PostConfirmationTriggerHandler = async (event) => {
  try {
    await client.send(
      new AdminAddUserToGroupCommand({
        GroupName: DEFAULT_GROUP,
        Username: event.userName,
        UserPoolId: event.userPoolId,
      }),
    )
  } catch (error) {
    // Swallowed on purpose — see the note above. The structured log is what
    // surfaces this, and the CloudWatch error alarm is what escalates it.
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'post-confirmation: failed to add user to default group',
        group: DEFAULT_GROUP,
        userPoolId: event.userPoolId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  return event
}
