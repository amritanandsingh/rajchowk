import { Amplify } from 'aws-amplify'
import { generateClient, type V6Client } from 'aws-amplify/data'
import type { Schema } from '@/../amplify/data/resource'
import { amplifyOutputs } from './outputs'
import type { Role, TestUser } from './users'

/**
 * Typed clients, one per principal.
 *
 * Each authenticated client carries an explicit `authToken` (a Cognito ID
 * token) rather than relying on the Amplify session, so several principals can
 * be in flight at once inside a single process. See harness/users.ts for why
 * that matters.
 *
 * `ssr: false` keeps the library from installing cookie-based credential
 * storage, which has no meaning in a Node test runner.
 */

export type Client = V6Client<Schema>

let configured = false

function configureOnce(): void {
  if (configured) return
  Amplify.configure(amplifyOutputs(), { ssr: false })
  configured = true
}

/**
 * A client acting as the given user.
 *
 * `authMode: 'none'` plus an explicit Authorization header, which is the ONLY
 * combination that works here — established empirically, not assumed:
 *
 *   userPool + authToken  -> throws NoValidAuthTokens: No federated jwt
 *   oidc     + authToken  -> throws NoValidAuthTokens: No federated jwt
 *   apiKey   + header     -> AppSync uses the API key and refuses the mutation
 *   none     + header     -> works
 *
 * `authMode: 'userPool'` ignores `authToken` and insists on reading a session
 * from Amplify's own credential store, which is precisely the module-scoped
 * singleton this harness exists to avoid. `'none'` tells Amplify to attach no
 * auth of its own, so the header passes through and AppSync authenticates the
 * JWT as a user-pool principal — giving several principals at once in one
 * process, which the concurrency test needs.
 */
export function clientFor(user: TestUser): Client {
  configureOnce()
  return generateClient<Schema>({
    authMode: 'none',
    headers: { Authorization: user.idToken },
  })
}

/**
 * The anonymous public reader.
 *
 * API key, because Amplify forbids identity-pool auth on `a.handler.custom` and
 * the public content queries are APPSYNC_JS resolvers. This is the principal a
 * search engine or a logged-out visitor uses, so it is the one that must NOT be
 * able to reach a draft.
 */
export function anonymousClient(): Client {
  configureOnce()
  return generateClient<Schema>({ authMode: 'apiKey' })
}

/** An unauthenticated identity-pool caller, for the Lambda-backed guest ops. */
export function guestClient(): Client {
  configureOnce()
  return generateClient<Schema>({ authMode: 'identityPool' })
}

export type Clients = Record<Role, Client> & { anonymous: Client; guest: Client }

export function clientsFor(users: Record<Role, TestUser>): Clients {
  return {
    ADMIN: clientFor(users.ADMIN),
    EDITOR: clientFor(users.EDITOR),
    MODERATOR: clientFor(users.MODERATOR),
    MEMBER: clientFor(users.MEMBER),
    anonymous: anonymousClient(),
    guest: guestClient(),
  }
}

/* ---------------------------------------------------------------------------
 * Response helpers.
 *
 * The Amplify v6 client does NOT throw on a GraphQL error — it returns
 * `{ data: null, errors: [...] }`. A test that only looks at `data` therefore
 * passes against a completely broken API, so every assertion goes through one
 * of these.
 * ------------------------------------------------------------------------ */

type GraphQLish<T> = { data: T | null | undefined; errors?: Array<{ message: string; errorType?: string }> }

/** Unwrap a call that must succeed. Throws with the real error text if not. */
export function expectOk<T>(result: GraphQLish<T>, label: string): T {
  if (result.errors?.length) {
    throw new Error(
      `${label} failed: ${result.errors.map((error) => `${error.errorType ?? '?'}: ${error.message}`).join('; ')}`,
    )
  }
  if (result.data === null || result.data === undefined) {
    throw new Error(`${label} returned no data and no errors`)
  }
  return result.data
}

/** The errorType of a call that must have been refused. */
export function refusalType<T>(result: GraphQLish<T>): string | undefined {
  return result.errors?.[0]?.errorType
}

export function wasRefused<T>(result: GraphQLish<T>): boolean {
  return Boolean(result.errors?.length)
}

/**
 * The `code` a Lambda-backed mutation returned.
 *
 * These handlers answer with a typed result object rather than a GraphQL error,
 * so "was it refused" means inspecting `code`, not `errors`.
 */
export function resultCode(data: unknown): string {
  const value = (data as { code?: unknown } | null)?.code
  return typeof value === 'string' ? value : '(no code)'
}
