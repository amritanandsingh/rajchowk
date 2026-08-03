/**
 * Caller identity, derived exclusively from the verified Cognito token.
 *
 * NOTHING in this module reads a user id from mutation arguments. That is the
 * whole point: `castVote` takes a pollId and an optionId and no user field, so
 * there is no argument a caller could forge. Any future mutation that accepts
 * a userSub argument is a bug.
 */

export type AppSyncIdentity = {
  sub?: string
  username?: string
  groups?: string[] | null
  claims?: Record<string, unknown>
  sourceIp?: string[]
}

export type Caller = {
  sub: string
  username: string
  groups: string[]
  sourceIp: string | undefined
}

/** Returns null when the request is not authenticated with a Cognito user. */
export function callerFrom(identity: unknown): Caller | null {
  const id = identity as AppSyncIdentity | null | undefined
  const sub = id?.sub
  if (!sub) return null

  return {
    sub,
    username: id?.username ?? sub,
    // Array.isArray, not `?? []`. A malformed or hostile `cognito:groups`
    // claim that is not an array would otherwise reach hasGroup() and throw
    // `groups.some is not a function` — turning a clean FORBIDDEN into an
    // unhandled 500 inside a privileged Lambda. Coercing here means every
    // downstream predicate is safe and a bad claim simply grants nothing.
    groups: Array.isArray(id?.groups) ? id.groups : [],
    sourceIp: Array.isArray(id?.sourceIp) ? id.sourceIp[0] : undefined,
  }
}

export const GROUP = {
  ADMIN: 'ADMIN',
  EDITOR: 'EDITOR',
  MODERATOR: 'MODERATOR',
  MEMBER: 'MEMBER',
} as const

export type GroupName = (typeof GROUP)[keyof typeof GROUP]

export function hasGroup(caller: Caller | null, ...groups: GroupName[]): boolean {
  if (!caller) return false
  return caller.groups.some((group) => (groups as string[]).includes(group))
}

export const isAdmin = (caller: Caller | null): boolean => hasGroup(caller, GROUP.ADMIN)

export const isStaff = (caller: Caller | null): boolean =>
  hasGroup(caller, GROUP.ADMIN, GROUP.EDITOR)

export const isModerator = (caller: Caller | null): boolean =>
  hasGroup(caller, GROUP.ADMIN, GROUP.EDITOR, GROUP.MODERATOR)

/**
 * Only an administrator may publish.
 *
 * The @auth directive on `publishArticle` admits EDITOR as well, because
 * editors legitimately call it to schedule and unpublish their own drafts.
 * This is the check that separates those cases — see publish-article/handler.ts.
 */
export const canPublish = (caller: Caller | null): boolean => isAdmin(caller)
