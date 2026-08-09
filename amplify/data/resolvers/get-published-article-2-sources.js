import { util } from '@aws-appsync/utils'

/**
 * Article detail, stage 2: attach the source list.
 *
 * ArticleSource has no public read rule of its own — a direct guest read would
 * leak the sources of an embargoed story. This stage is the only public path
 * to them, and it only runs after stage 1 has confirmed the article is public.
 *
 * APPSYNC_JS: uploaded verbatim, so no imports beyond '@aws-appsync/utils',
 * no async/await, no try/catch, no throw (use util.error), no new Date().
 */

export function request(ctx) {
  return {
    operation: 'Query',
    index: 'articleSourcesByArticleAndOrder',
    query: {
      expression: '#pk = :pk',
      expressionNames: { '#pk': 'articleId' },
      expressionValues: util.dynamodb.toMapValues({ ':pk': ctx.stash.article.id }),
    },
    scanIndexForward: true,
    limit: 50,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)

  const items = (ctx.result && ctx.result.items) || []
  const sources = []
  for (const item of items) {
    sources.push({
      id: item.id,
      title: item.title,
      publisher: item.publisher,
      url: item.url,
      archiveUrl: item.archiveUrl,
      sourceKind: item.sourceKind,
      publishedAt: item.publishedAt,
      accessedAt: item.accessedAt,
      verificationNote: item.verificationNote,
      displayOrder: item.displayOrder || 0,
    })
  }

  const article = ctx.stash.article
  article.sources = sources
  return article
}
