import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { getDictionary } from '@/lib/i18n'
import { SourceList } from './source-list'

/**
 * The sources behind a story.
 *
 * A "Verified Fact" label means nothing if the reader cannot check it, so this
 * is the other half of the credibility claim. The security property under test:
 * an unsafe URL renders as PLAIN TEXT rather than becoming a live link, and it
 * is not silently dropped either — a source the reader cannot click is still a
 * source they can look up.
 */

const dict = getDictionary('hi')

const source = (over: Partial<Parameters<typeof SourceList>[0]['sources'][number]> = {}) => ({
  id: 's1',
  title: 'सुप्रीम कोर्ट का आदेश',
  publisher: 'द हिंदू',
  url: 'https://example.com/order',
  publishedAt: '2026-07-15T00:00:00.000Z',
  ...over,
})

describe('SourceList', () => {
  it('renders nothing at all when there are no sources', () => {
    // An empty "Sources" heading looks like a bug or an omission.
    const { container } = render(<SourceList sources={[]} dict={dict} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a labelled section with the sources heading', () => {
    render(<SourceList sources={[source()]} dict={dict} />)
    const section = screen.getByRole('region', { name: dict.article.sources })
    expect(section).toBeInTheDocument()
    expect(section.id).toBe('sources')
  })

  it('renders an ordered list, so citations are numbered', () => {
    render(
      <SourceList sources={[source(), source({ id: 's2', title: 'दूसरा स्रोत' })]} dict={dict} />,
    )
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('links a safe https source and marks it external', () => {
    render(<SourceList sources={[source()]} dict={dict} />)
    const link = screen.getByRole('link', { name: /सुप्रीम कोर्ट का आदेश/ })

    expect(link).toHaveAttribute('href', 'https://example.com/order')
    expect(link).toHaveAttribute('target', '_blank')
    // noopener is the security-relevant one: without it the opened page can
    // reach back through window.opener.
    const rel = link.getAttribute('rel') ?? ''
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
    expect(rel).toContain('nofollow')
  })

  it('announces that an external link opens a new window', () => {
    render(<SourceList sources={[source()]} dict={dict} />)
    expect(screen.getByText(dict.common.opensInNewWindow, { exact: false })).toBeInTheDocument()
  })

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['//evil.com/path'],
  ])('renders %s as plain text, never as a link', (url) => {
    render(<SourceList sources={[source({ url })]} dict={dict} />)

    // The title is still shown — the reader keeps the citation.
    expect(screen.getByText('सुप्रीम कोर्ट का आदेश')).toBeInTheDocument()
    // But there is no anchor for it.
    expect(screen.queryByRole('link', { name: /सुप्रीम कोर्ट का आदेश/ })).toBeNull()
  })

  it('renders a source with no URL as plain text', () => {
    render(<SourceList sources={[source({ url: null })]} dict={dict} />)
    expect(screen.getByText('सुप्रीम कोर्ट का आदेश')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows the publisher and a Hindi-formatted date', () => {
    render(<SourceList sources={[source()]} dict={dict} />)
    expect(screen.getByText(/द हिंदू/)).toBeInTheDocument()
    // Rendered through Intl with the hi-IN locale.
    expect(screen.getByText(/जुलाई/)).toBeInTheDocument()
  })

  it('shows a verification note when the editor added one', () => {
    render(
      <SourceList
        sources={[source({ verificationNote: 'मूल दस्तावेज़ से मिलान किया गया' })]}
        dict={dict}
      />,
    )
    expect(screen.getByText('मूल दस्तावेज़ से मिलान किया गया')).toBeInTheDocument()
  })

  it('links an archived copy when present, and validates it too', () => {
    const { unmount } = render(
      <SourceList sources={[source({ archiveUrl: 'https://web.archive.org/x' })]} dict={dict} />,
    )
    expect(screen.getByRole('link', { name: /संग्रहीत प्रति/ })).toHaveAttribute(
      'href',
      'https://web.archive.org/x',
    )
    unmount()

    render(<SourceList sources={[source({ archiveUrl: 'javascript:alert(1)' })]} dict={dict} />)
    expect(screen.queryByRole('link', { name: /संग्रहीत प्रति/ })).toBeNull()
  })

  it('tolerates a malformed publication date without crashing', () => {
    render(<SourceList sources={[source({ publishedAt: 'not-a-date' })]} dict={dict} />)
    expect(screen.getByText('सुप्रीम कोर्ट का आदेश')).toBeInTheDocument()
  })

  it('honours the heading level so the outline stays legal when nested', () => {
    const { unmount } = render(<SourceList sources={[source()]} dict={dict} />)
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
    unmount()

    render(<SourceList sources={[source()]} dict={dict} headingLevel={3} />)
    expect(screen.getByRole('heading', { level: 3 })).toBeInTheDocument()
  })
})
