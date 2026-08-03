import { randomUUID } from 'node:crypto'
import { Logger } from '@aws-lambda-powertools/logger'
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import {
  categoryFeedKeyFor,
  checkTransition,
  feedKeyFor,
  isPublishAction,
  type ArticleStatus,
} from '../../../src/lib/domain/article-status'
import type { Schema } from '../../data/resource'
import { writeAudit } from '../shared/audit'
import { amplifyItem, ddb, isConditionalCheckFailed, tableName } from '../shared/ddb'
import { hashIp } from '../shared/hash'
import { callerFrom, isAdmin, isStaff } from '../shared/identity'
import {
  markdownToPlain,
  normalizeForSearch,
  readingMinutes,
  tokenize,
  countWords,
} from '../shared/devanagari'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger()

type Result = Schema['publishArticle']['returnType']

/**
 * The publishing state machine.
 *
 * Everything that must be true at the same moment as a status change lives
 * here: the transition guard, the feed keys, the slug redirect, the revision
 * snapshot and the search index.
 *
 * The status field is Lambda-owned (field-level `.to(['read'])` in the
 * schema), so no GraphQL mutation can write it. This handler holding scoped
 * table IAM is the ONLY path that can, which is what makes `status`
 * trustworthy enough for the public feed to be gated on it.
 */
export const handler: Schema['publishArticle']['functionHandler'] = async (event) => {
  const caller = callerFrom(event.identity)
  if (!caller) return fail(CODE.UNAUTHENTICATED) as Result
  if (!isStaff(caller) && !isAdmin(caller)) return fail(CODE.FORBIDDEN) as Result

  const articleId = String(event.arguments.articleId ?? '')
  const action = String(event.arguments.action ?? '')
  const changeSummary = event.arguments.changeSummary?.trim().slice(0, 500) || undefined
  const scheduledFor = event.arguments.scheduledFor ?? undefined

  logger.appendKeys({ actorSub: caller.sub, articleId, action })

  if (!isPublishAction(action)) return fail(CODE.INVALID_INPUT) as Result

  const ARTICLE_TABLE = tableName('ARTICLE_TABLE_NAME')
  const REVISION_TABLE = tableName('ARTICLE_REVISION_TABLE_NAME')
  const REDIRECT_TABLE = tableName('ARTICLE_REDIRECT_TABLE_NAME')
  const TAG_TABLE = tableName('ARTICLE_TAG_TABLE_NAME')
  const SEARCH_DOC_TABLE = tableName('SEARCH_DOCUMENT_TABLE_NAME')
  const SEARCH_TOKEN_TABLE = tableName('SEARCH_TOKEN_TABLE_NAME')

  const article = (
    await ddb.send(new GetCommand({ TableName: ARTICLE_TABLE, Key: { id: articleId } }))
  ).Item

  if (!article) return fail(CODE.NOT_FOUND) as Result

  // A newly created Article has NO status: the field is Lambda-owned and
  // therefore unwritable by the create mutation. Absent means DRAFT, which
  // is the safe default — an article with no status is never in a feed,
  // because feedKey is only ever set here.
  const currentStatus = (article.status ? String(article.status) : 'DRAFT') as ArticleStatus

  // Only an administrator may publish, schedule, unpublish or archive. The
  // @auth directive admits editors because they legitimately submit for review
  // and return to draft; this is the check that separates those cases.
  const transition = checkTransition(currentStatus, action, isAdmin(caller))
  if (!transition.allowed) {
    logger.warn('transition refused', { reason: transition.reason, from: currentStatus })
    return fail(transition.reason === 'REQUIRES_ADMIN' ? CODE.FORBIDDEN : CODE.CONFLICT) as Result
  }

  // Editors may only act on their own drafts; admins on anything.
  if (!isAdmin(caller) && article.authorProfileId !== caller.sub) {
    return fail(CODE.FORBIDDEN) as Result
  }

  const nextStatus = transition.to
  const now = new Date().toISOString()
  const language = String(article.language ?? 'HI')
  const categoryId = String(article.categoryId ?? '')
  const slug = String(article.slug ?? '')

  // Derived content fields. Recomputed on every transition so an edit followed
  // by a publish can never ship a stale reading time or search body.
  const plain = markdownToPlain(
    [
      article.factualSummary,
      article.bodyMarkdown,
      article.analysisMarkdown,
      article.conclusionMarkdown,
    ]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join('\n\n'),
  )

  const feedKey = feedKeyFor(nextStatus, language)
  const categoryFeedKey = categoryFeedKeyFor(nextStatus, language, categoryId)
  const publishedAt =
    nextStatus === 'PUBLISHED'
      ? typeof article.publishedAt === 'string'
        ? article.publishedAt // preserve the original publication time on re-publish
        : now
      : article.publishedAt

  // ---- Status + derived fields, guarded on the current status so two
  // ---- editors acting at once cannot both win. ---------------------------
  const setClauses = [
    '#status = :next',
    'updatedAt = :now',
    'bodyPlain = :plain',
    'wordCount = :wordCount',
    'readingMinutes = :readingMinutes',
  ]
  const removeClauses: string[] = []
  const values: Record<string, unknown> = {
    ':next': nextStatus,
    ':current': currentStatus,
    ':now': now,
    ':plain': plain.slice(0, 20000),
    ':wordCount': countWords(plain),
    ':readingMinutes': readingMinutes(plain),
  }

  // Null means REMOVE the attribute, which takes the row out of the sparse
  // feed GSI entirely — the article is absent from the feed rather than
  // filtered out of it.
  if (feedKey) {
    setClauses.push('feedKey = :feedKey')
    values[':feedKey'] = feedKey
  } else {
    removeClauses.push('feedKey')
  }

  if (categoryFeedKey) {
    setClauses.push('categoryFeedKey = :categoryFeedKey')
    values[':categoryFeedKey'] = categoryFeedKey
  } else {
    removeClauses.push('categoryFeedKey')
  }

  if (publishedAt) {
    setClauses.push('publishedAt = :publishedAt')
    values[':publishedAt'] = publishedAt
  }
  if (nextStatus === 'UNPUBLISHED') {
    setClauses.push('unpublishedAt = :now')
  }
  if (nextStatus === 'SCHEDULED' && scheduledFor) {
    setClauses.push('scheduledFor = :scheduledFor')
    values[':scheduledFor'] = scheduledFor
  }

  const updateExpression =
    `SET ${setClauses.join(', ')}` +
    (removeClauses.length > 0 ? ` REMOVE ${removeClauses.join(', ')}` : '')

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: ARTICLE_TABLE,
        Key: { id: articleId },
        UpdateExpression: updateExpression,
        ConditionExpression: '#status = :current',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: values,
      }),
    )
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      logger.warn('lost a concurrent transition race')
      return fail(CODE.CONFLICT) as Result
    }
    throw error
  }

  // ---- Everything below is derived state. A failure here leaves the article
  // ---- correctly published but with a stale index, which is a much better
  // ---- outcome than a publish that half-succeeded and then rolled back.
  const revisionNumber = Number(article.revisionCount ?? 0) + 1

  await Promise.allSettled([
    writeRevision({
      table: REVISION_TABLE,
      articleId,
      revisionNumber,
      article,
      statusAtRevision: nextStatus,
      changeSummary,
      caller,
      now,
    }),
    ddb.send(
      new UpdateCommand({
        TableName: ARTICLE_TABLE,
        Key: { id: articleId },
        UpdateExpression: 'SET revisionCount = :n',
        ExpressionAttributeValues: { ':n': revisionNumber },
      }),
    ),
    syncTagFeedKeys({ table: TAG_TABLE, articleId, nextStatus, language, publishedAt, now }),
    syncSearchIndex({
      docTable: SEARCH_DOC_TABLE,
      tokenTable: SEARCH_TOKEN_TABLE,
      article,
      articleId,
      nextStatus,
      language,
      plain,
      publishedAt,
      now,
    }),
    maintainRedirect({ table: REDIRECT_TABLE, article, articleId, slug, nextStatus, now }),
  ]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error('post-publish derived write failed', { reason: String(result.reason) })
      }
    }
  })

  const ipSalt = process.env.RATE_LIMIT_IP_SALT
  await writeAudit({
    action:
      nextStatus === 'PUBLISHED'
        ? 'ARTICLE_PUBLISH'
        : nextStatus === 'UNPUBLISHED'
          ? 'ARTICLE_UNPUBLISH'
          : 'ARTICLE_UPDATE',
    caller,
    targetType: 'ARTICLE',
    targetId: articleId,
    before: { status: currentStatus },
    after: { status: nextStatus, revisionNumber },
    ...(changeSummary === undefined ? {} : { reason: changeSummary }),
    ...(caller.sourceIp && ipSalt ? { ipHash: hashIp(caller.sourceIp, ipSalt) } : {}),
  })

  logger.info('article transitioned', { from: currentStatus, to: nextStatus, revisionNumber })
  return ok({ articleId, status: nextStatus, slug, revisionNumber }) as Result
}

async function writeRevision(args: {
  table: string
  articleId: string
  revisionNumber: number
  article: Record<string, unknown>
  statusAtRevision: string
  changeSummary: string | undefined
  caller: NonNullable<ReturnType<typeof callerFrom>>
  now: string
}): Promise<void> {
  // The snapshot is the editorial content only — not counters, not feed keys.
  // A revision is a record of what was written, not of derived machinery.
  const snapshot = {
    title: args.article.title,
    subtitle: args.article.subtitle,
    excerpt: args.article.excerpt,
    factualSummary: args.article.factualSummary,
    keyFacts: args.article.keyFacts,
    bodyMarkdown: args.article.bodyMarkdown,
    analysisMarkdown: args.article.analysisMarkdown,
    conclusionMarkdown: args.article.conclusionMarkdown,
    correctionNotice: args.article.correctionNotice,
    slug: args.article.slug,
    categoryId: args.article.categoryId,
    heroImageKey: args.article.heroImageKey,
    youtubeVideoId: args.article.youtubeVideoId,
  }

  await ddb.send(
    new PutCommand({
      TableName: args.table,
      Item: amplifyItem(
        'ArticleRevision',
        {
          id: randomUUID(),
          articleId: args.articleId,
          revisionNumber: args.revisionNumber,
          snapshot,
          statusAtRevision: args.statusAtRevision,
          changeSummary: args.changeSummary,
          changedBySub: args.caller.sub,
          changedByName: args.caller.username,
        },
        args.now,
      ),
    }),
  )
}

/** Keep tag feed keys in step so a tag page never shows an unpublished story. */
async function syncTagFeedKeys(args: {
  table: string
  articleId: string
  nextStatus: ArticleStatus
  language: string
  publishedAt: unknown
  now: string
}): Promise<void> {
  const links = await ddb.send(
    new QueryCommand({
      TableName: args.table,
      KeyConditionExpression: 'articleId = :articleId',
      ExpressionAttributeValues: { ':articleId': args.articleId },
      ProjectionExpression: 'articleId, tagId',
      Limit: 50,
    }),
  )

  await Promise.all(
    (links.Items ?? []).map(async (link) => {
      const tagFeedKey =
        args.nextStatus === 'PUBLISHED' ? `${String(link.tagId)}#PUBLISHED#${args.language}` : null

      await ddb.send(
        new UpdateCommand({
          TableName: args.table,
          Key: { articleId: link.articleId, tagId: link.tagId },
          UpdateExpression: tagFeedKey
            ? 'SET tagFeedKey = :key, publishedAt = :publishedAt, updatedAt = :now'
            : 'SET updatedAt = :now REMOVE tagFeedKey, publishedAt',
          ExpressionAttributeValues: tagFeedKey
            ? {
                ':key': tagFeedKey,
                ':publishedAt': args.publishedAt ?? args.now,
                ':now': args.now,
              }
            : { ':now': args.now },
        }),
      )
    }),
  )
}

/**
 * Maintain the search index.
 *
 * Uses the SHARED devanagari module, which is the same code the query path
 * runs. If these two ever diverge, indexed documents become unreachable.
 */
async function syncSearchIndex(args: {
  docTable: string
  tokenTable: string
  article: Record<string, unknown>
  articleId: string
  nextStatus: ArticleStatus
  language: string
  plain: string
  publishedAt: unknown
  now: string
}): Promise<void> {
  const searchable = args.nextStatus === 'PUBLISHED' || args.nextStatus === 'ARCHIVED'

  if (!searchable) {
    await ddb.send(new DeleteCommand({ TableName: args.docTable, Key: { id: args.articleId } }))
    return
  }

  const title = String(args.article.title ?? '')
  const tokens = tokenize(`${title} ${args.plain}`.slice(0, 5000))

  await ddb.send(
    new PutCommand({
      TableName: args.docTable,
      Item: amplifyItem(
        'SearchDocument',
        {
          id: args.articleId,
          entityType: 'ARTICLE',
          entityId: args.articleId,
          slug: String(args.article.slug ?? ''),
          title,
          excerpt: String(args.article.excerpt ?? ''),
          language: args.language,
          contentType: String(args.article.contentType ?? 'NEWS'),
          categoryId: args.article.categoryId,
          heroImageKey: args.article.heroImageKey,
          authorDisplayName: args.article.authorDisplayName,
          readingMinutes: args.article.readingMinutes,
          publishedAt: args.publishedAt,
          titleNorm: normalizeForSearch(title),
          bodyNorm: normalizeForSearch(args.plain).slice(0, 8000),
          tokens,
          searchKey: `ARTICLE#${args.language}`,
          popularityScore: Number(args.article.viewCount ?? 0),
        },
        args.now,
      ),
    }),
  )

  // Inverted index. docSort is pre-inverted so a plain Query returns
  // newest-first with no sort-key expression.
  const epoch = Math.floor(new Date(String(args.publishedAt ?? args.now)).getTime() / 1000)
  const inverted = String(9_999_999_999 - epoch).padStart(10, '0')
  const docSort = `${inverted}#${args.articleId}`

  for (let i = 0; i < tokens.length; i += 25) {
    const chunk = tokens.slice(i, i + 25)
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [args.tokenTable]: chunk.map((token) => ({
            PutRequest: {
              Item: amplifyItem(
                'SearchToken',
                {
                  token,
                  docSort,
                  documentId: args.articleId,
                  entityType: 'ARTICLE',
                  language: args.language,
                },
                args.now,
              ),
            },
          })),
        },
      }),
    )
  }
}

/**
 * Slug redirects.
 *
 * Chains are collapsed at write time — if /a redirected to /b and the slug
 * becomes /c, both /a and /b point at /c — so a reader never takes two hops
 * and the redirect lookup stays a single GetItem.
 */
async function maintainRedirect(args: {
  table: string
  article: Record<string, unknown>
  articleId: string
  slug: string
  nextStatus: ArticleStatus
  now: string
}): Promise<void> {
  if (args.nextStatus !== 'PUBLISHED') return

  const existing = await ddb.send(
    new QueryCommand({
      TableName: args.table,
      IndexName: 'redirectsByArticleId',
      KeyConditionExpression: 'articleId = :articleId',
      ExpressionAttributeValues: { ':articleId': args.articleId },
      Limit: 25,
    }),
  )

  const stale = (existing.Items ?? []).filter((row) => row.toSlug !== args.slug)
  if (stale.length === 0) return

  await Promise.all(
    stale.map((row) =>
      ddb.send(
        new UpdateCommand({
          TableName: args.table,
          Key: { fromSlug: row.fromSlug },
          UpdateExpression: 'SET toSlug = :slug, updatedAt = :now',
          ExpressionAttributeValues: { ':slug': args.slug, ':now': args.now },
        }),
      ),
    ),
  )
}
