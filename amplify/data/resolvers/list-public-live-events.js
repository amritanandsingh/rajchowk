import { util } from '@aws-appsync/utils'

/**
 * Publicly visible live events, soonest first.
 *
 * feedKey is sparse: DRAFT and CANCELLED events never have one.
 *
 * APPSYNC_JS: uploaded verbatim, so no imports beyond '@aws-appsync/utils',
 * no async/await, no try/catch, no throw (use util.error), no new Date().
 */

const MAX_LIMIT = 20
const DEFAULT_LIMIT = 10
const ALLOWED_LANGUAGES = ['HI', 'EN']

export function request(ctx) {
  const args = ctx.args || {}
  const language = ALLOWED_LANGUAGES.indexOf(args.language) >= 0 ? args.language : 'HI'

  let limit = args.limit === null || args.limit === undefined ? DEFAULT_LIMIT : args.limit
  if (limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT

  return {
    operation: 'Query',
    index: 'eventsByFeedKeyAndStartsAt',
    query: {
      expression: '#pk = :pk',
      expressionNames: { '#pk': 'feedKey' },
      expressionValues: util.dynamodb.toMapValues({ ':pk': 'PUBLIC#' + language }),
    },
    // Ascending: the next event is the one readers came for.
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
  for (const item of items) {
    out.push({
      id: item.id,
      slug: item.slug,
      title: item.title,
      description: item.description,
      language: item.language,
      status: item.status,
      coverImageKey: item.coverImageKey,
      youtubeLiveUrl: item.youtubeLiveUrl,
      replayUrl: item.replayUrl,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      registrationEnabled: item.registrationEnabled !== false,
      registrationCount: item.registrationCount || 0,
      relatedArticleId: item.relatedArticleId,
    })
  }
  return { items: out, nextToken: result.nextToken || null }
}
