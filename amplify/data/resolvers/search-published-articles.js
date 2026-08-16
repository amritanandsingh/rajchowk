import { util } from '@aws-appsync/utils'

/**
 * Search the public feed by title and summary. Newest match first.
 *
 * APPSYNC_JS CONSTRAINTS — see list-published-articles.js for the full list.
 * The short version: .js only, no async/await, no try/catch, no throw (use
 * util.error), no new Date(), nothing importable but '@aws-appsync/utils',
 * exactly two exports. ESLint enforces all of it.
 *
 * SECURITY. This is the feed resolver with one extra filter clause, and it
 * keeps every property that makes the feed safe. The partition key is still
 * the literal 'PUBLISHED' written here, derived from nothing the caller sent,
 * so no search term can widen the read past published work. The index is
 * still SPARSE — a draft has no entry at all — so a draft headline cannot be
 * probed for by searching a word from it. The response allowlist below is
 * character-for-character the feed's, so `content` and `authorSub` remain
 * absent by construction rather than by filtering.
 *
 * WHY title AND summary, AND NOT content. The feed index projects
 * INCLUDE ['slug','title','summary','authorName','status','updatedAt'] —
 * `content` is deliberately not in it, so a body search would have to fetch
 * every matching row from the base table. Searching the projection costs one
 * Query. Adding `content` to the projection would mean deleting and
 * recreating the GSI, which takes the live feed down.
 *
 * CASE SENSITIVITY, stated plainly. DynamoDB `contains` is case-sensitive and
 * has no `lower()`. Devanagari is caseless, so Hindi search is unaffected —
 * but a code-mixed Latin headline will not match on the wrong case ("Modi"
 * vs "modi"). The real fix is a lowercased `searchText` shadow attribute
 * written by the save Lambda, which would also have to join the GSI
 * projection — same GSI rebuild, same downtime. Documented rather than
 * half-fixed.
 *
 * NFC. Article text is NFC-normalised on write (normalizeArticleInput in
 * src/lib/domain/article.ts). `String.prototype.normalize` is not available
 * in the APPSYNC_JS runtime, so the CALLER normalises the term before it gets
 * here — see searchPublishedArticles in src/lib/amplify/queries.ts. A
 * decomposed matra arriving here will simply not match, which is why that is
 * not left to chance.
 *
 * PAGINATION. `limit` here is how many index items DynamoDB READS, not how
 * many it returns: the filter is applied AFTER the limit. A page can come
 * back empty and still carry a nextToken. The default is deliberately far
 * larger than a page of results for that reason, and the caller loops until
 * it has enough. Do not lower it to a page size.
 */

/** Read budget per round trip, in index items — not in results. ~1 KB per
 *  item, so 200 stays well inside DynamoDB's 1 MB page ceiling. */
const MAX_LIMIT = 200
const DEFAULT_LIMIT = 100

/** One character matches nearly everything and costs a full partition read
 *  to prove it. Two is the shortest term worth a query. */
const MIN_TERM = 2
/** Mirrors the maxLength on the input. A longer term is a probe, not a
 *  search — every article title is capped at 300 characters. */
const MAX_TERM = 80

const PUBLISHED = 'PUBLISHED'

export function request(ctx) {
  const args = ctx.args || {}

  const raw = typeof args.q === 'string' ? args.q : ''
  const q = raw.trim()

  // Fail rather than fall through. A resolver that treats an empty term as
  // "no filter" turns this query into a second, unpaginated feed.
  if (q.length < MIN_TERM) {
    util.error('A search term of at least 2 characters is required', 'BadRequest')
  }
  if (q.length > MAX_TERM) {
    util.error('Search term is too long', 'BadRequest')
  }

  let limit = args.limit === null || args.limit === undefined ? DEFAULT_LIMIT : args.limit
  if (limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT

  const now = util.time.nowISO8601()

  return {
    operation: 'Query',
    index: 'articlesByFeedKeyAndPublishedAt',
    query: {
      // Identical to the feed's, including the future-dated guard: an article
      // scheduled for tomorrow must not surface in search either.
      expression: '#pk = :pk AND #sk <= :now',
      expressionNames: { '#pk': 'feedKey', '#sk': 'publishedAt' },
      expressionValues: util.dynamodb.toMapValues({ ':pk': PUBLISHED, ':now': now }),
    },
    filter: {
      // The status clause is the feed's redundant guard, kept for the same
      // reason: a stale feedKey must only ever be able to HIDE a published
      // article, never reveal an unpublished one.
      expression: '#status = :published AND (contains(#title, :q) OR contains(#summary, :q))',
      expressionNames: {
        '#status': 'status',
        '#title': 'title',
        '#summary': 'summary',
      },
      expressionValues: util.dynamodb.toMapValues({ ':published': PUBLISHED, ':q': q }),
    },
    scanIndexForward: false,
    limit: limit,
    nextToken: args.nextToken,
    consistentRead: false,
  }
}

export function response(ctx) {
  if (ctx.error) {
    util.error(ctx.error.message, ctx.error.type)
  }

  const result = ctx.result || {}
  const items = result.items || []
  const out = []

  // EXPLICIT FIELD ALLOWLIST — the same one the feed uses. A field added to
  // the Article model later cannot reach an anonymous searcher without
  // someone also editing this list.
  for (const item of items) {
    out.push({
      id: item.id,
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      authorName: item.authorName,
      publishedAt: item.publishedAt,
    })
  }

  // A short page here means "the filter rejected most of what was read", not
  // "there is no more". The caller must paginate until nextToken is null.
  return { items: out, nextToken: result.nextToken || null }
}
