import { util } from '@aws-appsync/utils'

/**
 * Approved comments on one article.
 *
 * Reads the SPARSE commentsByThreadKeyAndCreatedAt index. Moderation removes
 * the threadKey attribute, so a pending, rejected, hidden or deleted comment
 * is ABSENT FROM THE INDEX rather than filtered out of it. That is materially
 * stronger than a filter expression, which one forgotten clause away leaks.
 *
 * APPSYNC_JS: uploaded verbatim, so no imports beyond '@aws-appsync/utils',
 * no async/await, no try/catch, no throw (use util.error), no new Date().
 */

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

export function request(ctx) {
  const args = ctx.args || {}
  const articleId = args.articleId
  if (!articleId) util.error('articleId is required', 'BadRequest')

  let limit = args.limit === null || args.limit === undefined ? DEFAULT_LIMIT : args.limit
  if (limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT

  return {
    operation: 'Query',
    index: 'commentsByThreadKeyAndCreatedAt',
    query: {
      expression: '#pk = :pk',
      expressionNames: { '#pk': 'threadKey' },
      expressionValues: util.dynamodb.toMapValues({ ':pk': articleId + '#APPROVED' }),
    },
    // Oldest first: a conversation reads top to bottom.
    scanIndexForward: true,
    limit: limit,
    nextToken: args.nextToken,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)

  const result = ctx.result || {}
  const items = result.items || []
  const out = []
  // ipHash, contentHash, moderatedBySub and moderationNote are deliberately
  // not carried across.
  for (const item of items) {
    out.push({
      id: item.id,
      articleId: item.articleId,
      parentCommentId: item.parentCommentId,
      authorProfileId: item.authorProfileId,
      authorDisplayName: item.authorDisplayName,
      content: item.content,
      depth: item.depth || 0,
      createdAt: item.createdAt,
    })
  }
  return { items: out, nextToken: result.nextToken || null }
}
