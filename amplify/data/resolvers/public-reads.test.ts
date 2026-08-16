import { describe, expect, it } from 'vitest'

import { AppSyncError } from '../../../tests/stubs/appsync-utils'
import * as feed from './list-published-articles.js'
import * as search from './search-published-articles.js'
import * as detail from './get-published-article.js'
import * as adminList from './list-admin-articles.js'

/**
 * The public read boundary.
 *
 * These three resolvers ARE the security model for anonymous visitors: the
 * `Article` model carries no API-key authorization at all, so everything a
 * reader can ever see passes through the code under test here. A regression in
 * one of these files is a data leak, not a rendering bug — which is why they
 * are tested directly rather than only through the pages that call them.
 *
 * `@aws-appsync/utils` is stubbed (see tests/stubs/appsync-utils.ts) because
 * the real `util` is injected by the APPSYNC_JS runtime rather than shipped by
 * the package. `util.error` throws in the stub so refusal is assertable.
 */

const ctx = (args: Record<string, unknown> = {}) => ({ args })

describe('listPublishedArticles — request', () => {
  it('hard-codes the PUBLISHED partition key server-side', () => {
    // THE central property. The caller supplies no part of this, and there is
    // no argument that carries a status, so reaching the DRAFT partition is
    // not filtered — it is unrepresentable.
    const request = feed.request(ctx())
    expect(request.query.expressionValues[':pk']).toBe('PUBLISHED')
    expect(request.query.expressionNames['#pk']).toBe('feedKey')
  })

  it('ignores any caller-supplied status or feedKey', () => {
    // A caller trying the obvious thing gets the published feed regardless.
    const request = feed.request(ctx({ status: 'DRAFT', feedKey: 'DRAFT', pk: 'DRAFT' }))
    expect(request.query.expressionValues[':pk']).toBe('PUBLISHED')
  })

  it('applies a redundant status filter as well as the partition key', () => {
    // Defence in depth: a stale feedKey could then only ever HIDE a published
    // article, never reveal an unpublished one.
    const request = feed.request(ctx())
    expect(request.filter.expression).toBe('#status = :published')
    expect(request.filter.expressionValues[':published']).toBe('PUBLISHED')
  })

  it('queries the sorted index newest-first, never a Scan', () => {
    const request = feed.request(ctx())
    expect(request.operation).toBe('Query')
    expect(request.index).toBe('articlesByFeedKeyAndPublishedAt')
    expect(request.scanIndexForward).toBe(false)
  })

  it('bounds the sort key at now so a future publishedAt stays out of the feed', () => {
    const request = feed.request(ctx())
    expect(request.query.expression).toContain('#sk <= :now')
    expect(request.query.expressionValues[':now']).toBe('2026-08-03T12:00:00.000Z')
  })

  it.each([
    ['absent', undefined, 12],
    ['null', null, 12],
    ['zero', 0, 12],
    ['negative', -5, 12],
    ['in range', 5, 5],
    ['at the cap', 24, 24],
    ['over the cap', 1000, 24],
  ])('clamps a %s limit', (_label, limit, expected) => {
    // The clamp protects DynamoDB read capacity from a caller asking for
    // everything. It is duplicated in queries.ts; this is the one that counts.
    expect(feed.request(ctx({ limit })).limit).toBe(expected)
  })

  it('passes the pagination token through unchanged', () => {
    expect(feed.request(ctx({ nextToken: 'abc' })).nextToken).toBe('abc')
  })
})

describe('listPublishedArticles — response', () => {
  const row = {
    id: 'a1',
    slug: 'delhi-verdict',
    title: 'शीर्षक',
    summary: 'सारांश',
    authorName: 'अमृत',
    publishedAt: '2026-08-01T00:00:00.000Z',
    // Fields that must NOT escape:
    authorSub: 'cognito-sub-value',
    content: 'पूरा लेख',
    status: 'PUBLISHED',
    feedKey: 'PUBLISHED',
    statusKey: 'PUBLISHED',
  }

  it('returns exactly the allowlisted fields', () => {
    const result = adaptResponse(feed.response({ result: { items: [row] } }))
    expect(Object.keys(result.items[0]).sort()).toEqual([
      'authorName',
      'id',
      'publishedAt',
      'slug',
      'summary',
      'title',
    ])
  })

  it('never leaks authorSub or the full content through the feed', () => {
    // The allowlist is what makes a future field on Article unable to reach a
    // reader without someone editing this resolver too.
    const item = adaptResponse(feed.response({ result: { items: [row] } })).items[0]
    expect(item).not.toHaveProperty('authorSub')
    expect(item).not.toHaveProperty('content')
    expect(item).not.toHaveProperty('feedKey')
  })

  it('returns an empty page rather than null when there are no items', () => {
    const result = adaptResponse(feed.response({ result: {} }))
    expect(result).toEqual({ items: [], nextToken: null })
  })

  it('surfaces a DynamoDB error rather than swallowing it', () => {
    expect(() => feed.response({ error: { message: 'boom', type: 'DynamoDB:Error' } })).toThrow(
      AppSyncError,
    )
  })
})

describe('searchPublishedArticles — request', () => {
  it('hard-codes the PUBLISHED partition key, exactly as the feed does', () => {
    // Search is the feed plus a filter clause. If a search term could reach
    // the partition key, search would be the hole the feed does not have.
    const request = search.request(ctx({ q: 'चुनाव' }))
    expect(request.query.expressionValues[':pk']).toBe('PUBLISHED')
    expect(request.query.expressionNames['#pk']).toBe('feedKey')
  })

  it('ignores a caller-supplied status or feedKey alongside the term', () => {
    const request = search.request(ctx({ q: 'चुनाव', status: 'DRAFT', feedKey: 'DRAFT' }))
    expect(request.query.expressionValues[':pk']).toBe('PUBLISHED')
  })

  it('keeps the redundant status filter as well as matching the term', () => {
    // Both clauses, joined — not the term filter INSTEAD of the status filter,
    // which is the mistake that would make drafts searchable if feedKey ever
    // went stale.
    const request = search.request(ctx({ q: 'चुनाव' }))
    expect(request.filter.expression).toBe(
      '#status = :published AND (contains(#title, :q) OR contains(#summary, :q))',
    )
    expect(request.filter.expressionValues[':published']).toBe('PUBLISHED')
    expect(request.filter.expressionValues[':q']).toBe('चुनाव')
  })

  it('matches title and summary, and nothing else', () => {
    // `content` is absent from the feed index projection, so filtering on it
    // would match nothing and silently return an empty result set.
    const names = search.request(ctx({ q: 'चुनाव' })).filter.expressionNames
    expect(Object.values(names).sort()).toEqual(['status', 'summary', 'title'])
  })

  it('queries the same sorted index newest-first, never a Scan', () => {
    const request = search.request(ctx({ q: 'चुनाव' }))
    expect(request.operation).toBe('Query')
    expect(request.index).toBe('articlesByFeedKeyAndPublishedAt')
    expect(request.scanIndexForward).toBe(false)
  })

  it('bounds the sort key at now so a future-dated article stays unsearchable', () => {
    const request = search.request(ctx({ q: 'चुनाव' }))
    expect(request.query.expression).toContain('#sk <= :now')
    expect(request.query.expressionValues[':now']).toBe('2026-08-03T12:00:00.000Z')
  })

  it('trims the term before matching', () => {
    expect(search.request(ctx({ q: '  चुनाव  ' })).filter.expressionValues[':q']).toBe('चुनाव')
  })

  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace only', '   '],
    ['a single character', 'क'],
    ['a non-string', 42],
  ])('refuses a %s term rather than reading unfiltered', (_label, q) => {
    // The failure mode this prevents: an empty term makes `contains` match
    // everything, turning this into a second, unclamped copy of the feed.
    expect(() => search.request(ctx({ q }))).toThrow(AppSyncError)
  })

  it('refuses an over-long term', () => {
    expect(() => search.request(ctx({ q: 'क'.repeat(81) }))).toThrow(AppSyncError)
  })

  it.each([
    ['absent', undefined, 100],
    ['null', null, 100],
    ['zero', 0, 100],
    ['negative', -5, 100],
    ['in range', 50, 50],
    ['over the cap', 5000, 200],
  ])('clamps a %s read budget', (_label, limit, expected) => {
    // This limit is how many index items DynamoDB READS, not how many match —
    // the filter runs after it. It is deliberately much larger than a page of
    // results; lowering it to a page size is what makes search miss matches.
    expect(search.request(ctx({ q: 'चुनाव', limit })).limit).toBe(expected)
  })

  it('passes the pagination token through unchanged', () => {
    expect(search.request(ctx({ q: 'चुनाव', nextToken: 'abc' })).nextToken).toBe('abc')
  })
})

describe('searchPublishedArticles — response', () => {
  const row = {
    id: 'a1',
    slug: 'delhi-verdict',
    title: 'शीर्षक',
    summary: 'सारांश',
    authorName: 'अमृत',
    publishedAt: '2026-08-01T00:00:00.000Z',
    authorSub: 'cognito-sub-value',
    content: 'पूरा लेख',
    status: 'PUBLISHED',
    feedKey: 'PUBLISHED',
  }

  it('returns the same allowlist as the feed', () => {
    // Byte-identical to the feed's list. Two public shapes that drift apart is
    // how a field leaks through one surface but not the other.
    const result = adaptResponse(search.response({ result: { items: [row] } }))
    expect(Object.keys(result.items[0]).sort()).toEqual([
      'authorName',
      'id',
      'publishedAt',
      'slug',
      'summary',
      'title',
    ])
  })

  it('never leaks authorSub or the full content through a search result', () => {
    const item = adaptResponse(search.response({ result: { items: [row] } })).items[0]
    expect(item).not.toHaveProperty('authorSub')
    expect(item).not.toHaveProperty('content')
    expect(item).not.toHaveProperty('feedKey')
  })

  it('returns an empty page with its nextToken when the filter rejected everything', () => {
    // NOT a bug and NOT the end of the results. DynamoDB filters after the
    // limit, so a page can be empty while matches wait on the next one — the
    // caller must keep paginating. This is the contract queries.ts relies on.
    const result = adaptResponse(search.response({ result: { items: [], nextToken: 'more' } }))
    expect(result).toEqual({ items: [], nextToken: 'more' })
  })

  it('surfaces a DynamoDB error rather than swallowing it', () => {
    expect(() => search.response({ error: { message: 'boom', type: 'DynamoDB:Error' } })).toThrow(
      AppSyncError,
    )
  })
})

describe('getPublishedArticleBySlug', () => {
  const published = {
    id: 'a1',
    slug: 'delhi-verdict',
    title: 'शीर्षक',
    summary: 'सारांश',
    content: 'पूरा लेख',
    authorName: 'अमृत',
    status: 'PUBLISHED',
    publishedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    authorSub: 'cognito-sub-value',
  }

  it('queries the slug index, not a Scan', () => {
    const request = detail.request(ctx({ slug: 'delhi-verdict' }))
    expect(request.operation).toBe('Query')
    expect(request.index).toBe('articlesBySlug')
    expect(request.limit).toBe(1)
  })

  it('rejects a missing slug', () => {
    expect(() => detail.request(ctx({}))).toThrow(AppSyncError)
  })

  it('returns a published article with only allowlisted fields', () => {
    const result = detail.response({ result: { items: [published] } })
    expect(Object.keys(result).sort()).toEqual([
      'authorName',
      'content',
      'id',
      'publishedAt',
      'slug',
      'summary',
      'title',
      'updatedAt',
    ])
    expect(result).not.toHaveProperty('authorSub')
  })

  it('reports a DRAFT as NotFound', () => {
    // Not Forbidden. "Forbidden" would confirm the slug exists, turning the
    // article page into an oracle for enumerating unpublished headlines.
    expect(() =>
      detail.response({ result: { items: [{ ...published, status: 'DRAFT' }] } }),
    ).toThrow(/not found/i)
  })

  it('reports a MISSING article with the same error as a draft', () => {
    // Byte-identical failure for both, which is what closes the oracle.
    const draft = captureError(() =>
      detail.response({ result: { items: [{ ...published, status: 'DRAFT' }] } }),
    )
    const missing = captureError(() => detail.response({ result: { items: [] } }))

    expect(draft.message).toBe(missing.message)
    expect(draft.errorType).toBe(missing.errorType)
  })

  it('treats an article with NO status as not found', () => {
    // Fail closed: an absent status is a draft everywhere else in this system.
    const { status: _status, ...withoutStatus } = published
    expect(() => detail.response({ result: { items: [withoutStatus] } })).toThrow(/not found/i)
  })
})

describe('listArticlesForAdmin', () => {
  it('queries the admin index most-recently-edited first', () => {
    const request = adminList.request(ctx({ status: 'DRAFT' }))
    expect(request.operation).toBe('Query')
    expect(request.index).toBe('articlesByStatusKeyAndUpdatedAt')
    expect(request.query.expressionValues[':pk']).toBe('DRAFT')
    expect(request.scanIndexForward).toBe(false)
  })

  it.each(['DRAFT', 'PUBLISHED'])('accepts the valid status %s', (status) => {
    expect(adminList.request(ctx({ status })).query.expressionValues[':pk']).toBe(status)
  })

  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['unknown', 'ARCHIVED'],
    ['lowercase', 'draft'],
    ['an injection attempt', 'DRAFT OR 1=1'],
  ])('rejects the %s status rather than defaulting', (_label, status) => {
    // `statusKey` is a partition key. An unvalidated argument reaching one is
    // how a caller ends up in a partition nobody intended — and silently
    // defaulting would list drafts to someone who asked for something else.
    expect(() => adminList.request(ctx({ status }))).toThrow(AppSyncError)
  })

  it('defaults a missing item status to DRAFT in the response', () => {
    const result = adminList.response({
      result: { items: [{ id: 'a1', slug: 's', title: 't', summary: 'x' }] },
    })
    expect(result.items[0].status).toBe('DRAFT')
  })

  it.each([
    ['absent', undefined, 25],
    ['over the cap', 500, 50],
    ['in range', 10, 10],
  ])('clamps a %s limit', (_label, limit, expected) => {
    expect(adminList.request(ctx({ status: 'DRAFT', limit })).limit).toBe(expected)
  })
})

/** The resolvers are untyped .js; this names the shape for the assertions. */
function adaptResponse(value: unknown) {
  return value as { items: Array<Record<string, unknown>>; nextToken: string | null }
}

function captureError(run: () => unknown): AppSyncError {
  try {
    run()
  } catch (error) {
    if (error instanceof AppSyncError) return error
    throw error
  }
  throw new Error('expected the resolver to reject, but it returned')
}
