import { util } from '@aws-appsync/utils'

/**
 * Public poll, stage 2: attach the options and their counts.
 *
 * APPSYNC_JS: uploaded verbatim, so no imports beyond '@aws-appsync/utils',
 * no async/await, no try/catch, no throw (use util.error), no new Date().
 */

export function request(ctx) {
  return {
    operation: 'Query',
    index: 'pollOptionsByPollIdAndDisplayOrder',
    query: {
      expression: '#pk = :pk',
      expressionNames: { '#pk': 'pollId' },
      expressionValues: util.dynamodb.toMapValues({ ':pk': ctx.stash.poll.id }),
    },
    scanIndexForward: true,
    limit: 10,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)

  const items = (ctx.result && ctx.result.items) || []
  const options = []
  for (const item of items) {
    options.push({
      id: item.id,
      label: item.label,
      description: item.description,
      displayOrder: item.displayOrder || 0,
      voteCount: item.voteCount || 0,
    })
  }

  const poll = ctx.stash.poll
  poll.options = options
  return poll
}
