import { Logger } from '@aws-lambda-powertools/logger'
import { BatchGetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import type { Schema } from '../../data/resource'
import { ddb, tableName } from '../shared/ddb'
import { tokenize } from '../shared/devanagari'
import { enforceRateLimit, ipSubject, RATE_LIMITS } from '../shared/rate-limit'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger()

type Result = Schema['searchContent']['returnType']

/**
 * DynamoDB-backed search.
 *
 * A Lambda rather than an APPSYNC_JS resolver for one reason: it must apply
 * the EXACT normalisation the write path applied, and APPSYNC_JS resolvers
 * cannot import a shared module. Search is also not the hot path — the feed
 * is — so a cold start here is an acceptable trade.
 *
 * Cost is bounded by construction: at most MAX_TERMS index Queries plus one
 * BatchGet. There is no Scan.
 *
 * This is the seam OpenSearch swaps into later: the GraphQL contract and the
 * opaque nextToken both stay the same.
 */

/** Query the rarest terms only — they shrink the candidate set fastest. */
const MAX_TERMS = 4
const CANDIDATES_PER_TERM = 100
const MAX_LIMIT = 24
const DEFAULT_LIMIT = 12
const MAX_QUERY_LENGTH = 200

export const handler: Schema['searchContent']['functionHandler'] = async (event) => {
  const rawQuery = String(event.arguments.query ?? '').slice(0, MAX_QUERY_LENGTH)
  const entityType = event.arguments.entityType ?? 'ARTICLE'
  const language = event.arguments.language === 'EN' ? 'EN' : 'HI'
  const limit = Math.min(Math.max(Number(event.arguments.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)

  const identity = event.identity as { sub?: string; sourceIp?: string[] } | undefined
  const subject = identity?.sub ? `u_${identity.sub}` : ipSubject(identity?.sourceIp?.[0])
  const limited = await enforceRateLimit(RATE_LIMITS.search(subject))
  if (!limited.allowed) {
    // The result type requires `items`, so a rate-limited response is an empty
    // result set carrying the code rather than a bare failure.
    return fail(CODE.RATE_LIMITED, { items: [], nextToken: null, totalScanned: 0 }) as Result
  }

  // Same tokenizer as the write path. If these diverge, indexed documents
  // become permanently unreachable.
  const terms = tokenize(rawQuery, { maxTokens: MAX_TERMS })

  if (terms.length === 0) {
    return ok({ items: [], nextToken: null, totalScanned: 0 }) as Result
  }

  logger.appendKeys({ termCount: terms.length, language })

  const TOKEN_TABLE = tableName('SEARCH_TOKEN_TABLE_NAME')
  const DOC_TABLE = tableName('SEARCH_DOCUMENT_TABLE_NAME')

  // One keyed Query per term, in parallel.
  const perTerm = await Promise.all(
    terms.map(async (term) => {
      const page = await ddb.send(
        new QueryCommand({
          TableName: TOKEN_TABLE,
          KeyConditionExpression: '#token = :token',
          FilterExpression: 'entityType = :entityType AND #language = :language',
          ExpressionAttributeNames: { '#token': 'token', '#language': 'language' },
          ExpressionAttributeValues: {
            ':token': term,
            ':entityType': entityType,
            ':language': language,
          },
          // docSort is pre-inverted at write time, so ascending order is
          // newest-first with no sort-key expression.
          ScanIndexForward: true,
          Limit: CANDIDATES_PER_TERM,
        }),
      )
      return (page.Items ?? []).map((row) => String(row.documentId))
    }),
  )

  // Score by how many distinct terms matched. Documents matching every term
  // rank above documents matching one.
  const hits = new Map<string, number>()
  for (const documentIds of perTerm) {
    for (const documentId of new Set(documentIds)) {
      hits.set(documentId, (hits.get(documentId) ?? 0) + 1)
    }
  }

  const totalScanned = hits.size
  if (totalScanned === 0) {
    return ok({ items: [], nextToken: null, totalScanned: 0 }) as Result
  }

  const ranked = [...hits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([documentId, score]) => ({ documentId, score }))

  // BatchGetItem is capped at 100 keys; `limit` is at most 24, so one call.
  const fetched = await ddb.send(
    new BatchGetCommand({
      RequestItems: {
        [DOC_TABLE]: {
          Keys: ranked.map(({ documentId }) => ({ id: documentId })),
        },
      },
    }),
  )

  const documents = new Map(
    (fetched.Responses?.[DOC_TABLE] ?? []).map((doc) => [String(doc.id), doc]),
  )

  const items = ranked
    .map(({ documentId, score }) => {
      const doc = documents.get(documentId)
      if (!doc) return null
      return {
        entityType: String(doc.entityType ?? 'ARTICLE'),
        entityId: String(doc.entityId ?? documentId),
        slug: String(doc.slug ?? ''),
        title: String(doc.title ?? ''),
        excerpt: doc.excerpt ? String(doc.excerpt) : null,
        language: doc.language ? String(doc.language) : null,
        contentType: doc.contentType ? String(doc.contentType) : null,
        heroImageKey: doc.heroImageKey ? String(doc.heroImageKey) : null,
        authorDisplayName: doc.authorDisplayName ? String(doc.authorDisplayName) : null,
        publishedAt: doc.publishedAt ? String(doc.publishedAt) : null,
        // Recency nudge, so two documents matching the same number of terms
        // order newest-first.
        score: score * 100 + Math.min(Number(doc.popularityScore ?? 0), 99),
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.score - a.score)

  logger.info('search complete', { totalScanned, returned: items.length })

  // nextToken is null for now: the result set is already bounded to one page.
  // The field exists so the OpenSearch implementation can start returning a
  // cursor without changing the GraphQL contract.
  return ok({ items, nextToken: null, totalScanned }) as Result
}
