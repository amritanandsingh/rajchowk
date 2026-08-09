import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ArticleCard } from '@/lib/amplify/queries'
import { ArticleList } from './article-list'

/**
 * The feed's state matrix.
 *
 * The requirement being tested: the application must never leave a visitor
 * looking at a blank screen. Each of the three states below is a distinct
 * thing to say, and collapsing any two of them is the failure mode.
 */

const article = (over: Partial<ArticleCard> = {}): ArticleCard =>
  ({
    id: 'a1',
    slug: 'delhi-verdict',
    title: 'दिल्ली में बड़ा फैसला',
    summary: 'सर्वोच्च न्यायालय ने आज एक महत्वपूर्ण निर्णय सुनाया है।',
    authorName: 'अमृत',
    publishedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  }) as ArticleCard

describe('ArticleList', () => {
  it('renders one item per article, newest-first order preserved', () => {
    render(
      <ArticleList
        articles={[
          article({ id: 'a1', title: 'पहला', slug: 'pehla' }),
          article({ id: 'a2', title: 'दूसरा', slug: 'doosra' }),
        ]}
      />,
    )

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    // The resolver sorts; this asserts the component does not re-order.
    expect(within(items[0]!).getByRole('heading')).toHaveTextContent('पहला')
    expect(within(items[1]!).getByRole('heading')).toHaveTextContent('दूसरा')
  })

  it('shows the EMPTY state when nothing is published', () => {
    render(<ArticleList articles={[]} />)

    expect(screen.getByText('अभी कोई लेख प्रकाशित नहीं हुआ है')).toBeInTheDocument()
    // Announced, not merely displayed.
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('shows the ERROR state when the query failed', () => {
    render(<ArticleList articles={[]} failed />)

    expect(screen.getByText('लेख नहीं लाए जा सके')).toBeInTheDocument()
    // `alert`, not `status`: a failure should interrupt.
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('distinguishes empty from failed', () => {
    const { unmount } = render(<ArticleList articles={[]} />)
    const emptyText = screen.getByRole('status').textContent
    unmount()

    render(<ArticleList articles={[]} failed />)
    const errorText = screen.getByRole('alert').textContent

    // "no articles yet" and "we could not reach the API" must not read the
    // same — only one of them is a problem the reader should worry about.
    expect(emptyText).not.toBe(errorText)
  })

  it('never renders an empty list element instead of a state', () => {
    render(<ArticleList articles={[]} />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('ArticleCard accessibility', () => {
  it('names the link by the HEADLINE alone, not the whole card', () => {
    render(<ArticleList articles={[article()]} />)

    // The card is clickable via a stretched pseudo-element, so the accessible
    // name stays the title. Wrapping the whole card in an <a> would make the
    // link's name the title + summary + byline + date read as one sentence.
    const link = screen.getByRole('link', { name: 'दिल्ली में बड़ा फैसला' })
    expect(link).toHaveAttribute('href', '/article/delhi-verdict')
  })

  it('renders the date in a <time> with a machine-readable datetime', () => {
    render(<ArticleList articles={[article()]} />)

    const time = document.querySelector('time')
    expect(time).toHaveAttribute('datetime', '2026-08-01T00:00:00.000Z')
    // Formatted for Indian readers: Hindi month name, Latin numerals.
    expect(time?.textContent).toMatch(/2026/)
  })

  it('omits the byline cleanly when there is no author', () => {
    render(<ArticleList articles={[article({ authorName: null })]} />)
    // No stray separator left behind.
    expect(screen.queryByText('·')).not.toBeInTheDocument()
  })

  it('does not render a date for an article with no publishedAt', () => {
    render(<ArticleList articles={[article({ publishedAt: null })]} />)
    expect(document.querySelector('time')).toBeNull()
  })

  it('gives the first article a larger heading when featured', () => {
    const { container } = render(
      <ArticleList
        articles={[article({ id: 'a1' }), article({ id: 'a2', slug: 'b' })]}
        featureFirst
      />,
    )

    const headings = container.querySelectorAll('h2')
    expect(headings[0]?.className).toContain('text-2xl')
    expect(headings[1]?.className).toContain('text-lg')
  })
})
