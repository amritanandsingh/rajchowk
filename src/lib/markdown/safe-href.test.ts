import { describe, expect, it } from 'vitest'
import { isExternalHref, linkifyPlainText, safeHref } from './safe-href'

const SITE = 'https://rajchowk.in'

describe('safeHref', () => {
  it('allows ordinary http(s) links', () => {
    expect(safeHref('https://example.com/story')).toBe('https://example.com/story')
    expect(safeHref('http://example.com')).toBe('http://example.com/')
  })

  it('allows mailto', () => {
    expect(safeHref('mailto:hello@rajchowk.in')).toBe('mailto:hello@rajchowk.in')
  })

  it('allows site-relative and same-page links', () => {
    expect(safeHref('/news/story')).toBe('/news/story')
    expect(safeHref('#my-analysis')).toBe('#my-analysis')
  })

  it('rejects javascript: in every disguise', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('JavaScript:alert(1)')).toBeNull()
    expect(safeHref('  javascript:alert(1)  ')).toBeNull()
    // Embedded control characters: some parsers strip these and recover a
    // working scheme, so the input is rejected outright rather than cleaned.
    expect(safeHref('java\tscript:alert(1)')).toBeNull()
    expect(safeHref('java\nscript:alert(1)')).toBeNull()
    expect(safeHref('java\0script:alert(1)')).toBeNull()
  })

  it('rejects data: and other non-navigational schemes', () => {
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(safeHref('vbscript:msgbox(1)')).toBeNull()
    expect(safeHref('file:///etc/passwd')).toBeNull()
    expect(safeHref('blob:https://example.com/abc')).toBeNull()
  })

  it('rejects protocol-relative URLs, which look relative but are not', () => {
    expect(safeHref('//evil.com/path')).toBeNull()
  })

  it('rejects empty and unparseable input', () => {
    expect(safeHref('')).toBeNull()
    expect(safeHref('   ')).toBeNull()
    expect(safeHref(null)).toBeNull()
    expect(safeHref(undefined)).toBeNull()
    expect(safeHref('not a url')).toBeNull()
  })

  it('normalises an absolute self-link back to a relative path', () => {
    expect(safeHref('https://rajchowk.in/news/story', SITE)).toBe('/news/story')
    expect(safeHref('https://rajchowk.in', SITE)).toBe('/')
  })

  it('does not treat a look-alike host as internal', () => {
    expect(safeHref('https://rajchowk.in.evil.com/x', SITE)).toBe('https://rajchowk.in.evil.com/x')
  })
})

describe('isExternalHref', () => {
  it('treats relative and same-origin links as internal', () => {
    expect(isExternalHref('/news/story')).toBe(false)
    expect(isExternalHref('#section')).toBe(false)
    expect(isExternalHref('https://rajchowk.in/news/story', SITE)).toBe(false)
  })

  it('treats other origins as external', () => {
    expect(isExternalHref('https://example.com', SITE)).toBe(true)
  })
})

describe('linkifyPlainText', () => {
  it('returns a single text run when there is no link', () => {
    expect(linkifyPlainText('यह एक टिप्पणी है')).toEqual([
      { type: 'text', value: 'यह एक टिप्पणी है' },
    ])
  })

  it('extracts an http(s) link', () => {
    const runs = linkifyPlainText('देखें https://example.com/story और बताएँ')
    expect(runs).toEqual([
      { type: 'text', value: 'देखें ' },
      { type: 'link', href: 'https://example.com/story', text: 'https://example.com/story' },
      { type: 'text', value: ' और बताएँ' },
    ])
  })

  it('leaves trailing sentence punctuation outside the link', () => {
    const runs = linkifyPlainText('देखें https://example.com/story।')
    const link = runs.find((run) => run.type === 'link')
    expect(link).toEqual({
      type: 'link',
      href: 'https://example.com/story',
      text: 'https://example.com/story',
    })
    // The danda is not part of the URL; here it is kept in the text stream.
    expect(runs.map((r) => (r.type === 'text' ? r.value : '')).join('')).toContain('।')
  })

  it('strips a trailing full stop or bracket from the href', () => {
    const runs = linkifyPlainText('see https://example.com/a.')
    const link = runs.find((run) => run.type === 'link')
    expect(link && link.type === 'link' && link.href).toBe('https://example.com/a')
  })

  it('never linkifies a dangerous scheme', () => {
    // The whole point: comments are plain text, and the linkifier is the only
    // thing that can turn any of it into an anchor.
    const runs = linkifyPlainText('try javascript:alert(1) now')
    expect(runs.every((run) => run.type === 'text')).toBe(true)
    const runs2 = linkifyPlainText('try data:text/html,<script>alert(1)</script>')
    expect(runs2.every((run) => run.type === 'text')).toBe(true)
  })

  it('does not linkify a bare domain', () => {
    // Requiring an explicit scheme keeps the tokenizer conservative.
    const runs = linkifyPlainText('visit example.com today')
    expect(runs.every((run) => run.type === 'text')).toBe(true)
  })

  it('truncates a very long URL for display but keeps the full href', () => {
    const long = `https://example.com/${'a'.repeat(200)}`
    const runs = linkifyPlainText(long)
    const link = runs.find((run) => run.type === 'link')
    expect(link && link.type === 'link' && link.href).toBe(long)
    expect(link && link.type === 'link' && link.text.length).toBeLessThanOrEqual(61)
    expect(link && link.type === 'link' && link.text.endsWith('…')).toBe(true)
  })

  it('handles several links in one comment', () => {
    const runs = linkifyPlainText('a https://one.example b https://two.example c')
    expect(runs.filter((run) => run.type === 'link')).toHaveLength(2)
  })

  it('preserves the original text when reassembled', () => {
    const input = 'देखें https://example.com/x और https://example.com/y'
    const rebuilt = runsToText(linkifyPlainText(input))
    expect(rebuilt.replace(/\s+/g, ' ')).toBe(input.replace(/\s+/g, ' '))
  })
})

function runsToText(runs: ReturnType<typeof linkifyPlainText>): string {
  return runs.map((run) => (run.type === 'text' ? run.value : run.href)).join('')
}
