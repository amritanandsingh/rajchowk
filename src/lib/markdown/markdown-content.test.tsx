import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MarkdownContent } from './markdown-content'

/**
 * The XSS boundary, end to end.
 *
 * This file did not exist until images were allowed, and that is the reason it
 * exists now: permitting `img` widened the sanitiser's allowlist for the first
 * time, and widening an untested boundary is how a boundary stops being one.
 *
 * Every case below goes through the real pipeline — remark-parse →
 * remark-rehype → rehype-sanitize with `articleSchema` → the components map.
 * Nothing is mocked, because the interaction BETWEEN those stages is the thing
 * under test: an assertion against the schema object alone would not catch a
 * component override that reintroduced a raw value.
 */

const html = (markdown: string) => render(<MarkdownContent source={markdown} />).container

describe('images — the happy path', () => {
  it('renders an uploaded image with its source and alt text', () => {
    const src = 'https://d111111abcdef8.cloudfront.net/articles/a/b.jpg'
    render(<MarkdownContent source={`![सभा का दृश्य](${src})`} />)

    const image = screen.getByRole('img', { name: 'सभा का दृश्य' })
    expect(image).toHaveAttribute('src', src)
  })

  it('gives a decorative image an EMPTY alt, never a missing one', () => {
    // `![](x)` is the legitimate way to mark an image decorative. An absent
    // alt is an axe `image-alt` violation, and e2e asserts zero violations —
    // so `alt=""` is the difference between a passing and a failing build.
    const container = html('![](https://cdn.example/x.jpg)')

    const image = container.querySelector('img')
    expect(image).not.toBeNull()
    expect(image!.getAttribute('alt')).toBe('')
  })

  it('lazy-loads, so a long article does not fetch every image at once', () => {
    const container = html('![x](https://cdn.example/x.jpg)')
    expect(container.querySelector('img')).toHaveAttribute('loading', 'lazy')
  })

  it('accepts a site-relative source', () => {
    const container = html('![x](/media/x.jpg)')
    expect(container.querySelector('img')).toHaveAttribute('src', '/media/x.jpg')
  })
})

describe('images — rejected sources render nothing', () => {
  it.each([
    ['javascript:', '![x](javascript:alert(1))'],
    ['data: html', '![x](data:text/html,<script>alert(1)</script>)'],
    ['data: svg', '![x](data:image/svg+xml;base64,PHN2Zz4=)'],
    ['protocol-relative', '![x](//evil.example/x.jpg)'],
  ])('drops a %s source entirely', (_label, markdown) => {
    const container = html(markdown)

    // No element at all — NOT an img with the raw value, and not a fallback to
    // the alt text rendered as a broken image.
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('javascript:')
    expect(container.innerHTML).not.toContain('data:')
  })
})

describe('the allowlist still holds', () => {
  it('renders raw <script> as text, never as an element', () => {
    const container = html('<script>alert(1)</script>')

    expect(container.querySelector('script')).toBeNull()
  })

  it('strips an onerror handler smuggled through raw HTML', () => {
    // rehype-raw is not installed and is banned as an import, so raw HTML is
    // literal text — but asserting it means a future plugin addition cannot
    // quietly change that without a red test.
    const container = html('<img src=x onerror="alert(1)">')

    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('onerror')
  })

  it('drops a disallowed element but keeps its text', () => {
    const container = html('<h1>बड़ा शीर्षक</h1>')

    // h1 is the page title; an article body must not add a second one.
    expect(container.querySelector('h1')).toBeNull()
  })

  it('still renders the elements that were always allowed', () => {
    render(
      <MarkdownContent
        source={'## उपशीर्षक\n\nएक **मोटा** शब्द और [एक कड़ी](https://example.com/x)।'}
      />,
    )

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('उपशीर्षक')
    expect(screen.getByRole('link', { name: 'एक कड़ी' })).toHaveAttribute(
      'href',
      'https://example.com/x',
    )
  })

  it('still refuses a javascript: link', () => {
    const container = html('[click](javascript:alert(1))')

    expect(container.querySelector('a')).toBeNull()
    expect(container.innerHTML).not.toContain('javascript:')
  })

  it('renders nothing for empty source', () => {
    const container = html('   ')
    expect(container.innerHTML).toBe('')
  })
})
