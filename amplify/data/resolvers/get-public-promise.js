import { util } from '@aws-appsync/utils'

export function request(ctx) {
  const slug = ctx.args ? ctx.args.slug : null
  if (!slug) util.error('slug is required', 'BadRequest')

  return {
    operation: 'Query',
    index: 'promisesBySlug',
    query: {
      expression: '#slug = :slug',
      expressionNames: { '#slug': 'slug' },
      expressionValues: util.dynamodb.toMapValues({ ':slug': slug }),
    },
    limit: 1,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)
  const items = (ctx.result && ctx.result.items) || []
  const item = items.length > 0 ? items[0] : null
  if (!item || item.isPublished !== true || !item.publicKey) {
    util.error('Promise not found', 'NotFound')
  }

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
