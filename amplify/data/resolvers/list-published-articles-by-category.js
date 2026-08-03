import { util } from '@aws-appsync/utils'

/**
 * Published articles within one category.
 *
 * APPSYNC_JS: uploaded verbatim, so no imports beyond '@aws-appsync/utils',
 * no async/await, no try/catch, no throw (use util.error), no new Date().
 */

const MAX_LIMIT = 24
const DEFAULT_LIMIT = 12
const ALLOWED_LANGUAGES = ['HI', 'EN']

export function request(ctx) {
  const args = ctx.args || {}
  const categoryId = args.categoryId
  if (!categoryId) util.error('categoryId is required', 'BadRequest')

  const language = ALLOWED_LANGUAGES.indexOf(args.language) >= 0 ? args.language : 'HI'
  let limit = args.limit === null || args.limit === undefined ? DEFAULT_LIMIT : args.limit
  if (limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT

  // The category is part of a server-composed key, so a caller cannot use it
  // to reach a partition holding unpublished work.
  const feedKey = categoryId + '#PUBLISHED#' + language
  const now = util.time.nowISO8601()

  return {
    operation: 'Query',
    index: 'articlesByCategoryFeedKeyAndPublishedAt',
    query: {
      expression: '#pk = :pk AND #sk <= :now',
      expressionNames: { '#pk': 'categoryFeedKey', '#sk': 'publishedAt' },
      expressionValues: util.dynamodb.toMapValues({ ':pk': feedKey, ':now': now }),
    },
    filter: {
      expression: '#status = :published',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':published': 'PUBLISHED' }),
    },
    scanIndexForward: false,
    limit: limit,
    nextToken: args.nextToken,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)
  const result = ctx.result || {}
  const items = result.items || []
  const out = []
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
  return { items: out, nextToken: result.nextToken || null }
}
