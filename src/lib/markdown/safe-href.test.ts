import { describe, expect, it } from 'vitest'

import { isExternalHref, safeHref } from './safe-href'

const SITE = 'https://rajchowk.in'

/**
 * Link safety.
 *
 * Every case here is adversarial. This is the second of two independent checks
 * on an href (the sanitizer's protocol allowlist is the first), and the
 * interesting failures are strings crafted to look like one thing and parse as
 * another.
 */

describe('safeHref — rejections', () => {
  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['uppercase javascript:', 'JavaScript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['vbscript:', 'vbscript:msgbox(1)'],
    ['file:', 'file:///etc/passwd'],
  ])('rejects the %s scheme', (_label, href) => {
    expect(safeHref(href)).toBeNull()
  })

  it.each([
    ['a tab', 'java\tscript:alert(1)'],
    ['a newline', 'java\nscript:alert(1)'],
    ['a carriage return', 'java\rscript:alert(1)'],
    ['a null byte', 'java\0script:alert(1)'],
  ])('rejects a scheme split by %s', (_label, href) => {
    // Classic filter bypass: some parsers strip the control character and
    // normalise the result back into a working scheme.
    expect(safeHref(href)).toBeNull()
  })

  it('rejects a protocol-relative URL that reads as a path', () => {
    // `//evil.example` looks relative and is not.
    expect(safeHref('//evil.example/x')).toBeNull()
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['null', null],
    ['undefined', undefined],
    ['a bare word', 'example.com'],
  ])('rejects %s', (_label, href) => {
    // A bare word is rejected rather than given a scheme: guessing for the
    // author is how `javascript:alert(1)` gets a second chance.
    expect(safeHref(href)).toBeNull()
  })
})

describe('safeHref — acceptance', () => {
  it.each([
    ['https', 'https://example.com/x'],
    ['http', 'http://example.com/x'],
    ['mailto', 'mailto:hello@rajchowk.in'],
  ])('accepts %s', (_label, href) => {
    expect(safeHref(href)).toBe(href)
  })

  it('passes site-relative and fragment links through untouched', () => {
    expect(safeHref('/article/delhi-verdict')).toBe('/article/delhi-verdict')
    expect(safeHref('#section')).toBe('#section')
  })

  it('trims surrounding whitespace', () => {
    expect(safeHref('  https://example.com/x  ')).toBe('https://example.com/x')
  })
})

describe('safeHref — self-link normalisation', () => {
  it('rewrites an absolute self-link to a relative path', () => {
    expect(safeHref(`${SITE}/article/x?a=1#b`, SITE)).toBe('/article/x?a=1#b')
  })

  it('maps the bare origin to /', () => {
    expect(safeHref(SITE, SITE)).toBe('/')
  })

  it('does NOT treat a look-alike host as internal', () => {
    // THE case this function exists for. A naive
    // `url.href.startsWith(siteUrl)` treats this as internal — the attacker's
    // host merely has to begin with ours — and would strip the prefix,
    // rendering a link to an attacker-chosen path that looks local.
    const lookalike = 'https://rajchowk.in.evil.example/phish'
    expect(safeHref(lookalike, SITE)).toBe(lookalike)
    expect(safeHref(lookalike, SITE)).not.toMatch(/^\//)
  })

  it('does not treat a subdomain as the same origin', () => {
    const sub = 'https://other.rajchowk.in/x'
    expect(safeHref(sub, SITE)).toBe(sub)
  })

  it('leaves an external link absolute when siteUrl is malformed', () => {
    // A broken configuration must never make an external link look internal.
    const external = 'https://example.com/x'
    expect(safeHref(external, 'not a url')).toBe(external)
  })
})

describe('isExternalHref', () => {
  it('treats relative and fragment links as internal', () => {
    expect(isExternalHref('/article/x')).toBe(false)
    expect(isExternalHref('#section')).toBe(false)
  })

  it('treats another origin as external', () => {
    expect(isExternalHref('https://example.com/x', SITE)).toBe(true)
  })

  it('treats our own absolute URL as internal', () => {
    expect(isExternalHref(`${SITE}/article/x`, SITE)).toBe(false)
  })
})
