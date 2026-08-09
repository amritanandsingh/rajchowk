import { describe, expect, it } from 'vitest'

import {
  ARTICLE_LIMITS,
  normalizeArticleInput,
  parseArticleInput,
  validateArticle,
} from './article'

/**
 * Article validation.
 *
 * This module is the shared contract between the browser form and the Lambda,
 * so a bug here is a bug in BOTH the fast feedback and the authoritative
 * check simultaneously — which is exactly why it is worth testing directly
 * rather than only through one of its callers.
 */

const valid = {
  title: 'दिल्ली में बड़ा फैसला',
  summary: 'सर्वोच्च न्यायालय ने आज एक महत्वपूर्ण निर्णय सुनाया है।',
  content: 'आज की सुनवाई में अदालत ने विस्तार से अपनी बात रखी और कई बिंदुओं पर टिप्पणी की।',
}

describe('normalizeArticleInput', () => {
  it('trims surrounding whitespace', () => {
    const result = normalizeArticleInput({ ...valid, title: '   शीर्षक   ' })
    expect(result.title).toBe('शीर्षक')
  })

  it('preserves whitespace INSIDE content', () => {
    // Markdown is whitespace-sensitive: re-indenting a fenced block changes
    // what it means, and collapsing blank lines merges paragraphs.
    const content = 'पहला अनुच्छेद\n\n```js\n  const x = 1\n```\n\nदूसरा अनुच्छेद'
    const result = normalizeArticleInput({ ...valid, content })
    expect(result.content).toBe(content)
  })

  it('normalises Devanagari to NFC so identical-looking titles are identical', () => {
    // U+0915 U+093C (क + nukta) and U+0958 (क़) render the same. Without NFC
    // they are different strings, so they would slugify differently and could
    // both exist as separate articles with the same visible headline.
    const decomposed = 'क़लम'
    const precomposed = 'क़लम'
    expect(decomposed).not.toBe(precomposed)

    const a = normalizeArticleInput({ ...valid, title: decomposed })
    const b = normalizeArticleInput({ ...valid, title: precomposed })
    expect(a.title).toBe(b.title)
  })

  it('lowercases and trims an explicit slug', () => {
    const result = normalizeArticleInput({ ...valid, slug: '  Delhi-Verdict  ' })
    expect(result.slug).toBe('delhi-verdict')
  })

  it('turns an absent slug into null rather than undefined', () => {
    expect(normalizeArticleInput(valid).slug).toBeNull()
  })
})

describe('validateArticle', () => {
  it('accepts a well-formed article', () => {
    expect(validateArticle(normalizeArticleInput(valid))).toEqual([])
  })

  it('rejects a whitespace-only title', () => {
    // The case a naive `!title` check passes: "   " is truthy.
    const errors = validateArticle(normalizeArticleInput({ ...valid, title: '     ' }))
    expect(errors.map((error) => error.field)).toContain('title')
  })

  it.each(['title', 'summary', 'content'] as const)('rejects an over-long %s', (field) => {
    const input = normalizeArticleInput({
      ...valid,
      [field]: 'क'.repeat(ARTICLE_LIMITS[field].max + 1),
    })
    expect(validateArticle(input).map((error) => error.field)).toContain(field)
  })

  it.each(['title', 'summary', 'content'] as const)(
    'accepts a %s exactly at the limit',
    (field) => {
      const input = normalizeArticleInput({
        ...valid,
        [field]: 'क'.repeat(ARTICLE_LIMITS[field].max),
      })
      // Boundary, not just "over rejects" — an off-by-one here silently refuses
      // a legitimate article at exactly the documented maximum.
      expect(validateArticle(input).map((error) => error.field)).not.toContain(field)
    },
  )

  it('reports EVERY invalid field, not just the first', () => {
    // The form marks all bad fields in one pass; returning early would make an
    // editor discover them one submit at a time.
    const errors = validateArticle(normalizeArticleInput({ title: '', summary: '', content: '' }))
    expect(errors.map((error) => error.field).sort()).toEqual(['content', 'summary', 'title'])
  })

  it('treats an empty slug as "derive one", not as an error', () => {
    expect(validateArticle(normalizeArticleInput({ ...valid, slug: '' }))).toEqual([])
  })

  it.each([
    ['uppercase', 'Delhi-Verdict'],
    ['spaces', 'delhi verdict'],
    ['a leading hyphen', '-delhi'],
    ['a trailing hyphen', 'delhi-'],
    ['a double hyphen', 'delhi--verdict'],
    ['Devanagari', 'दिल्ली'],
    ['a slash', 'delhi/verdict'],
  ])('rejects a slug containing %s', (_label, slug) => {
    // A slug reaches a URL and a DynamoDB partition key. Anything not in
    // [a-z0-9-] has no business in either.
    const errors = validateArticle({ ...normalizeArticleInput(valid), slug })
    expect(errors.map((error) => error.field)).toContain('slug')
  })

  it('accepts a well-formed slug', () => {
    const errors = validateArticle(normalizeArticleInput({ ...valid, slug: 'delhi-verdict-2026' }))
    expect(errors).toEqual([])
  })
})

describe('parseArticleInput', () => {
  it('validates the NORMALISED value, not the raw one', () => {
    // A title that is only valid after trimming must pass. Validating raw
    // input would reject it; normalising without re-validating would accept
    // input that is invalid once trimmed.
    const padded = `   ${'क'.repeat(ARTICLE_LIMITS.title.min)}   `
    const result = parseArticleInput({ ...valid, title: padded })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.title).toBe('क'.repeat(ARTICLE_LIMITS.title.min))
  })

  it('returns the trimmed value for the caller to write', () => {
    const result = parseArticleInput({ ...valid, summary: `  ${valid.summary}  ` })
    expect(result.ok).toBe(true)
    // The handler writes `value`, which is what keeps padded input out of the
    // database even though it validated fine.
    if (result.ok) expect(result.value.summary).toBe(valid.summary)
  })

  it('fails with errors and no value', () => {
    const result = parseArticleInput({ ...valid, title: '' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
  })
})
