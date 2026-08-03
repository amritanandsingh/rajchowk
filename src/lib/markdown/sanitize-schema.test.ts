import { describe, expect, it } from 'vitest'
import { schemaFull, schemaInline } from './sanitize-schema'

/**
 * The XSS boundary, asserted as data.
 *
 * `rehype-sanitize` runs on the hast tree before React sees it, so this schema
 * IS the allowlist. Testing it directly is worthwhile because a single added
 * tag name here silently widens what an editor — or anyone who compromises an
 * editor account — can put on the page.
 */

const DANGEROUS_TAGS = [
  'script',
  'iframe',
  'style',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'link',
  'meta',
  'base',
  'svg',
  'math',
  'template',
  'noscript',
  'frame',
  'frameset',
  'applet',
  'audio',
  'video',
  'source',
]

describe('schemaFull', () => {
  it('allows the editorial tags an article actually needs', () => {
    for (const tag of ['p', 'strong', 'em', 'h2', 'h3', 'a', 'ul', 'ol', 'li', 'blockquote', 'table', 'img', 'figure']) {
      expect(schemaFull.tagNames, tag).toContain(tag)
    }
  })

  it.each(DANGEROUS_TAGS)('does NOT allow <%s>', (tag) => {
    expect(schemaFull.tagNames).not.toContain(tag)
  })

  it('does not allow h1 — the page title owns that level', () => {
    expect(schemaFull.tagNames).not.toContain('h1')
  })

  it('restricts href to navigational protocols', () => {
    const protocols = schemaFull.protocols?.href
    expect(protocols).toEqual(expect.arrayContaining(['http', 'https', 'mailto']))
    for (const scheme of ['javascript', 'data', 'vbscript', 'file', 'blob']) {
      expect(protocols, scheme).not.toContain(scheme)
    }
  })

  it('restricts img src to https only, so no mixed content and no data: payload', () => {
    expect(schemaFull.protocols?.src).toEqual(['https'])
  })

  it('allows no attribute on arbitrary elements', () => {
    // The '*' catch-all is what stops style=, onerror=, onclick= and friends
    // from riding along on an otherwise-permitted tag.
    expect(schemaFull.attributes?.['*']).toEqual([])
  })

  it('never permits an event handler or style attribute anywhere', () => {
    const declared = Object.values(schemaFull.attributes ?? {}).flat()
    const names = declared.map((entry) => (Array.isArray(entry) ? entry[0] : entry))

    for (const name of names) {
      expect(String(name).toLowerCase().startsWith('on'), String(name)).toBe(false)
      expect(String(name).toLowerCase()).not.toBe('style')
    }
  })

  it('constrains the code language class to a safe pattern', () => {
    const codeAttrs = schemaFull.attributes?.code ?? []
    const className = codeAttrs.find((entry) => Array.isArray(entry) && entry[0] === 'className')
    expect(className).toBeDefined()

    const pattern = (className as [string, RegExp])[1]
    expect(pattern.test('language-ts')).toBe(true)
    // An arbitrary class would let editor content reach application styles.
    expect(pattern.test('absolute inset-0 z-50')).toBe(false)
    expect(pattern.test('language-<script>')).toBe(false)
  })

  it('constrains div and span classes to the rc- directive namespace', () => {
    const divAttrs = schemaFull.attributes?.div ?? []
    const divClass = divAttrs.find((entry) => Array.isArray(entry) && entry[0] === 'className')
    const divPattern = (divClass as [string, RegExp])[1]

    expect(divPattern.test('rc-embed')).toBe(true)
    expect(divPattern.test('rc-callout')).toBe(true)
    expect(divPattern.test('rc-figure')).toBe(true)
    // Anything outside the namespace, so directive output cannot impersonate
    // application chrome.
    expect(divPattern.test('fixed inset-0')).toBe(false)
    expect(divPattern.test('rc-embed extra')).toBe(false)

    const spanAttrs = schemaFull.attributes?.span ?? []
    const spanClass = spanAttrs.find((entry) => Array.isArray(entry) && entry[0] === 'className')
    const spanPattern = (spanClass as [string, RegExp])[1]
    expect(spanPattern.test('rc-highlight')).toBe(true)
    expect(spanPattern.test('sr-only')).toBe(false)
  })

  it('prefixes generated ids so they cannot clobber application ids', () => {
    expect(schemaFull.clobberPrefix).toBe('md-')
  })

  it('allows only the data-* attributes the directive transform emits', () => {
    const divAttrs = (schemaFull.attributes?.div ?? []).filter(
      (entry): entry is string => typeof entry === 'string',
    )
    expect(divAttrs).toEqual(
      expect.arrayContaining([
        'data-directive',
        'data-video-id',
        'data-caption',
        'data-tone',
        'data-src',
        'data-alt',
      ]),
    )
    // No open-ended data attribute.
    expect(divAttrs).not.toContain('data-*')
  })
})

describe('schemaInline', () => {
  it('allows only inline formatting', () => {
    expect(schemaInline.tagNames).toEqual(['p', 'br', 'strong', 'em', 'del', 'a', 'code', 'sup', 'sub'])
  })

  it('excludes headings, so a key fact cannot break the document outline', () => {
    for (const tag of ['h2', 'h3', 'h4']) {
      expect(schemaInline.tagNames, tag).not.toContain(tag)
    }
  })

  it('excludes images, tables and block quotes', () => {
    for (const tag of ['img', 'figure', 'table', 'blockquote', 'ul', 'ol', 'div', 'span']) {
      expect(schemaInline.tagNames, tag).not.toContain(tag)
    }
  })

  it.each(DANGEROUS_TAGS)('does NOT allow <%s>', (tag) => {
    expect(schemaInline.tagNames).not.toContain(tag)
  })

  it('inherits the protocol restrictions from the full profile', () => {
    expect(schemaInline.protocols).toEqual(schemaFull.protocols)
    expect(schemaInline.attributes?.['*']).toEqual([])
  })
})
