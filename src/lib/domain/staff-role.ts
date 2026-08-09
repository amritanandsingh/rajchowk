/**
 * Staff capability predicates, read from the `cognito:groups` ID-token claim.
 *
 * The group names are the source of truth in amplify/auth/resource.ts and are
 * mirrored for the Lambdas in amplify/functions/shared/identity.ts. They are
 * re-declared here rather than imported from that module because it is Lambda
 * runtime code: a value import would pull it into the client bundle. (A
 * type-only import would be erased and is fine — that is how components get
 * `Schema`.) Keep the three files in agreement.
 *
 * These predicates decide what the UI OFFERS, never what it is allowed to do.
 * The real boundary is the `allow.group(...)` rules on the AppSync API, which
 * are evaluated server-side against the same claim. Anything that would be a
 * security problem if a user edited their own token does not belong here.
 */

export const GROUP = {
  ADMIN: 'ADMIN',
  EDITOR: 'EDITOR',
  MODERATOR: 'MODERATOR',
  MEMBER: 'MEMBER',
} as const

export type GroupName = (typeof GROUP)[keyof typeof GROUP]

/** Any group that gets a /admin surface at all. Mirrors MODERATORS in amplify/data/resource.ts. */
const STAFF_GROUPS: readonly string[] = [GROUP.ADMIN, GROUP.EDITOR, GROUP.MODERATOR]

/** Mirrors STAFF in amplify/data/resource.ts — the writers. */
const WRITER_GROUPS: readonly string[] = [GROUP.ADMIN, GROUP.EDITOR]

function hasAny(groups: readonly string[], allowed: readonly string[]): boolean {
  return groups.some((group) => allowed.includes(group))
}

/** Can see /admin at all. `Article` grants MODERATOR read, so the queue and lists are legitimate. */
export function isStaff(groups: readonly string[]): boolean {
  return hasAny(groups, STAFF_GROUPS)
}

/** `Article` grants create/update to EDITOR and ADMIN only. */
export function canWriteArticles(groups: readonly string[]): boolean {
  return hasAny(groups, WRITER_GROUPS)
}

/** `Category` grants create/update to EDITOR and ADMIN only (delete is ADMIN). */
export function canCreateCategory(groups: readonly string[]): boolean {
  return hasAny(groups, WRITER_GROUPS)
}

/**
 * Administrator, as the transition table means it.
 *
 * This is the `isAdmin` that `availableActions(from, isAdmin)` in
 * article-status.ts expects, and it must agree with `isAdmin` in
 * amplify/functions/shared/identity.ts — the handler re-derives the same
 * predicate from the verified claim, so a disagreement here shows up as a
 * button that always fails rather than as a security hole.
 */
export function isAdmin(groups: readonly string[]): boolean {
  return hasAny(groups, [GROUP.ADMIN])
}

/**
 * Only an administrator may publish or unpublish.
 *
 * The `publishArticle` mutation is `allow.groups(STAFF)`, which admits EDITOR —
 * but that is because editors legitimately call SUBMIT_FOR_REVIEW and
 * RETURN_TO_DRAFT through the same mutation. PUBLISH and UNPUBLISH are
 * `adminOnly: true` in the transition table, and the handler enforces it. So
 * this must follow the transition table, not the directive: matching the
 * directive would offer an editor a button the backend always refuses.
 */
export function canPublish(groups: readonly string[]): boolean {
  return isAdmin(groups)
}
