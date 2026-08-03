import { describe, expect, it } from 'vitest'
import type { PublicArticle } from '@/lib/amplify/queries'
import {
  buildArticleLd,
  buildBreadcrumbLd,
  buildOrganizationLd,
  buildPersonLd,
  buildVideoLd,
  buildWebSiteLd,
} from './jsonld'

/**
 * Structured data.
 *
 * These are pure builders (the `server-only` import is neutralised by the
 * vitest alias), so they test with no mocks. The subtype mapping is the part
 * worth pinning down: schema.org has vocabulary for exactly the fact/opinion
 * distinction this publication is built on, and tagging everything
 * `NewsArticle` would throw that away.
 */

const VIDEO_ID = 'dQw4w9WgXcQ'

function article(overrides: Partial<PublicArticle> = {}): PublicArticle {
  return {
    id: 'a1',
    slug: 'दिल्ली-में-फैसला',
    title: 'दिल्ली में बड़ा फैसला',
    excerpt: 'सुप्रीम कोर्ट का फैसला',
    language: 'HI',
    contentType: 'NEWS',
    authorDisplayName: 'अमृत',
    publishedAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T10:00:00.000Z',
    wordCount: 850,
    ...overrides,
  } as PublicArticle
}

describe('buildOrganizationLd', () => {
  it('declares a NewsMediaOrganization with a stable @id', () => {
    const ld = buildOrganizationLd()
    expect(ld['@type']).toBe('NewsMediaOrganization')
    expect(String(ld['@id'])).toMatch(/#organization$/)
  })

  it('publishes the accountability policies Google News looks for', () => {
    // These are the machine-readable half of the fact/opinion separation.
    const ld = buildOrganizationLd() as unknown as Record<string, string>
    expect(ld.ethicsPolicy).toMatch(/\/editorial-policy$/)
    expect(ld.correctionsPolicy).toMatch(/\/corrections-policy$/)
    expect(ld.publishingPrinciples).toMatch(/\/editorial-policy$/)
    expect(ld.actionableFeedbackPolicy).toMatch(/\/contact$/)
  })

  it('uses absolute URLs — a relative one is invalid in JSON-LD', () => {
    const ld = buildOrganizationLd() as unknown as Record<string, string>
    for (const key of ['url', 'logo', 'ethicsPolicy', 'correctionsPolicy']) {
      expect(ld[key], key).toMatch(/^https?:\/\//)
    }
  })
})

describe('buildWebSiteLd', () => {
  it('exposes a SearchAction pointing at the real search route', () => {
    const ld = buildWebSiteLd() as unknown as {
      potentialAction: { target: { urlTemplate: string }; 'query-input': string }
      inLanguage: string
    }
    expect(ld.potentialAction.target.urlTemplate).toContain('/search?q={search_term_string}')
    expect(ld.potentialAction['query-input']).toBe('required name=search_term_string')
    expect(ld.inLanguage).toBe('hi-IN')
  })
})

describe('buildPersonLd', () => {
  it('links the author to the organisation', () => {
    const ld = buildPersonLd({ name: 'अमृत', slug: 'amrit' }) as unknown as Record<string, unknown>
    expect(String(ld['@id'])).toMatch(/\/author\/amrit#person$/)
    expect(ld.worksFor).toEqual({ '@id': expect.stringMatching(/#organization$/) })
  })

  it('omits optional fields rather than emitting nulls', () => {
    const ld = buildPersonLd({ name: 'अमृत', slug: 'amrit' }) as unknown as Record<string, unknown>
    expect('description' in ld).toBe(false)
    expect('image' in ld).toBe(false)
  })

  it('includes bio and image when supplied', () => {
    const ld = buildPersonLd({
      name: 'अमृत',
      slug: 'amrit',
      bio: 'पत्रकार',
      imageUrl: 'https://example.com/a.jpg',
    }) as unknown as Record<string, unknown>
    expect(ld.description).toBe('पत्रकार')
    expect(ld.image).toBe('https://example.com/a.jpg')
  })
})

describe('buildArticleLd — subtype mapping', () => {
  it.each([
    ['NEWS', 'ReportageNewsArticle'],
    ['OPINION', 'OpinionNewsArticle'],
    ['EDITORIAL', 'OpinionNewsArticle'],
    ['ANALYSIS', 'AnalysisNewsArticle'],
    ['EXPLAINER', 'BackgroundNewsArticle'],
    ['FACT_CHECK', 'BackgroundNewsArticle'],
    ['INTERVIEW', 'ReportageNewsArticle'],
  ])('maps contentType %s to %s', (contentType, expected) => {
    const ld = buildArticleLd(article({ contentType } as Partial<PublicArticle>), { path: '/news/x' })
    expect(ld['@type']).toBe(expected)
  })

  it('marks opinion as opinion — the distinction the product exists for', () => {
    const news = buildArticleLd(article({ contentType: 'NEWS' } as Partial<PublicArticle>), {
      path: '/news/x',
    })
    const opinion = buildArticleLd(article({ contentType: 'OPINION' } as Partial<PublicArticle>), {
      path: '/opinion/x',
    })
    expect(news['@type']).not.toBe(opinion['@type'])
  })

  it('falls back to reportage for an unknown content type', () => {
    const ld = buildArticleLd(article({ contentType: 'WHATEVER' } as Partial<PublicArticle>), {
      path: '/news/x',
    })
    expect(ld['@type']).toBe('ReportageNewsArticle')
  })
})

describe('buildArticleLd — fields', () => {
  it('builds absolute url, @id and mainEntityOfPage from the path', () => {
    const ld = buildArticleLd(article(), { path: '/news/x' }) as unknown as Record<string, string>
    expect(ld.url).toMatch(/^https?:\/\/.*\/news\/x$/)
    expect(ld['@id']).toBe(`${ld.url}#article`)
    expect(ld.mainEntityOfPage).toBe(ld.url)
  })

  it('truncates the headline at 110 characters, which is where Google cuts', () => {
    const ld = buildArticleLd(article({ title: 'क'.repeat(300) }), { path: '/news/x' })
    expect(String(ld.headline).length).toBe(110)
  })

  it('maps the article language to a BCP 47 tag', () => {
    expect(buildArticleLd(article({ language: 'HI' }), { path: '/n/x' }).inLanguage).toBe('hi-IN')
    expect(buildArticleLd(article({ language: 'EN' }), { path: '/n/x' }).inLanguage).toBe('en-IN')
  })

  it('emits a correction ONLY when both the notice and its date exist', () => {
    // A correction with no date is not machine-readable, and a date with no
    // text is meaningless — so neither alone should produce the node.
    expect(buildArticleLd(article(), { path: '/n/x' }).correction).toBeUndefined()

    expect(
      buildArticleLd(article({ correctionNotice: 'सुधार' }), { path: '/n/x' }).correction,
    ).toBeUndefined()

    expect(
      buildArticleLd(article({ correctedAt: '2026-08-02T00:00:00.000Z' }), { path: '/n/x' })
        .correction,
    ).toBeUndefined()

    const corrected = buildArticleLd(
      article({ correctionNotice: 'तारीख़ ठीक की गई', correctedAt: '2026-08-02T00:00:00.000Z' }),
      { path: '/n/x' },
    )
    expect(corrected.correction).toMatchObject({
      '@type': 'CorrectionComment',
      text: 'तारीख़ ठीक की गई',
      datePublished: '2026-08-02T00:00:00.000Z',
    })
  })

  it('nests a VideoObject when the article carries a video', () => {
    const ld = buildArticleLd(article({ youtubeVideoId: VIDEO_ID }), { path: '/n/x' })
    expect(ld.video).toMatchObject({ '@type': 'VideoObject' })
    expect(String((ld.video as Record<string, string>).embedUrl)).toContain('youtube-nocookie.com')
  })

  it('references the author by @id when a slug is known, else inlines a Person', () => {
    const linked = buildArticleLd(article(), { path: '/n/x', authorSlug: 'amrit' })
    expect(linked.author).toEqual({ '@id': expect.stringMatching(/\/author\/amrit#person$/) })

    const inline = buildArticleLd(article(), { path: '/n/x' })
    expect(inline.author).toMatchObject({ '@type': 'Person', name: 'अमृत' })
  })

  it('omits image and wordCount when absent rather than emitting nulls', () => {
    const ld = buildArticleLd(article({ wordCount: null } as Partial<PublicArticle>), {
      path: '/n/x',
    }) as unknown as Record<string, unknown>
    expect('image' in ld).toBe(false)
    expect('wordCount' in ld).toBe(false)
  })

  it('always declares the content free to read', () => {
    expect(buildArticleLd(article(), { path: '/n/x' }).isAccessibleForFree).toBe(true)
  })
})

describe('buildVideoLd', () => {
  it('uses the privacy-enhanced embed host and the canonical watch URL', () => {
    const ld = buildVideoLd({ videoId: VIDEO_ID, name: 'शीर्षक', description: 'विवरण' })
    expect(String(ld.embedUrl)).toContain('youtube-nocookie.com')
    expect(String(ld.contentUrl)).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`)
    expect(String(ld.thumbnailUrl)).toContain('i.ytimg.com')
  })

  it('throws rather than emitting a URL for an invalid id', () => {
    expect(() => buildVideoLd({ videoId: 'nope', name: 'a', description: 'b' })).toThrow(
      /invalid video id/,
    )
  })

  it('truncates name and description', () => {
    const ld = buildVideoLd({ videoId: VIDEO_ID, name: 'क'.repeat(300), description: 'ख'.repeat(900) })
    expect(String(ld.name).length).toBe(110)
    expect(String(ld.description).length).toBe(500)
  })
})

describe('buildBreadcrumbLd', () => {
  it('numbers positions from 1 with absolute items', () => {
    const ld = buildBreadcrumbLd([
      { name: 'होम', path: '/' },
      { name: 'ताज़ा', path: '/latest' },
      { name: 'लेख', path: '/news/x' },
    ])
    const items = ld.itemListElement as Array<{ position: number; name: string; item: string }>

    expect(items.map((entry) => entry.position)).toEqual([1, 2, 3])
    expect(items.map((entry) => entry.name)).toEqual(['होम', 'ताज़ा', 'लेख'])
    for (const entry of items) {
      expect(entry.item).toMatch(/^https?:\/\//)
    }
  })

  it('handles a single crumb and an empty list', () => {
    expect((buildBreadcrumbLd([{ name: 'होम', path: '/' }]).itemListElement as unknown[]).length).toBe(1)
    expect((buildBreadcrumbLd([]).itemListElement as unknown[]).length).toBe(0)
  })
})

describe('@id consistency across builders', () => {
  it('uses the same organisation @id everywhere it is referenced', () => {
    const orgId = buildOrganizationLd()['@id']
    const site = buildWebSiteLd() as unknown as { publisher: { '@id': string } }
    const person = buildPersonLd({ name: 'a', slug: 'a' }) as unknown as {
      worksFor: { '@id': string }
    }
    const art = buildArticleLd(article(), { path: '/n/x' }) as unknown as {
      publisher: { '@id': string }
    }

    // A mismatched @id breaks the entity graph silently — the nodes simply
    // stop referring to each other.
    expect(site.publisher['@id']).toBe(orgId)
    expect(person.worksFor['@id']).toBe(orgId)
    expect(art.publisher['@id']).toBe(orgId)
  })
})
