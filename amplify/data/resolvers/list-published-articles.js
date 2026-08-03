import { util } from '@aws-appsync/utils'

/**
 * The public article feed.
 *
 * APPSYNC_JS CONSTRAINTS — every resolver in this directory must obey them.
 * These files are uploaded to AppSync VERBATIM: unbundled, untranspiled. So:
 *   - must be .js, never .ts
 *   - may import nothing except '@aws-appsync/utils' (no shared helper module)
 *   - no async/await, no Promises, no try/catch, no throw (use util.error)
 *   - no new Date() (use util.time.*), no Math.random() (use util.autoId())
 *   - exactly two exports, named `request` and `response`
 *
 * SECURITY: the status is hard-coded into the partition key here and cannot be
 * influenced by the caller. There is no argument that carries a status, and
 * the `language` argument is checked against an allow-list so it cannot be
 * used to reach another partition. The redundant status filter means that even
 * a stale feedKey could only ever HIDE a published article, never reveal an
 * unpublished one.
 */

const MAX_LIMIT = 24
const DEFAULT_LIMIT = 12
const ALLOWED_LANGUAGES = ['HI', 'EN']
const ALLOWED_CONTENT_TYPES = [
  'NEWS',
  'OPINION',
  'ANALYSIS',
  'EXPLAINER',
  'FACT_CHECK',
  'INTERVIEW',
  'EDITORIAL',
]

export function request(ctx) {
  const args = ctx.args || {}

  const language = ALLOWED_LANGUAGES.indexOf(args.language) >= 0 ? args.language : 'HI'

  let limit = args.limit === null || args.limit === undefined ? DEFAULT_LIMIT : args.limit
  if (limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT

  // Server-authoritative. The caller supplies no part of this.
  const feedKey = 'PUBLISHED#' + language
  const now = util.time.nowISO8601()

  // Scheduled-but-not-yet-due articles carry a future publishedAt, so the sort
  // key bound is what keeps an embargoed story out of the feed even in the
  // window before the scheduler flips its status.
  const query = {
    expression: '#pk = :pk AND #sk <= :now',
    expressionNames: { '#pk': 'feedKey', '#sk': 'publishedAt' },
    expressionValues: util.dynamodb.toMapValues({ ':pk': feedKey, ':now': now }),
  }

  const filterNames = { '#status': 'status' }
  const filterValues = { ':published': 'PUBLISHED' }
  let filterExpression = '#status = :published'

  if (ALLOWED_CONTENT_TYPES.indexOf(args.contentType) >= 0) {
    filterExpression = filterExpression + ' AND #contentType = :contentType'
    filterNames['#contentType'] = 'contentType'
    filterValues[':contentType'] = args.contentType
  }

  return {
    operation: 'Query',
    index: 'articlesByFeedKeyAndPublishedAt',
    query: query,
    filter: {
      expression: filterExpression,
      expressionNames: filterNames,
      expressionValues: util.dynamodb.toMapValues(filterValues),
    },
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

  // Explicit field allowlist. Nothing reaches the client that is not named
  // here, so a sensitive field added to the Article model later cannot leak
  // through this feed without someone also editing this list.
  for (const item of items) {
    out.push({
      id: item.id,
      slug: item.slug,
      title: item.title,
      subtitle: item.subtitle,
      excerpt: item.excerpt,
      language: item.language,
      contentType: item.contentType,
      categoryId: item.categoryId,
      heroImageKey: item.heroImageKey,
      heroImageAlt: item.heroImageAlt,
      authorDisplayName: item.authorDisplayName,
      publishedAt: item.publishedAt,
      readingMinutes: item.readingMinutes,
      isBreaking: item.isBreaking === true,
      isFeatured: item.isFeatured === true,
      commentCount: item.commentCount || 0,
      youtubeVideoId: item.youtubeVideoId,
    })
  }

  // NOTE for callers: DynamoDB applies `filter` AFTER `limit`, so a page can
  // return fewer than `limit` items while still having a nextToken. Paginate
  // until nextToken is null, not until a page comes back short.
  return { items: out, nextToken: result.nextToken || null }
}
