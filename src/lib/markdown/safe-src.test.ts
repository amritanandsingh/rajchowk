import { describe, expect, it } from 'vitest'

import { safeHref } from './safe-href'
import { safeSrc } from './safe-src'

const SITE = 'https://rajchowk.in'
const CDN = 'https://d111111abcdef8.cloudfront.net'

/**
 * Image-source safety.
 *
 * Every case here is adversarial, mirroring safe-href.test.ts — this is the
 * second of two independent checks on a `src`, and the interesting failures
 * are strings crafted to look like one thing and parse as another.
 *
 * The last block is the one that justifies this being a separate function at
 * all rather than a call to safeHref.
 */

describe('safeSrc — rejections', () => {
  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['uppercase javascript:', 'JavaScript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['a data: image', 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg=='],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
  ])('rejects the %s scheme', (_label, src) => {
    expect(safeSrc(src)).toBeNull()
  })

  it.each([
    ['a tab', 'java\tscript:alert(1)'],
    ['a newline', 'java\nscript:alert(1)'],
    ['a carriage return', 'java\rscript:alert(1)'],
    ['a null byte', 'java\0script:alert(1)'],
  ])('rejects a scheme split by %s', (_label, src) => {
    expect(safeSrc(src)).toBeNull()
  })

  it('rejects a protocol-relative URL that reads as a path', () => {
    expect(safeSrc('//evil.example/x.jpg')).toBeNull()
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['null', null],
    ['undefined', undefined],
    ['a bare filename', 'photo.jpg'],
    ['a bare host', 'example.com/x.jpg'],
  ])('rejects %s', (_label, src) => {
    expect(safeSrc(src)).toBeNull()
  })
})

describe('safeSrc — acceptance', () => {
  it.each([
    ['https', 'https://example.com/x.jpg'],
    ['http', 'http://example.com/x.jpg'],
    ['a CDN URL, which is what uploads produce', `${CDN}/articles/a/b.jpg`],
  ])('accepts %s', (_label, src) => {
    expect(safeSrc(src)).toBe(src)
  })

  it('passes a site-relative path through untouched', () => {
    expect(safeSrc('/articles/x/y.jpg')).toBe('/articles/x/y.jpg')
  })

  it('trims surrounding whitespace', () => {
    expect(safeSrc('  https://example.com/x.jpg  ')).toBe('https://example.com/x.jpg')
  })
})

describe('safeSrc — self-reference normalisation', () => {
  it('rewrites an absolute self-reference to a relative path', () => {
    expect(safeSrc(`${SITE}/media/x.jpg?v=2`, SITE)).toBe('/media/x.jpg?v=2')
  })

  it('does NOT treat a look-alike host as internal', () => {
    // The case this shares with safeHref. A naive prefix comparison treats
    // this as ours — the attacker's host merely has to begin with ours.
    const lookalike = 'https://rajchowk.in.evil.example/x.jpg'
    expect(safeSrc(lookalike, SITE)).toBe(lookalike)
    expect(safeSrc(lookalike, SITE)).not.toMatch(/^\//)
  })

  it('leaves an external source absolute when siteUrl is malformed', () => {
    const external = 'https://example.com/x.jpg'
    expect(safeSrc(external, 'not a url')).toBe(external)
  })
})

describe('safeSrc is narrower than safeHref, deliberately', () => {
  it('rejects mailto:, which safeHref accepts', () => {
    // A legitimate link target; never an image.
    expect(safeHref('mailto:hello@rajchowk.in')).not.toBeNull()
    expect(safeSrc('mailto:hello@rajchowk.in')).toBeNull()
  })

  it('rejects a fragment, which safeHref accepts', () => {
    // As an image source this resolves to the document itself and makes the
    // browser re-request the page.
    expect(safeHref('#section')).toBe('#section')
    expect(safeSrc('#section')).toBeNull()
  })
})
