/**
 * Article publishing state machine.
 *
 * Pure module — shared with the Lambdas in amplify/, so no React, no next/*,
 * no DOM globals, no `@/` aliases.
 *
 * The transition table is the single source of truth for what "publishing"
 * means. It is enforced in publish-article/handler.ts with a DynamoDB
 * ConditionExpression on the current status, so two editors acting at the same
 * moment cannot both win.
 */

export const ARTICLE_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'SCHEDULED',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
] as const

export type ArticleStatus = (typeof ARTICLE_STATUSES)[number]

export const PUBLISH_ACTIONS = [
  'SUBMIT_FOR_REVIEW',
  'RETURN_TO_DRAFT',
  'SCHEDULE',
  'PUBLISH',
  'UNPUBLISH',
  'ARCHIVE',
  'RESTORE',
] as const

export type PublishAction = (typeof PUBLISH_ACTIONS)[number]

type Transition = {
  from: readonly ArticleStatus[]
  to: ArticleStatus
  /** Only an administrator may perform this transition. */
  adminOnly: boolean
}

/**
 * PUBLISH and UNPUBLISH are admin-only by product requirement: an editor
 * prepares content, an administrator decides what goes live. Everything else
 * is available to any staff member.
 */
const TRANSITIONS: Record<PublishAction, Transition> = {
  SUBMIT_FOR_REVIEW: { from: ['DRAFT'], to: 'IN_REVIEW', adminOnly: false },
  RETURN_TO_DRAFT: { from: ['IN_REVIEW', 'SCHEDULED'], to: 'DRAFT', adminOnly: false },
  SCHEDULE: { from: ['DRAFT', 'IN_REVIEW'], to: 'SCHEDULED', adminOnly: true },
  PUBLISH: {
    from: ['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'UNPUBLISHED'],
    to: 'PUBLISHED',
    adminOnly: true,
  },
  UNPUBLISH: { from: ['PUBLISHED'], to: 'UNPUBLISHED', adminOnly: true },
  ARCHIVE: { from: ['PUBLISHED', 'UNPUBLISHED', 'DRAFT'], to: 'ARCHIVED', adminOnly: true },
  RESTORE: { from: ['ARCHIVED'], to: 'DRAFT', adminOnly: true },
}

export function isArticleStatus(value: unknown): value is ArticleStatus {
  return typeof value === 'string' && (ARTICLE_STATUSES as readonly string[]).includes(value)
}

export function isPublishAction(value: unknown): value is PublishAction {
  return typeof value === 'string' && (PUBLISH_ACTIONS as readonly string[]).includes(value)
}

export type TransitionCheck =
  | { allowed: true; to: ArticleStatus }
  | { allowed: false; reason: 'UNKNOWN_ACTION' | 'ILLEGAL_TRANSITION' | 'REQUIRES_ADMIN' }

/**
 * Can `action` be applied to an article currently in `from`?
 *
 * `isAdmin` is derived from the verified Cognito groups, never from an argument.
 */
export function checkTransition(
  from: ArticleStatus,
  action: PublishAction,
  isAdmin: boolean,
): TransitionCheck {
  const transition = TRANSITIONS[action]
  if (!transition) return { allowed: false, reason: 'UNKNOWN_ACTION' }
  if (!transition.from.includes(from)) return { allowed: false, reason: 'ILLEGAL_TRANSITION' }
  if (transition.adminOnly && !isAdmin) return { allowed: false, reason: 'REQUIRES_ADMIN' }
  return { allowed: true, to: transition.to }
}

/** Statuses a transition is legal from — used for the DynamoDB
 *  ConditionExpression that makes the check atomic with the write. */
export function allowedFromStatuses(action: PublishAction): readonly ArticleStatus[] {
  return TRANSITIONS[action]?.from ?? []
}

export function requiresAdmin(action: PublishAction): boolean {
  return TRANSITIONS[action]?.adminOnly ?? true
}

/** Actions available from a status, for rendering the editor's toolbar. */
export function availableActions(from: ArticleStatus, isAdmin: boolean): PublishAction[] {
  return PUBLISH_ACTIONS.filter((action) => checkTransition(from, action, isAdmin).allowed)
}

/**
 * Is this status publicly readable?
 *
 * ARCHIVED is deliberately still public: an archived story has dropped out of
 * the feeds but its URL must keep working, or every inbound link and citation
 * to it breaks. UNPUBLISHED is the status for "pulled, should 404 or redirect".
 */
export function isPubliclyReadable(status: ArticleStatus): boolean {
  return status === 'PUBLISHED' || status === 'ARCHIVED'
}

/** Should this status appear in feeds, sitemaps and the news sitemap? */
export function appearsInFeeds(status: ArticleStatus): boolean {
  return status === 'PUBLISHED'
}

/**
 * The sparse GSI partition key for the public feed.
 *
 * Returns null for anything not in a feed, which REMOVES the attribute and
 * therefore removes the row from the index entirely — the article is absent
 * from the feed rather than filtered out of it.
 */
export function feedKeyFor(status: ArticleStatus, language: string): string | null {
  return appearsInFeeds(status) ? `PUBLISHED#${language}` : null
}

export function categoryFeedKeyFor(
  status: ArticleStatus,
  language: string,
  categoryId: string,
): string | null {
  return appearsInFeeds(status) ? `${categoryId}#PUBLISHED#${language}` : null
}

export function tagFeedKeyFor(
  status: ArticleStatus,
  language: string,
  tagId: string,
): string | null {
  return appearsInFeeds(status) ? `${tagId}#PUBLISHED#${language}` : null
}
