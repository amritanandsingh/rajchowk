import { util } from '@aws-appsync/utils'

/**
 * A single published article, by slug.
 *
 * APPSYNC_JS: uploaded verbatim, so no imports beyond '@aws-appsync/utils',
 * no async/await, no try/catch, no throw (use util.error), no new Date().
 *
 * SECURITY. The slug is caller-supplied, so unlike the feed this resolver does
 * have an input — but a slug only selects WHICH row, never WHETHER it is
 * readable. The status gate below is applied after the fetch and is not
 * expressible as an argument.
 *
 * A draft is reported as NotFound, not Forbidden. "Forbidden" would confirm
 * that a slug exists, which turns the article page into an oracle for
 * enumerating unpublished headlines.
 */

const PUBLISHED = 'PUBLISHED'

export function request(ctx) {
  const slug = ctx.args ? ctx.args.slug : null
  if (!slug) util.error('slug is required', 'BadRequest')

  return {
    operation: 'Query',
    index: 'articlesBySlug',
    query: {
      expression: '#slug = :slug',
      expressionNames: { '#slug': 'slug' },
      expressionValues: util.dynamodb.toMapValues({ ':slug': slug }),
    },
    limit: 1,
    consistentRead: false,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)

  const items = (ctx.result && ctx.result.items) || []
  const article = items.length > 0 ? items[0] : null

  // Missing row and draft row take the SAME branch, deliberately — see above.
  if (!article || article.status !== PUBLISHED) {
    util.error('Article not found', 'NotFound')
  }

  // Explicit allowlist. `authorSub`, `feedKey` and `statusKey` are internal and
  // are absent here by construction rather than by being stripped.
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    content: article.content,
    authorName: article.authorName,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
  }
}
