import { Logger } from '@aws-lambda-powertools/logger'
import { BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { Schema } from '../../data/resource'
import { ddb, tableName } from '../shared/ddb'

const logger = new Logger()

type Result = Schema['listPublishedArticlesByTag']['returnType']

const MAX_LIMIT = 24
const DEFAULT_LIMIT = 12
const PUBLIC_STATUSES = new Set(['PUBLISHED', 'ARCHIVED'])

export const handler: Schema['listPublishedArticlesByTag']['functionHandler'] = async (event) => {
  const tagId = String(event.arguments.tagId ?? '')
  const language = event.arguments.language === 'EN' ? 'EN' : 'HI'
  const limit = Math.min(Math.max(Number(event.arguments.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
  const nextToken = event.arguments.nextToken ?? null

  if (!tagId) return { items: [], nextToken: null } as Result

  logger.appendKeys({ tagId, language })

  const TAG_TABLE = tableName('ARTICLE_TAG_TABLE_NAME')
  const ARTICLE_TABLE = tableName('ARTICLE_TABLE_NAME')

  // The sparse tagFeedKey index only ever contains published articles —
  // publish-article REMOVES the attribute on anything else, so an unpublished
  // article is absent from the index rather than filtered out of it.
  const links = await ddb.send(
    new QueryCommand({
      TableName: TAG_TABLE,
      IndexName: 'articleTagsByTagFeedKeyAndPublishedAt',
      KeyConditionExpression: 'tagFeedKey = :key AND publishedAt <= :now',
      ExpressionAttributeValues: {
        ':key': `${tagId}#PUBLISHED#${language}`,
        ':now': new Date().toISOString(),
      },
      ProjectionExpression: 'articleId',
      ScanIndexForward: false,
      Limit: limit,
      ...(nextToken ? { ExclusiveStartKey: decodeToken(nextToken) } : {}),
    }),
  )

  const ids = (links.Items ?? []).map((link) => String(link.articleId))
  if (ids.length === 0) return { items: [], nextToken: null } as Result

  const fetched = await ddb.send(
    new BatchGetCommand({
      RequestItems: {
        [ARTICLE_TABLE]: { Keys: ids.map((id) => ({ id })) },
      },
    }),
  )

  const byId = new Map(
    (fetched.Responses?.[ARTICLE_TABLE] ?? []).map((item) => [String(item.id), item]),
  )

  // Preserve the newest-first ordering from the index — BatchGetItem does not
  // guarantee order. The status check is redundant against a sparse index, but
  // it means a stale tagFeedKey can only ever HIDE an article, never reveal an
  // unpublished one.
  const items = ids
    .map((id) => byId.get(id))
    .filter(
      (item): item is NonNullable<typeof item> =>
        !!item && PUBLIC_STATUSES.has(String(item.status)),
    )
    .map((item) => ({
      id: String(item.id),
      slug: String(item.slug ?? ''),
      title: String(item.title ?? ''),
      subtitle: item.subtitle ? String(item.subtitle) : null,
      excerpt: item.excerpt ? String(item.excerpt) : null,
      language: item.language ? String(item.language) : null,
      contentType: item.contentType ? String(item.contentType) : null,
      categoryId: item.categoryId ? String(item.categoryId) : null,
      heroImageKey: item.heroImageKey ? String(item.heroImageKey) : null,
      heroImageAlt: item.heroImageAlt ? String(item.heroImageAlt) : null,
      authorDisplayName: item.authorDisplayName ? String(item.authorDisplayName) : null,
      publishedAt: item.publishedAt ? String(item.publishedAt) : null,
      readingMinutes: item.readingMinutes ? Number(item.readingMinutes) : null,
      isBreaking: item.isBreaking === true,
      isFeatured: item.isFeatured === true,
      commentCount: Number(item.commentCount ?? 0),
      youtubeVideoId: item.youtubeVideoId ? String(item.youtubeVideoId) : null,
    }))

  logger.info('tag feed served', { returned: items.length })

  return {
    items,
    nextToken: links.LastEvaluatedKey ? encodeToken(links.LastEvaluatedKey) : null,
  } as Result
}

/** The cursor is opaque to the client, so its representation can change. */
function encodeToken(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url')
}

function decodeToken(token: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}
