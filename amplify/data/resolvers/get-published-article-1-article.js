import { util } from '@aws-appsync/utils'

/**
 * Article detail, stage 1: fetch and gate on status.
 *
 * APPSYNC_JS: uploaded verbatim, so no imports beyond '@aws-appsync/utils',
 * no async/await, no try/catch, no throw (use util.error), no new Date().
 */

const PUBLIC_STATUSES = ['PUBLISHED', 'ARCHIVED']

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
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)

  const items = (ctx.result && ctx.result.items) || []
  const article = items.length > 0 ? items[0] : null

  // A draft is indistinguishable from a missing article. ARCHIVED stays
  // readable on purpose: it has left the feeds, but its URL must keep working
  // or every inbound link and citation to it breaks.
  if (!article || PUBLIC_STATUSES.indexOf(article.status) < 0) {
    util.error('Article not found', 'NotFound')
  }

  // Explicit allowlist. internalNotes and sourceContactNotes are absent by
  // construction — they are not named here and cannot be added by accident.
  ctx.stash.article = {
    id: article.id,
    slug: article.slug,
    title: article.title,
    subtitle: article.subtitle,
    excerpt: article.excerpt,
    language: article.language,
    contentType: article.contentType,
    categoryId: article.categoryId,
    factualSummary: article.factualSummary,
    keyFacts: article.keyFacts || [],
    bodyMarkdown: article.bodyMarkdown,
    analysisMarkdown: article.analysisMarkdown,
    conclusionMarkdown: article.conclusionMarkdown,
    correctionNotice: article.correctionNotice,
    correctedAt: article.correctedAt,
    heroImageKey: article.heroImageKey,
    heroImageAlt: article.heroImageAlt,
    heroImageCredit: article.heroImageCredit,
    socialImageKey: article.socialImageKey,
    youtubeVideoId: article.youtubeVideoId,
    seoTitle: article.seoTitle,
    seoDescription: article.seoDescription,
    authorProfileId: article.authorProfileId,
    authorDisplayName: article.authorDisplayName,
    bylineOverride: article.bylineOverride,
    readingMinutes: article.readingMinutes,
    wordCount: article.wordCount,
    publishedAt: article.publishedAt,
    updatedAt: article.updatedAt,
    lastVerifiedAt: article.lastVerifiedAt,
    isBreaking: article.isBreaking === true,
    allowComments: article.allowComments !== false,
    commentCount: article.commentCount || 0,
    sources: [],
  }

  return ctx.stash.article
}
