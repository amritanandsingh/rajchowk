import { util } from '@aws-appsync/utils'

/**
 * The public article feed. Newest published article first.
 *
 * APPSYNC_JS CONSTRAINTS — every resolver in this directory must obey them.
 * These files are uploaded to AppSync VERBATIM: unbundled, untranspiled. So:
 *   - must be .js, never .ts
 *   - may import nothing except '@aws-appsync/utils' (no shared helper module,
 *     which is why the limit-clamping below is duplicated per resolver)
 *   - no async/await, no Promises, no try/catch, no throw (use util.error)
 *   - no new Date() (use util.time.*), no Math.random() (use util.autoId())
 *   - exactly two exports, named `request` and `response`
 * The ESLint config enforces all of these mechanically.
 *
 * SECURITY. The partition key is the literal 'PUBLISHED', written here and
 * derived from nothing the caller sent. There is no argument that carries a
 * status, so there is no input to validate — the attack surface is absent
 * rather than defended. The redundant status filter means that even a stale
 * feedKey could only ever HIDE a published article, never reveal a draft.
 *
 * Note the index is SPARSE: `feedKey` is removed from the item when an article
 * is not published, so drafts have no entry here at all.
 */

const MAX_LIMIT = 24
const DEFAULT_LIMIT = 12
const PUBLISHED = 'PUBLISHED'

export function request(ctx) {
  const args = ctx.args || {}

  let limit = args.limit === null || args.limit === undefined ? DEFAULT_LIMIT : args.limit
  if (limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT

  const now = util.time.nowISO8601()

  return {
    operation: 'Query',
    index: 'articlesByFeedKeyAndPublishedAt',
    query: {
      // The sort-key bound is not decoration. If a publishedAt is ever set in
      // the future, this is what keeps the article out of the feed until its
      // moment arrives, without needing a scheduler to be punctual.
      expression: '#pk = :pk AND #sk <= :now',
      expressionNames: { '#pk': 'feedKey', '#sk': 'publishedAt' },
      expressionValues: util.dynamodb.toMapValues({ ':pk': PUBLISHED, ':now': now }),
    },
    filter: {
      expression: '#status = :published',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':published': PUBLISHED }),
    },
    // Newest first. This is the whole reason the feed is a Query on a sorted
    // index rather than a Scan plus an in-memory sort.
    scanIndexForward: false,
    limit: limit,
    nextToken: args.nextToken,
    consistentRead: false,
  }
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type)
  }

  const result = ctx.result || {}
  const items = result.items || []
  const out = []

  // EXPLICIT FIELD ALLOWLIST. Nothing reaches an anonymous visitor that is not
  // named here, so a field added to the Article model later cannot leak
  // through this feed without someone also editing this list. `authorSub` and
  // `content` are absent by construction, not by filtering.
  for (const item of items) {
    out.push({
      id: item.id,
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      authorName: item.authorName,
      publishedAt: item.publishedAt,
    })
  }

  // NOTE for callers: DynamoDB applies `filter` AFTER `limit`, so a page can
  // return fewer than `limit` items while still having a nextToken. Paginate
  // until nextToken is null, not until a page comes back short.
  return { items: out, nextToken: result.nextToken || null }
}
