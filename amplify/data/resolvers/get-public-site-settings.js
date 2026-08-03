import { util } from '@aws-appsync/utils'

/**
 * Public site settings: the breaking-news strip and featured content.
 *
 * The visibility partition key is HARD-CODED to PUBLIC. An INTERNAL setting —
 * moderation thresholds, banned-word lists, auto-hide report counts — cannot
 * be reached through this resolver even by guessing its key, which matters
 * because a commenter who can read the filter can reverse-engineer it.
 *
 * APPSYNC_JS: uploaded verbatim, so no imports beyond '@aws-appsync/utils',
 * no async/await, no try/catch, no throw (use util.error), no new Date().
 */

export function request(_ctx) {
  return {
    operation: 'Query',
    index: 'settingsByVisibility',
    query: {
      expression: '#pk = :pk',
      expressionNames: { '#pk': 'visibility' },
      expressionValues: util.dynamodb.toMapValues({ ':pk': 'PUBLIC' }),
    },
    limit: 50,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)

  const items = (ctx.result && ctx.result.items) || []
  const out = []
  for (const item of items) {
    // Redundant guard: the partition key already restricts this, but a
    // mis-set visibility on one row should hide it, not expose it.
    if (item.visibility === 'PUBLIC') {
      out.push({ settingKey: item.settingKey, valueJson: item.valueJson })
    }
  }
  return out
}
