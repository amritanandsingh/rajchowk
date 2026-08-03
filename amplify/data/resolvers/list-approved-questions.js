import { util } from '@aws-appsync/utils'

/**
 * Approved Ask Amrit questions, most-upvoted first.
 *
 * Same sparse-index mechanism as comments: queueKey exists only on approved
 * questions, so nothing under review can appear here.
 *
 * APPSYNC_JS: uploaded verbatim, so no imports beyond '@aws-appsync/utils',
 * no async/await, no try/catch, no throw (use util.error), no new Date().
 */

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20

export function request(ctx) {
  const args = ctx.args || {}
  let limit = args.limit === null || args.limit === undefined ? DEFAULT_LIMIT : args.limit
  if (limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT

  // A scope is either the global board or one live event. Anything else is
  // coerced to GLOBAL rather than passed through to the key.
  let scope = 'GLOBAL'
  if (typeof args.scope === 'string' && args.scope.indexOf('EVENT#') === 0) {
    scope = args.scope
  }

  return {
    operation: 'Query',
    index: 'questionsByQueueKeyAndUpvoteCount',
    query: {
      expression: '#pk = :pk',
      expressionNames: { '#pk': 'queueKey' },
      expressionValues: util.dynamodb.toMapValues({ ':pk': scope + '#APPROVED' }),
    },
    // Highest upvote count first — the board is ranked by what readers want
    // answered, which is the whole point of the feature.
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
      questionText: item.questionText,
      category: item.category,
      language: item.language,
      articleId: item.articleId,
      liveEventId: item.liveEventId,
      askerDisplayName: item.askerDisplayName,
      status: item.status,
      upvoteCount: item.upvoteCount || 0,
      writtenAnswer: item.writtenAnswer,
      answerVideoUrl: item.answerVideoUrl,
      answeredAt: item.answeredAt,
      createdAt: item.createdAt,
    })
  }
  return { items: out, nextToken: result.nextToken || null }
}
