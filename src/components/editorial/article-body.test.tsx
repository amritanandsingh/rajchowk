import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Providers } from '@/components/providers'
import type { PublicArticle } from '@/lib/amplify/queries'
import { getDictionary } from '@/lib/i18n'
import { ArticleBody, ArticleMeta } from './article-body'

/**
 * The article body.
 *
 * The credibility claim is structural, not stylistic: fact-bearing blocks come
 * BEFORE opinion-bearing ones, each is labelled, and the sources close the
 * piece. A reader who stops halfway has read facts, not opinion presented as
 * fact. That ordering is asserted here by DOM position, because it is the thing
 * a refactor would silently break.
 */

const dict = getDictionary('hi')

function article(overrides: Partial<PublicArticle> = {}): PublicArticle {
  return {
    id: 'a1',
    slug: 'test',
    title: 'दिल्ली में बड़ा फैसला',
    language: 'HI',
    contentType: 'NEWS',
    authorDisplayName: 'अमृत',
    factualSummary: 'अदालत ने आदेश दिया।',
    keyFacts: ['पहला तथ्य', 'दूसरा तथ्य'],
    bodyMarkdown: 'मुख्य विवरण यहाँ है।',
    analysisMarkdown: 'इसका मतलब यह है।',
    conclusionMarkdown: 'मेरी राय यह है।',
    sources: [{ id: 's1', title: 'अदालत का आदेश', url: 'https://example.com', displayOrder: 1 }],
    readingMinutes: 4,
    publishedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  } as PublicArticle
}

/**
 * ArticleBody can render YouTubeEmbed, which is a client component reading the
 * locale context, so everything is rendered inside Providers.
 */
function renderBody(props: Parameters<typeof ArticleBody>[0]) {
  return render(
    <Providers initialLocale="hi">
      <ArticleBody {...props} />
    </Providers>,
  )
}

/** Index of a text node in document order, for ordering assertions. */
function positionOf(container: HTMLElement, text: string): number {
  const index = (container.textContent ?? '').indexOf(text)
  expect(index, `"${text}" not found`).toBeGreaterThanOrEqual(0)
  return index
}

describe('ArticleBody — block ordering', () => {
  it('places every fact block BEFORE every opinion block', () => {
    // This is the product's core claim, expressed as document order.
    const { container } = renderBody({ article: article(), dict })

    const whatHappened = positionOf(container, dict.article.whatHappened)
    const importantFacts = positionOf(container, dict.article.importantFacts)
    const analysis = positionOf(container, dict.article.myAnalysis)
    const conclusion = positionOf(container, dict.article.myConclusion)
    const sources = positionOf(container, dict.article.sources)

    expect(whatHappened).toBeLessThan(importantFacts)
    expect(importantFacts).toBeLessThan(analysis)
    expect(analysis).toBeLessThan(conclusion)
    expect(conclusion).toBeLessThan(sources)
  })

  it('puts a correction notice first, above everything else', () => {
    const { container } = renderBody({
      article: article({
        correctionNotice: 'तारीख़ ठीक की गई',
        correctedAt: '2026-08-02T00:00:00.000Z',
      }),
      dict,
    })
    expect(positionOf(container, dict.article.correction)).toBeLessThan(
      positionOf(container, dict.article.whatHappened),
    )
  })
})

describe('ArticleBody — labelling', () => {
  it('labels facts as verified fact and the conclusion as opinion', () => {
    renderBody({ article: article(), dict })

    // Two fact blocks share the badge, so expect multiple.
    expect(screen.getAllByText(dict.badge.verifiedFact).length).toBeGreaterThanOrEqual(1)

    // NOTE: dict.article.myAnalysis and dict.badge.myAnalysis are the SAME
    // string ("मेरा विश्लेषण"), so a bare getByText matches both the section
    // heading and the badge inside it. Scope each assertion to its landmark.
    const analysis = screen.getByRole('region', { name: dict.article.myAnalysis })
    expect(within(analysis).getAllByText(dict.badge.myAnalysis).length).toBeGreaterThanOrEqual(1)

    const conclusion = screen.getByRole('region', { name: dict.article.myConclusion })
    expect(within(conclusion).getByText(dict.badge.opinion)).toBeInTheDocument()
  })

  it('renders each block as a labelled landmark', () => {
    renderBody({ article: article(), dict })
    for (const name of [
      dict.article.whatHappened,
      dict.article.importantFacts,
      dict.article.myAnalysis,
      dict.article.myConclusion,
      dict.article.sources,
    ]) {
      expect(screen.getByRole('region', { name }), name).toBeInTheDocument()
    }
  })

  it('sets the language from the article, not the UI', () => {
    // A Hindi article read with English chrome is still a Hindi article, and
    // screen readers need the content language to pronounce it.
    const hindi = renderBody({ article: article({ language: 'HI' }), dict })
    expect(hindi.container.querySelector('[lang="hi"]')).not.toBeNull()
    hindi.unmount()

    const english = renderBody({ article: article({ language: 'EN' }), dict })
    expect(english.container.querySelector('[lang="en"]')).not.toBeNull()
  })
})

describe('ArticleBody — optional blocks', () => {
  it('omits a block entirely when its content is absent', () => {
    renderBody({
      article: article({
        factualSummary: null,
        keyFacts: [],
        analysisMarkdown: null,
        conclusionMarkdown: null,
        sources: [],
      }),
      dict,
    })

    // An empty labelled section reads as missing content, so it must not render.
    expect(screen.queryByText(dict.article.whatHappened)).toBeNull()
    expect(screen.queryByText(dict.article.importantFacts)).toBeNull()
    expect(screen.queryByText(dict.article.myAnalysis)).toBeNull()
    expect(screen.queryByText(dict.article.myConclusion)).toBeNull()
    expect(screen.queryByText(dict.article.sources)).toBeNull()

    // The main narrative still renders.
    expect(screen.getByText(/मुख्य विवरण/)).toBeInTheDocument()
  })

  it('omits the correction block unless a notice exists', () => {
    renderBody({ article: article(), dict })
    expect(screen.queryByText(dict.article.correction)).toBeNull()
  })

  it('drops blank key facts rather than rendering empty bullets', () => {
    renderBody({
      article: article({ keyFacts: ['असली तथ्य', '', '   ', null] as unknown as string[] }),
      dict,
    })

    const facts = screen.getByRole('region', { name: dict.article.importantFacts })
    expect(within(facts).getByText('असली तथ्य')).toBeInTheDocument()
    // Scoped: the source list renders <li> too.
    expect(within(facts).getAllByRole('listitem')).toHaveLength(1)
  })

  it('renders the video section only when a video id exists', () => {
    const without = renderBody({ article: article(), dict })
    expect(without.container.querySelector('.aspect-video')).toBeNull()
    without.unmount()

    const withVideo = renderBody({ article: article({ youtubeVideoId: 'dQw4w9WgXcQ' }), dict })
    expect(withVideo.container.querySelector('.aspect-video')).not.toBeNull()
    // Still a facade — no iframe until clicked.
    expect(withVideo.container.querySelector('iframe')).toBeNull()
  })

  it('tolerates null entries in the sources array', () => {
    renderBody({
      article: article({ sources: [null, { id: 's1', title: 'अदालत का आदेश' }] as never }),
      dict,
    })
    // A distinct title: 'स्रोत' is also the section heading.
    expect(screen.getByText('अदालत का आदेश')).toBeInTheDocument()
  })
})

describe('ArticleMeta', () => {
  it('shows the byline, date and reading time', () => {
    const { container } = render(<ArticleMeta article={article()} dict={dict} />)
    expect(screen.getByText('अमृत')).toBeInTheDocument()
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-08-01T10:00:00.000Z')
    expect(container.textContent).toContain('4')
  })

  it('prefers a byline override when the editor set one', () => {
    render(<ArticleMeta article={article({ bylineOverride: 'विशेष संवाददाता' })} dict={dict} />)
    expect(screen.getByText('विशेष संवाददाता')).toBeInTheDocument()
    expect(screen.queryByText('अमृत')).toBeNull()
  })

  it('flags an opinion piece in the byline area', () => {
    // The reader should know it is opinion before reading a word of it.
    const opinion = render(
      <ArticleMeta article={article({ contentType: 'OPINION' })} dict={dict} />,
    )
    expect(screen.getByText(dict.badge.opinion)).toBeInTheDocument()
    opinion.unmount()

    render(<ArticleMeta article={article({ contentType: 'NEWS' })} dict={dict} />)
    expect(screen.queryByText(dict.badge.opinion)).toBeNull()
  })

  it('flags an editorial as opinion too', () => {
    render(<ArticleMeta article={article({ contentType: 'EDITORIAL' })} dict={dict} />)
    expect(screen.getByText(dict.badge.opinion)).toBeInTheDocument()
  })

  it('omits the date and reading time when unknown', () => {
    const { container } = render(
      <ArticleMeta
        article={article({ publishedAt: null, readingMinutes: null } as Partial<PublicArticle>)}
        dict={dict}
      />,
    )
    expect(container.querySelector('time')).toBeNull()
  })
})
