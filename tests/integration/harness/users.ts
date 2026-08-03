import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { region, userPoolClientId, userPoolId } from './outputs'

/**
 * Test users and their ID tokens.
 *
 * THE KEY DESIGN DECISION IN THIS SUITE.
 *
 * `aws-amplify` keeps ONE module-scoped session per process, and vitest runs the
 * integration project with `fileParallelism: false`, so every test file shares
 * that process. Signing in and out around each test would therefore be slow,
 * race-prone, and would make the concurrent-voting test impossible to express
 * at all — you cannot have four users signed in at once through one singleton.
 *
 * Instead each role's ID token is minted ONCE here via AdminInitiateAuth, and
 * clients are built with an explicit `authToken` per request. No shared session,
 * no contention, and N concurrent voters is just N tokens.
 *
 * ID tokens last an hour by default, which comfortably covers a suite run.
 */

export type Role = 'ADMIN' | 'EDITOR' | 'MODERATOR' | 'MEMBER'
export const ROLES: Role[] = ['ADMIN', 'EDITOR', 'MODERATOR', 'MEMBER']

export type TestUser = { role: Role; username: string; sub: string; idToken: string }

const cognito = new CognitoIdentityProviderClient({ region: region() })

/** A domain that cannot receive mail, so nothing can escape to a real inbox. */
const EMAIL_DOMAIN = process.env.E2E_EMAIL_DOMAIN ?? 'e2e.rajchowk.test'
const PASSWORD = process.env.E2E_TEST_PASSWORD ?? 'IntegrationTest!2026-Rc'

export const usernameFor = (role: Role, runId: string): string =>
  `it-${runId}-${role.toLowerCase()}@${EMAIL_DOMAIN}`

/**
 * Create a pre-confirmed user in a group and return its ID token.
 *
 * Pre-confirmed via AdminCreateUser + AdminSetUserPassword(Permanent) so there
 * is no email verification step and no FORCE_CHANGE_PASSWORD challenge — the
 * signup flow itself is covered by the auth tests, not by every other file.
 */
export async function createUser(role: Role, runId: string): Promise<TestUser> {
  const username = usernameFor(role, runId)

  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId(),
        Username: username,
        MessageAction: 'SUPPRESS', // never send mail
        UserAttributes: [
          { Name: 'email', Value: username },
          { Name: 'email_verified', Value: 'true' },
        ],
      }),
    )
  } catch (error) {
    if ((error as Error).name !== 'UsernameExistsException') throw error
  }

  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId(),
      Username: username,
      Password: PASSWORD,
      Permanent: true,
    }),
  )

  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: userPoolId(),
      Username: username,
      GroupName: role,
    }),
  )

  const { idToken, sub } = await mintIdToken(username)
  return { role, username, sub, idToken }
}

/**
 * Exchange a username and password for an ID token.
 *
 * ADMIN_USER_PASSWORD_AUTH is an admin-only flow, which is why this needs AWS
 * credentials and why it works without touching the Amplify session at all.
 */
export async function mintIdToken(username: string): Promise<{ idToken: string; sub: string }> {
  const result = await cognito.send(
    new AdminInitiateAuthCommand({
      UserPoolId: userPoolId(),
      ClientId: userPoolClientId(),
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: username, PASSWORD },
    }),
  )

  const idToken = result.AuthenticationResult?.IdToken
  if (!idToken) {
    throw new Error(
      `No ID token for ${username} (challenge: ${result.ChallengeName ?? 'none'}). ` +
        'Check that ADMIN_USER_PASSWORD_AUTH is enabled on the app client.',
    )
  }

  return { idToken, sub: subFromIdToken(idToken) }
}

/** Read `sub` out of a JWT payload. No verification — Cognito just issued it. */
export function subFromIdToken(idToken: string): string {
  const payload = idToken.split('.')[1]
  if (!payload) throw new Error('Malformed ID token')
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    sub?: string
    'cognito:groups'?: string[]
  }
  if (!decoded.sub) throw new Error('ID token carries no sub')
  return decoded.sub
}

/** Groups as they appear in the token — what AppSync actually authorizes on. */
export function groupsFromIdToken(idToken: string): string[] {
  const payload = idToken.split('.')[1]
  if (!payload) return []
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    'cognito:groups'?: string[]
  }
  return decoded['cognito:groups'] ?? []
}

export async function deleteUser(username: string): Promise<void> {
  try {
    await cognito.send(
      new AdminDeleteUserCommand({ UserPoolId: userPoolId(), Username: username }),
    )
  } catch (error) {
    // Teardown must never fail the run.
    if ((error as Error).name !== 'UserNotFoundException') {
      console.warn(`could not delete test user ${username}: ${(error as Error).message}`)
    }
  }
}
