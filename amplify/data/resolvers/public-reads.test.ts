import { describe, expect, it } from 'vitest'
// @ts-expect-error — resolvers are plain .js with no type declarations.
import * as articleFeed from './list-published-articles.js'
// @ts-expect-error
import * as categoryFeed from './list-published-articles-by-category.js'
// @ts-expect-error
import * as articleDetail from './get-published-article-1-article.js'
// @ts-expect-error
import * as articleSources from './get-published-article-2-sources.js'
// @ts-expect-error
import * as pollStage1 from './get-public-poll-1-poll.js'
// @ts-expect-error
import * as pollStage2 from './get-public-poll-2-options.js'
// @ts-expect-error
import * as comments from './list-approved-comments.js'
// @ts-expect-error
import * as questions from './list-approved-questions.js'
// @ts-expect-error
import * as liveEvents from './list-public-live-events.js'
// @ts-expect-error
import * as siteSettings from './get-public-site-settings.js'

/**
 * The APPSYNC_JS public read surface.
 *
 * These ten resolvers ARE the authorization boundary for anonymous readers:
 * the underlying models grant no public access at all, so everything a visitor
 * can see comes through here. They are plain `request`/`response` functions, so
 * they test with no AWS at all (`@aws-appsync/utils` is aliased to a stub in
 * vitest.config.mts).
 *
 * The properties under test are the ones a reviewer cannot eyeball:
 *   - the published status is composed SERVER-SIDE into the partition key and
 *     cannot be influenced by any argument;
 *   - `language` and `scope` are validated against allow-lists, so they cannot
 *     be used to reach another partition;
 *   - `limit` is clamped, so a caller cannot ask for the whole table;
 *   - the response ALLOWLISTS fields, so an editor-only field added to the
 *     model later cannot leak through.
 */

type Ctx = { args?: Record<string, unknown>; result?: unknown; error?: unknown; stash: Record<string, unknown> }

const ctx = (over: Partial<Ctx> = {}): Ctx => ({ stash: {}, ...over })

/** The full editorial row, including the fields that must never be public. */
const FULL_ARTICLE = {
  id: 'a1',
  slug: 'test-slug',
  title: 'शीर्षक',
  subtitle: 'उपशीर्षक',
  excerpt: 'सार',
  language: 'HI',
  contentType: 'NEWS',
  categoryId: 'c1',
  status: 'PUBLISHED',
  heroImageKey: 'k',
  heroImageAlt: 'alt',
  authorDisplayName: 'अमृत',
  publishedAt: '2026-08-01T00:00:00.000Z',
  readingMinutes: 4,
  isBreaking: true,
  isFeatured: false,
  commentCount: 3,
  youtubeVideoId: 'dQw4w9WgXcQ',
  // Must NEVER appear in any public projection.
  internalNotes: 'सूत्र: गोपनीय',
  sourceContactNotes: 'फ़ोन: 99999',
  feedKey: 'PUBLISHED#HI',
  ipHash: 'abc',
  bodyMarkdown: 'body',
}

const SECRET_FIELDS = ['internalNotes', 'sourceContactNotes', 'ipHash', 'feedKey']

describe('list-published-articles', () => {
  it('hard-codes the PUBLISHED partition key server-side', () => {
    const request = articleFeed.request(ctx({ args: { language: 'HI' } }))
    expect(request.operation).toBe('Query')
    expect(request.index).toBe('articlesByFeedKeyAndPublishedAt')
    expect(request.query.expressionValues[':pk']).toBe('PUBLISHED#HI')
  })

  it('cannot be steered to another status by any argument', () => {
    // There is no status argument, and injecting one changes nothing.
    const request = articleFeed.request(
      ctx({ args: { language: 'HI', status: 'DRAFT', feedKey: 'DRAFT#HI' } }),
    )
    expect(request.query.expressionValues[':pk']).toBe('PUBLISHED#HI')
    expect(request.filter.expressionValues[':published']).toBe('PUBLISHED')
  })

  it('validates language against an allow-list', () => {
    expect(articleFeed.request(ctx({ args: { language: 'EN' } })).query.expressionValues[':pk']).toBe(
      'PUBLISHED#EN',
    )
    // Anything else falls back to Hindi rather than reaching a made-up partition.
    for (const language of ['DRAFT', 'HI#EN', '', null, undefined, 'xx', 1]) {
      const request = articleFeed.request(ctx({ args: { language } }))
      expect(request.query.expressionValues[':pk'], String(language)).toBe('PUBLISHED#HI')
    }
  })

  it('bounds publishedAt at now, so a scheduled article cannot appear early', () => {
    const request = articleFeed.request(ctx({ args: {} }))
    expect(request.query.expression).toContain('#sk <= :now')
    expect(request.query.expressionValues[':now']).toBe('2026-08-03T12:00:00.000Z')
  })

  it('clamps the limit', () => {
    expect(articleFeed.request(ctx({ args: { limit: 5 } })).limit).toBe(5)
    expect(articleFeed.request(ctx({ args: { limit: 9999 } })).limit).toBe(24)
    expect(articleFeed.request(ctx({ args: { limit: 0 } })).limit).toBe(12)
    expect(articleFeed.request(ctx({ args: { limit: -1 } })).limit).toBe(12)
    expect(articleFeed.request(ctx({ args: {} })).limit).toBe(12)
  })

  it('returns newest-first', () => {
    expect(articleFeed.request(ctx({ args: {} })).scanIndexForward).toBe(false)
  })

  it('only allows a content type from the allow-list into the filter', () => {
    const allowed = articleFeed.request(ctx({ args: { contentType: 'OPINION' } }))
    expect(allowed.filter.expressionValues[':contentType']).toBe('OPINION')

    const rejected = articleFeed.request(ctx({ args: { contentType: "'; DROP TABLE" } }))
    expect(rejected.filter.expressionValues[':contentType']).toBeUndefined()
    expect(rejected.filter.expression).toBe('#status = :published')
  })

  it('ALLOWLISTS response fields — no editor-only field can leak', () => {
    const result = articleFeed.response(ctx({ result: { items: [FULL_ARTICLE] } }))
    const item = result.items[0]

    for (const field of SECRET_FIELDS) {
      expect(item, field).not.toHaveProperty(field)
    }
    expect(item).not.toHaveProperty('bodyMarkdown')
    expect(item.title).toBe('शीर्षक')
    expect(item.isBreaking).toBe(true)
  })

  it('coerces missing values rather than emitting undefined', () => {
    const result = articleFeed.response(ctx({ result: { items: [{ id: 'x' }] } }))
    expect(result.items[0].commentCount).toBe(0)
    expect(result.items[0].isBreaking).toBe(false)
    expect(result.items[0].isFeatured).toBe(false)
  })

  it('returns an empty page rather than throwing when there is nothing', () => {
    expect(articleFeed.response(ctx({ result: {} }))).toEqual({ items: [], nextToken: null })
    expect(articleFeed.response(ctx({}))).toEqual({ items: [], nextToken: null })
  })

  it('propagates a datasource error instead of returning an empty page', () => {
    // Silently returning [] would render an empty feed and hide an outage.
    expect(() =>
      articleFeed.response(ctx({ error: { message: 'boom', type: 'DynamoDB:Error' } })),
    ).toThrow('boom')
  })

  it('passes the pagination token straight through', () => {
    expect(articleFeed.request(ctx({ args: { nextToken: 'abc' } })).nextToken).toBe('abc')
  })
})

describe('list-published-articles-by-category', () => {
  it('composes the category partition key server-side', () => {
    const request = categoryFeed.request(ctx({ args: { categoryId: 'c1', language: 'HI' } }))
    expect(request.query.expressionValues[':pk']).toBe('c1#PUBLISHED#HI')
    expect(request.index).toBe('articlesByCategoryFeedKeyAndPublishedAt')
  })

  it('requires a category id', () => {
    expect(() => categoryFeed.request(ctx({ args: {} }))).toThrow(/categoryId is required/)
  })

  it('still pins the status even with a hostile category id', () => {
    const request = categoryFeed.request(ctx({ args: { categoryId: 'c1#DRAFT#HI#x' } }))
    // The suffix is always appended, so the composed key cannot resolve to a
    // draft partition.
    expect(String(request.query.expressionValues[':pk']).endsWith('#PUBLISHED#HI')).toBe(true)
    expect(request.filter.expressionValues[':published']).toBe('PUBLISHED')
  })

  it('allowlists response fields', () => {
    const result = categoryFeed.response(ctx({ result: { items: [FULL_ARTICLE] } }))
    for (const field of SECRET_FIELDS) {
      expect(result.items[0], field).not.toHaveProperty(field)
    }
  })
})

describe('get-published-article-1-article', () => {
  it('looks up by slug on the dedicated index', () => {
    const request = articleDetail.request(ctx({ args: { slug: 'test-slug' } }))
    expect(request.index).toBe('articlesBySlug')
    expect(request.query.expressionValues[':slug']).toBe('test-slug')
    expect(request.limit).toBe(1)
  })

  it('requires a slug', () => {
    expect(() => articleDetail.request(ctx({ args: {} }))).toThrow(/slug is required/)
  })

  it('serves PUBLISHED and ARCHIVED', () => {
    // ARCHIVED stays readable on purpose: it has left the feeds, but breaking
    // every inbound link and citation to it would be worse.
    for (const status of ['PUBLISHED', 'ARCHIVED']) {
      const result = articleDetail.response(
        ctx({ result: { items: [{ ...FULL_ARTICLE, status }] } }),
      )
      expect(result.id, status).toBe('a1')
    }
  })

  it.each(['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'UNPUBLISHED'])(
    'makes a %s article indistinguishable from a missing one',
    (status) => {
      expect(() =>
        articleDetail.response(ctx({ result: { items: [{ ...FULL_ARTICLE, status }] } })),
      ).toThrow(/Article not found/)
    },
  )

  it('treats no match as not found', () => {
    expect(() => articleDetail.response(ctx({ result: { items: [] } }))).toThrow(/Article not found/)
    expect(() => articleDetail.response(ctx({ result: {} }))).toThrow(/Article not found/)
  })

  it('never carries editor-only fields into the stash', () => {
    const context = ctx({ result: { items: [FULL_ARTICLE] } })
    const result = articleDetail.response(context)
    for (const field of ['internalNotes', 'sourceContactNotes', 'ipHash', 'feedKey', 'status']) {
      expect(result, field).not.toHaveProperty(field)
      expect(context.stash.article as object, field).not.toHaveProperty(field)
    }
  })

  it('does carry the editorial blocks the page needs', () => {
    const result = articleDetail.response(ctx({ result: { items: [FULL_ARTICLE] } }))
    expect(result.bodyMarkdown).toBe('body')
    expect(result.sources).toEqual([])
  })
})

describe('get-published-article-2-sources', () => {
  it('queries sources for the article stashed by stage 1', () => {
    const request = articleSources.request(ctx({ stash: { article: { id: 'a1' } } }))
    expect(request.index).toBe('articleSourcesByArticleAndOrder')
    expect(request.query.expressionValues[':pk']).toBe('a1')
    expect(request.scanIndexForward).toBe(true)
  })

  it('attaches the sources to the stashed article', () => {
    const context = ctx({
      stash: { article: { id: 'a1', sources: [] } },
      result: { items: [{ id: 's1', title: 'स्रोत', url: 'https://example.com', displayOrder: 1 }] },
    })
    const result = articleSources.response(context)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].title).toBe('स्रोत')
  })

  it('returns the article with no sources when there are none', () => {
    const context = ctx({ stash: { article: { id: 'a1', sources: [] } }, result: { items: [] } })
    expect(articleSources.response(context).sources).toEqual([])
  })
})

describe('get-public-poll', () => {
  it('fetches the poll by id', () => {
    const request = pollStage1.request(ctx({ args: { pollId: 'p1' } }))
    expect(request.operation).toBe('GetItem')
    expect(request.key.id).toBe('p1')
  })

  it('requires a poll id', () => {
    expect(() => pollStage1.request(ctx({ args: {} }))).toThrow(/pollId is required/)
  })

  it('serves OPEN and CLOSED polls', () => {
    for (const status of ['OPEN', 'CLOSED']) {
      const result = pollStage1.response(ctx({ result: { id: 'p1', question: 'q', status } }))
      expect(result.status, status).toBe(status)
    }
  })

  it.each(['DRAFT', 'ARCHIVED'])('makes a %s poll indistinguishable from a missing one', (status) => {
    expect(() => pollStage1.response(ctx({ result: { id: 'p1', status } }))).toThrow(
      /Poll not found/,
    )
  })

  it('attaches options with their counts, ordered', () => {
    const stage1 = ctx({ result: { id: 'p1', question: 'q', status: 'OPEN' } })
    pollStage1.response(stage1)

    const request = pollStage2.request(stage1)
    expect(request.index).toBe('pollOptionsByPollIdAndDisplayOrder')
    expect(request.scanIndexForward).toBe(true)

    stage1.result = {
      items: [
        { id: 'o1', label: 'हाँ', displayOrder: 0, voteCount: 12 },
        { id: 'o2', label: 'नहीं', displayOrder: 1 },
      ],
    }
    const result = pollStage2.response(stage1)
    expect(result.options).toHaveLength(2)
    expect(result.options[0].voteCount).toBe(12)
    // A never-voted option reads as 0, not undefined.
    expect(result.options[1].voteCount).toBe(0)
  })
})

describe('list-approved-comments', () => {
  it('reads the sparse APPROVED partition composed server-side', () => {
    // Moderation REMOVES threadKey, so a pending or hidden comment is absent
    // from this index rather than filtered out of it.
    const request = comments.request(ctx({ args: { articleId: 'a1' } }))
    expect(request.index).toBe('commentsByThreadKeyAndCreatedAt')
    expect(request.query.expressionValues[':pk']).toBe('a1#APPROVED')
  })

  it('cannot be steered to another status', () => {
    const request = comments.request(ctx({ args: { articleId: 'a1', status: 'PENDING' } }))
    expect(request.query.expressionValues[':pk']).toBe('a1#APPROVED')
  })

  it('requires an article id and clamps the limit', () => {
    expect(() => comments.request(ctx({ args: {} }))).toThrow(/articleId is required/)
    expect(comments.request(ctx({ args: { articleId: 'a1', limit: 9999 } })).limit).toBe(50)
    expect(comments.request(ctx({ args: { articleId: 'a1' } })).limit).toBe(20)
  })

  it('reads oldest-first, so a conversation reads top to bottom', () => {
    expect(comments.request(ctx({ args: { articleId: 'a1' } })).scanIndexForward).toBe(true)
  })

  it('omits moderation metadata from the public projection', () => {
    const result = comments.response(
      ctx({
        result: {
          items: [
            {
              id: 'c1',
              articleId: 'a1',
              authorDisplayName: 'सदस्य',
              content: 'टिप्पणी',
              depth: 0,
              ipHash: 'secret',
              contentHash: 'secret',
              moderatedBySub: 'mod-1',
              moderationNote: 'internal',
              status: 'APPROVED',
              threadKey: 'a1#APPROVED',
            },
          ],
        },
      }),
    )
    for (const field of ['ipHash', 'contentHash', 'moderatedBySub', 'moderationNote', 'threadKey']) {
      expect(result.items[0], field).not.toHaveProperty(field)
    }
    expect(result.items[0].content).toBe('टिप्पणी')
  })
})

describe('list-approved-questions', () => {
  it('defaults to the global board', () => {
    expect(questions.request(ctx({ args: {} })).query.expressionValues[':pk']).toBe(
      'GLOBAL#APPROVED',
    )
  })

  it('accepts only an EVENT# scope, coercing anything else to GLOBAL', () => {
    expect(
      questions.request(ctx({ args: { scope: 'EVENT#e1' } })).query.expressionValues[':pk'],
    ).toBe('EVENT#e1#APPROVED')

    for (const scope of ['PENDING', 'x', '', 'GLOBAL#PENDING', 42]) {
      expect(
        questions.request(ctx({ args: { scope } })).query.expressionValues[':pk'],
        String(scope),
      ).toBe('GLOBAL#APPROVED')
    }
  })

  it('ranks by upvote count, which is the point of the board', () => {
    const request = questions.request(ctx({ args: {} }))
    expect(request.index).toBe('questionsByQueueKeyAndUpvoteCount')
    expect(request.scanIndexForward).toBe(false)
  })

  it('omits the asker identity and moderation notes', () => {
    const result = questions.response(
      ctx({
        result: {
          items: [
            {
              id: 'q1',
              questionText: 'सवाल',
              askerDisplayName: 'सदस्य',
              askerProfileId: 'sub-1',
              ipHash: 'secret',
              moderationNote: 'internal',
              queueKey: 'GLOBAL#APPROVED',
              upvoteCount: 7,
            },
          ],
        },
      }),
    )
    for (const field of ['askerProfileId', 'ipHash', 'moderationNote', 'queueKey']) {
      expect(result.items[0], field).not.toHaveProperty(field)
    }
    expect(result.items[0].upvoteCount).toBe(7)
  })
})

describe('list-public-live-events', () => {
  it('reads the sparse PUBLIC partition, so DRAFT events are absent', () => {
    const request = liveEvents.request(ctx({ args: { language: 'HI' } }))
    expect(request.index).toBe('eventsByFeedKeyAndStartsAt')
    expect(request.query.expressionValues[':pk']).toBe('PUBLIC#HI')
  })

  it('validates language and clamps the limit', () => {
    expect(liveEvents.request(ctx({ args: { language: 'zz' } })).query.expressionValues[':pk']).toBe(
      'PUBLIC#HI',
    )
    expect(liveEvents.request(ctx({ args: { limit: 999 } })).limit).toBe(20)
  })

  it('lists soonest-first', () => {
    expect(liveEvents.request(ctx({ args: {} })).scanIndexForward).toBe(true)
  })
})

describe('get-public-site-settings', () => {
  it('pins the visibility partition to PUBLIC', () => {
    // An INTERNAL setting — moderation thresholds, banned-word lists — must be
    // unreachable even to someone who knows its key.
    const request = siteSettings.request(ctx({ args: { visibility: 'INTERNAL' } }))
    expect(request.query.expressionValues[':pk']).toBe('PUBLIC')
  })

  it('filters out anything not marked PUBLIC, as a second guard', () => {
    const result = siteSettings.response(
      ctx({
        result: {
          items: [
            { settingKey: 'BREAKING_NEWS', visibility: 'PUBLIC', valueJson: { text: 'खबर' } },
            { settingKey: 'MODERATION_POLICY', visibility: 'INTERNAL', valueJson: { threshold: 3 } },
          ],
        },
      }),
    )
    expect(result).toHaveLength(1)
    expect(result[0].settingKey).toBe('BREAKING_NEWS')
  })

  it('returns an empty list when there is nothing public', () => {
    expect(siteSettings.response(ctx({ result: { items: [] } }))).toEqual([])
    expect(siteSettings.response(ctx({}))).toEqual([])
  })
})

describe('every resolver', () => {
  const ALL = [
    ['list-published-articles', articleFeed],
    ['list-published-articles-by-category', categoryFeed],
    ['get-published-article-1-article', articleDetail],
    ['get-published-article-2-sources', articleSources],
    ['get-public-poll-1-poll', pollStage1],
    ['get-public-poll-2-options', pollStage2],
    ['list-approved-comments', comments],
    ['list-approved-questions', questions],
    ['list-public-live-events', liveEvents],
    ['get-public-site-settings', siteSettings],
  ] as const

  it.each(ALL)('%s exports exactly request and response', (_name, mod) => {
    expect(typeof mod.request).toBe('function')
    expect(typeof mod.response).toBe('function')
  })

  it.each(ALL)('%s surfaces a datasource error rather than swallowing it', (_name, mod) => {
    expect(() =>
      mod.response({ stash: { article: { id: 'a' }, poll: { id: 'p' } }, error: { message: 'boom' } }),
    ).toThrow()
  })
})
