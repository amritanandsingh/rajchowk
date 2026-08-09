/**
 * Who is calling, according to the verified token.
 *
 * THE SOURCE OF THESE VALUES MATTERS MORE THAN THE CODE DOES. `event.identity`
 * on an AppSync Lambda resolver is populated by AppSync from a JWT it has
 * already verified against the Cognito user pool's JWKS — signature, issuer,
 * audience and expiry all checked before the function is invoked. It is not
 * request-supplied data reaching us unexamined; a caller cannot put themselves
 * in a group by editing a header.
 *
 * That is why this module can be so small, and why it must never grow a path
 * that reads a group from `event.arguments` or from a request header.
 *
 * The group name is mirrored in three places by necessity — here (Lambda
 * runtime), amplify/auth/resource.ts (which creates it) and
 * src/lib/domain/staff-role equivalents in the UI. They cannot import each
 * other: this is bundled into a Lambda and a value-import from it would drag
 * Node-only code into the browser bundle. Keep them in agreement.
 */

export const GROUP = { ADMIN: 'ADMIN' } as const
export type GroupName = (typeof GROUP)[keyof typeof GROUP]

/** The subset of AppSync's Cognito identity we rely on. Declared structurally
 *  rather than imported so this module stays free of aws-lambda types. */
type CognitoIdentity = {
  sub?: string | null
  username?: string | null
  groups?: readonly string[] | null
  claims?: Record<string, unknown> | null
}

export type Caller = {
  /** The Cognito `sub`. Stable for the life of the account, unlike the email. */
  sub: string
  /** Whatever we can use as a byline. Never client-supplied. */
  displayName: string
  groups: readonly string[]
}

/**
 * Pull the claim we trust out of an identity object.
 *
 * `groups` is the normalised field AppSync provides; `claims['cognito:groups']`
 * is the raw JWT claim. Both are read because which one is populated depends on
 * the resolver kind, and a handler that only checked one silently authorised
 * nobody when invoked the other way — an outage-shaped bug, not a security one,
 * but an avoidable one.
 */
function groupsFrom(identity: CognitoIdentity): readonly string[] {
  if (Array.isArray(identity.groups)) return identity.groups

  const claim = identity.claims?.['cognito:groups']
  if (Array.isArray(claim)) return claim.filter((g): g is string => typeof g === 'string')
  // Some Cognito configurations serialise the claim as a space-delimited
  // string rather than an array.
  if (typeof claim === 'string') return claim.split(/[\s,]+/).filter(Boolean)

  return []
}

/**
 * The byline for an admin.
 *
 * Precedence is preferred_username (what they chose), then the email's
 * local-part, then the username. The email local-part rather than the whole
 * address on purpose: an article byline is public, and publishing
 * "amrit@example.com" under a headline hands out a real address to every
 * scraper that reads the feed.
 */
function displayNameFrom(identity: CognitoIdentity): string {
  const claims = identity.claims ?? {}

  const preferred = claims['preferred_username']
  if (typeof preferred === 'string' && preferred.trim()) return preferred.trim()

  const email = claims['email']
  if (typeof email === 'string' && email.includes('@')) {
    const local = email.split('@')[0]
    if (local) return local
  }

  if (typeof identity.username === 'string' && identity.username.trim()) {
    return identity.username.trim()
  }

  return 'संपादक'
}

/**
 * Build a Caller, or null when there is no usable verified identity.
 *
 * Null is returned rather than a partially-filled object so callers cannot
 * accidentally proceed with an empty `sub`. Every handler's first two lines are
 * the same pair of guards, and that repetition is intentional — it keeps the
 * authorization decision visible at the top of the function that makes it,
 * rather than hidden in a wrapper.
 */
export function callerFrom(identity: unknown): Caller | null {
  if (!identity || typeof identity !== 'object') return null

  const cognito = identity as CognitoIdentity
  const sub =
    typeof cognito.sub === 'string' && cognito.sub
      ? cognito.sub
      : typeof cognito.claims?.['sub'] === 'string'
        ? (cognito.claims['sub'] as string)
        : null

  if (!sub) return null

  return {
    sub,
    displayName: displayNameFrom(cognito),
    groups: groupsFrom(cognito),
  }
}

/**
 * The only capability predicate in the system.
 *
 * AppSync has already rejected non-admins via `allow.group('ADMIN')` on the
 * mutation field, so this is the second of two independent checks rather than
 * the only one. It is worth having anyway: the schema rule and the handler are
 * edited by different changes at different times, and this is what catches a
 * mutation that was added without its rule.
 */
export function isAdmin(caller: Caller | null): boolean {
  return caller !== null && caller.groups.includes(GROUP.ADMIN)
}
