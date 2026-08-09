import { util } from '@aws-appsync/utils'

const MAX_LIMIT = 20
const DEFAULT_LIMIT = 12
const ALLOWED_STATUSES = ['OPEN', 'CLOSED']

export function request(ctx) {
  const args = ctx.args || {}
  const status = ALLOWED_STATUSES.indexOf(args.status) >= 0 ? args.status : 'OPEN'
  let limit = args.limit === null || args.limit === undefined ? DEFAULT_LIMIT : args.limit
  if (limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT

  return {
    operation: 'Query',
    index: 'pollsByStatusAndClosesAt',
    query: {
      expression: '#status = :status',
      expressionNames: { '#status': 'status' },
      expressionValues: util.dynamodb.toMapValues({ ':status': status }),
    },
    scanIndexForward: status === 'OPEN',
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
    if (ALLOWED_STATUSES.indexOf(item.status) >= 0) {
      out.push({
        id: item.id,
        question: item.question,
        description: item.description,
        language: item.language,
        status: item.status,
        articleId: item.articleId,
        totalVotes: item.totalVotes || 0,
        opensAt: item.opensAt,
        closesAt: item.closesAt,
        isDaily: item.isDaily === true,
      })
    }
  }
  return { items: out, nextToken: result.nextToken || null }
}
