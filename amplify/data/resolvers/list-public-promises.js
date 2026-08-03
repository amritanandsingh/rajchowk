import { util } from '@aws-appsync/utils'

const MAX_LIMIT = 24
const DEFAULT_LIMIT = 12
const ALLOWED_LANGUAGES = ['HI', 'EN']

export function request(ctx) {
  const args = ctx.args || {}
  const language = ALLOWED_LANGUAGES.indexOf(args.language) >= 0 ? args.language : 'HI'
  let limit = args.limit === null || args.limit === undefined ? DEFAULT_LIMIT : args.limit
  if (limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT

  return {
    operation: 'Query',
    index: 'promisesByPublicKeyAndDateMade',
    query: {
      expression: '#publicKey = :publicKey',
      expressionNames: { '#publicKey': 'publicKey' },
      expressionValues: util.dynamodb.toMapValues({ ':publicKey': 'PUBLIC#' + language }),
    },
    filter: {
      expression: '#published = :published',
      expressionNames: { '#published': 'isPublished' },
      expressionValues: util.dynamodb.toMapValues({ ':published': true }),
    },
    scanIndexForward: false,
    limit: limit,
    nextToken: args.nextToken,
  }
}

function project(item) {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    politician: item.politician,
    organisation: item.organisation,
    party: item.party,
    state: item.state,
    constituency: item.constituency,
    topic: item.topic,
    language: item.language,
    promiseText: item.promiseText,
    dateMade: item.dateMade,
    targetDate: item.targetDate,
    sourceUrl: item.sourceUrl,
    assessment: item.assessment,
    assessmentMethod: item.assessmentMethod,
    evidenceKeys: item.evidenceKeys || [],
    evidenceUrls: item.evidenceUrls || [],
    lastVerifiedAt: item.lastVerifiedAt,
    status: item.status,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)
  const result = ctx.result || {}
  const items = result.items || []
  const out = []
  for (const item of items) {
    if (item.isPublished === true) out.push(project(item))
  }
  return { items: out, nextToken: result.nextToken || null }
}
