/**
 * The publishing state machine.
 *
 * Pure module: imported by the Lambdas in amplify/ by relative path, so no
 * React, no next/*, no DOM globals, no `@/` aliases.
 *
 * Two states, as the specification recommends. "Unpublish" returns an article
 * to DRAFT rather than adding a third state — the reader-visible effect is
 * identical, and a third state would need its own transition rules and its own
 * feed semantics for no MVP benefit.
 *
 * The transition table below is the SINGLE definition of what may happen. The
 * admin UI reads it to decide which buttons to offer; the Lambda reads it to
 * decide what to allow. That is deliberate — when the two disagree you get
 * either a button that always fails or, worse, a capability the UI hid but the
 * backend still honours.
 */

export const ARTICLE_STATUS = ['DRAFT', 'PUBLISHED'] as const
export type ArticleStatus = (typeof ARTICLE_STATUS)[number]

export const PUBLISH_ACTIONS = ['PUBLISH', 'UNPUBLISH'] as const
export type PublishAction = (typeof PUBLISH_ACTIONS)[number]

export function isArticleStatus(value: unknown): value is ArticleStatus {
  return typeof value === 'string' && (ARTICLE_STATUS as readonly string[]).includes(value)
}

export function isPublishAction(value: unknown): value is PublishAction {
  return typeof value === 'string' && (PUBLISH_ACTIONS as readonly string[]).includes(value)
}

/**
 * An article whose `status` attribute is missing is a DRAFT.
 *
 * This is not defensive padding — it is a real state. `status` is
 * Lambda-owned, so it is written by the handler rather than by the create
 * mutation, and any row that predates a schema change or was written by a
 * partial failure can legitimately lack it. Reading absent as DRAFT is the
 * fail-closed direction: an article with no status is never in a feed, because
 * `feedKey` is only ever set on the same write that sets `status`.
 */
export function statusOf(value: unknown): ArticleStatus {
  return isArticleStatus(value) ? value : 'DRAFT'
}

/** What each action means, and what it lands on. */
const TRANSITIONS: Record<PublishAction, { from: readonly ArticleStatus[]; to: ArticleStatus }> = {
  PUBLISH: { from: ['DRAFT'], to: 'PUBLISHED' },
  UNPUBLISH: { from: ['PUBLISHED'], to: 'DRAFT' },
}

export type TransitionCheck =
  | { allowed: true; to: ArticleStatus }
  | { allowed: false; reason: 'UNKNOWN_ACTION' | 'ILLEGAL_TRANSITION' }

/**
 * May `action` be applied to an article currently in `from`?
 *
 * ILLEGAL_TRANSITION covers the case that actually happens in production: two
 * admins with the dashboard open, one publishes, the other's stale page still
 * offers a Publish button. The handler additionally guards the DynamoDB write
 * on the current status, so the loser of that race fails at the database too
 * rather than relying on having checked here first.
 */
export function checkTransition(from: ArticleStatus, action: string): TransitionCheck {
  if (!isPublishAction(action)) return { allowed: false, reason: 'UNKNOWN_ACTION' }

  const transition = TRANSITIONS[action]
  if (!transition.from.includes(from)) {
    return { allowed: false, reason: 'ILLEGAL_TRANSITION' }
  }
  return { allowed: true, to: transition.to }
}

/** The actions the UI should offer for an article in this state. */
export function availableActions(from: ArticleStatus): PublishAction[] {
  return PUBLISH_ACTIONS.filter((action) => checkTransition(from, action).allowed)
}

/**
 * The feed partition key for a status — or null, meaning REMOVE the attribute.
 *
 * Returning null rather than a sentinel string is what makes the public feed
 * index sparse: the handler translates null into a DynamoDB `REMOVE feedKey`,
 * so an unpublished article has no entry in
 * `articlesByFeedKeyAndPublishedAt` at all. It is not hidden by a filter, it
 * is absent from the index.
 */
export function feedKeyFor(status: ArticleStatus): string | null {
  return status === 'PUBLISHED' ? 'PUBLISHED' : null
}

/**
 * The admin-list partition key. Always present, unlike feedKey — the admin
 * dashboard has to be able to enumerate drafts.
 */
export function statusKeyFor(status: ArticleStatus): string {
  return status
}
