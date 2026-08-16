import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The search loader, and the DynamoDB behaviour it exists to survive.
 *
 * A FilterExpression is applied AFTER `limit`, so the resolver's limit is how
 * many index items DynamoDB reads, not how many match. A single-shot search
 * therefore reports "कोई लेख नहीं मिला" for articles that plainly exist, and
 * does it more often the older the match is — the failure is invisible on a
 * site with twelve articles and total on a site with two hundred.
 *
 * The loop in `searchPublishedArticles` is the fix, and these tests are what
 * stop someone "simplifying" it back into a bug. See the note in queries.ts.
 *
 * `./config` is mocked because the real module builds an Amplify client from
 * amplify_outputs.json and would try to reach AppSync.
 */

const searchQuery = vi.fn()
const listQuery = vi.fn()

vi.mock('./config', () => ({
  publicServerClient: () => ({
    queries: {
      searchPublishedArticles: searchQuery,
      listPublishedArticles: listQuery,
      getPublishedArticleBySlug: vi.fn(),
    },
  }),
}))

const { searchPublishedArticles } = await import('./queries')

/** One row in the shape the resolver's allowlist produces. */
const card = (id: string) => ({
  id,
  slug: `article-${id}`,
  title: `शीर्षक ${id}`,
  summary: 'सारांश',
  authorName: 'अमृत',
  publishedAt: '2026-08-01T00:00:00.000Z',
})

/** An AppSync success. The v6 client resolves rather than throws, always. */
const page = (items: unknown[], nextToken: string | null = null) => ({
  data: { items, nextToken },
  errors: undefined,
})

/** The term sent to AppSync on the nth call. */
const termOn = (call: number) => searchQuery.mock.calls[call]?.[0]?.q as string | undefined

beforeEach(() => {
  searchQuery.mockReset()
  listQuery.mockReset()
})

describe('searchPublishedArticles — pagination', () => {
  it('keeps paginating when the filter empties a page that has a nextToken', async () => {
    // THE REGRESSION TEST. DynamoDB read a page, the filter rejected all of
    // it, and the match is on the next page. Stopping here is what would make
    // a published article unfindable.
    searchQuery
      .mockResolvedValueOnce(page([], 'page-2'))
      .mockResolvedValueOnce(page([card('a')], null))

    const result = await searchPublishedArticles('चुनाव')

    expect(searchQuery).toHaveBeenCalledTimes(2)
    expect(result.items.map((item) => item.id)).toEqual(['a'])
  })

  it('does not treat a short page as the end of the results', async () => {
    // A page shorter than the read budget means "the filter rejected most of
    // what was read", not "there is no more".
    searchQuery
      .mockResolvedValueOnce(page([card('a')], 'page-2'))
      .mockResolvedValueOnce(page([card('b')], null))

    const result = await searchPublishedArticles('चुनाव', { limit: 12 })

    expect(searchQuery).toHaveBeenCalledTimes(2)
    expect(result.items.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('stops as soon as it has a full page of matches', async () => {
    // The loop is bounded by results wanted, not by tokens available — one
    // round trip is enough here and a second would be wasted read capacity.
    searchQuery.mockResolvedValue(page([card('a'), card('b'), card('c')], 'more'))

    const result = await searchPublishedArticles('चुनाव', { limit: 2 })

    expect(searchQuery).toHaveBeenCalledTimes(1)
    expect(result.items.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('stops at the page ceiling rather than walking the whole partition', async () => {
    // Denial-of-wallet guard. A term matching nothing must not cost an
    // unbounded number of Queries on a public, unauthenticated endpoint.
    searchQuery.mockResolvedValue(page([], 'endless'))

    const result = await searchPublishedArticles('चुनाव')

    expect(searchQuery).toHaveBeenCalledTimes(5)
    expect(result.items).toEqual([])
    // The token is returned rather than discarded: fewer results than exist is
    // honest, claiming there are none would not be.
    expect(result.nextToken).toBe('endless')
  })

  it('stops when the backend runs out of pages', async () => {
    searchQuery.mockResolvedValue(page([], null))

    const result = await searchPublishedArticles('चुनाव')

    expect(searchQuery).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ items: [], nextToken: null })
  })

  it('drops null and undefined list elements the generated type admits', async () => {
    searchQuery.mockResolvedValue(page([card('a'), null, undefined, card('b')], null))

    const result = await searchPublishedArticles('चुनाव')

    expect(result.items.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('searchPublishedArticles — the term', () => {
  it('NFC-normalises before sending, or the term matches nothing at all', async () => {
    searchQuery.mockResolvedValue(page([], null))

    /**
     * Built from code points rather than typed as literal Devanagari.
     *
     * The two forms are visually identical, so an editor or formatter that
     * normalises this source file would silently rewrite one into the other
     * and turn the assertion below into `x !== x`. That is not hypothetical —
     * it happened while this test was being written.
     *
     * U+0958 क़ is a composition exclusion: NFC turns it INTO क + nukta
     * (U+0915 U+093C), which is the form stored titles are in. APPSYNC_JS has
     * no String.normalize, so this is the last place the correction can happen.
     */
    const qaPrecomposed = String.fromCodePoint(0x0958)
    const qaDecomposed = String.fromCodePoint(0x0915, 0x093c)
    const precomposed = `${qaPrecomposed}\u093E\u0928\u0942\u0928`
    const decomposed = `${qaDecomposed}\u093E\u0928\u0942\u0928`

    await searchPublishedArticles(precomposed)

    expect(termOn(0)).toBe(decomposed)
    expect(termOn(0)).not.toBe(precomposed)
  })

  it('trims before sending', async () => {
    searchQuery.mockResolvedValue(page([], null))
    await searchPublishedArticles('   चुनाव   ')
    expect(termOn(0)).toBe('चुनाव')
  })

  it('caps an over-long term instead of letting the resolver reject it', async () => {
    searchQuery.mockResolvedValue(page([], null))
    await searchPublishedArticles('क'.repeat(500))
    expect(termOn(0)).toHaveLength(80)
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['a single character', 'क'],
  ])('short-circuits a %s term without a round trip', async (_label, term) => {
    const result = await searchPublishedArticles(term)

    // Not an error worth a network hop and a CloudWatch line.
    expect(searchQuery).not.toHaveBeenCalled()
    expect(result).toEqual({ items: [], nextToken: null })
  })

  it('reads with the public API key', async () => {
    searchQuery.mockResolvedValue(page([], null))
    await searchPublishedArticles('चुनाव')
    expect(searchQuery.mock.calls[0]?.[1]).toEqual({ authMode: 'apiKey' })
  })

  it('asks for a read budget far larger than the page of results it wants', async () => {
    // If these two were the same number, the filter-after-limit trap would be
    // back: 12 index items read, most filtered out, most searches empty.
    searchQuery.mockResolvedValue(page([], null))
    await searchPublishedArticles('चुनाव', { limit: 12 })
    expect(searchQuery.mock.calls[0]?.[0]?.limit).toBe(100)
  })
})

describe('searchPublishedArticles — failure', () => {
  it('degrades to an empty page when AppSync returns errors', async () => {
    // The v6 client RESOLVES with `{ data: null, errors }` rather than
    // throwing. Code that only checks `data` renders a broken search as an
    // empty one; `unwrap` logs it and the page decides what to show.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    searchQuery.mockResolvedValue({ data: null, errors: [{ message: 'boom' }] })

    const result = await searchPublishedArticles('चुनाव')

    expect(result).toEqual({ items: [], nextToken: null })
    expect(logged).toHaveBeenCalledOnce()
  })

  it('keeps the matches it already has when a later page fails', async () => {
    // Throwing away a good first page because the second round trip failed
    // would turn a partial result into no result.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    searchQuery
      .mockResolvedValueOnce(page([card('a')], 'page-2'))
      .mockResolvedValueOnce({ data: null, errors: [{ message: 'boom' }] })

    const result = await searchPublishedArticles('चुनाव', { limit: 12 })

    expect(result.items.map((item) => item.id)).toEqual(['a'])
  })
})
