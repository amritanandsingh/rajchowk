import { describe, expect, it } from 'vitest'

import { deriveSlug, isSlug, MAX_SLUG_LENGTH, slugify, withSuffix } from './slug'

/**
 * Slug derivation.
 *
 * The Devanagari behaviour is the interesting part and the reason this module
 * exists separately from validation: a slug is a permanent public URL, and
 * this product's headlines are usually in a script with no ASCII form.
 */

describe('slugify', () => {
  it('slugifies a Latin headline', () => {
    expect(slugify('Delhi Verdict 2026')).toBe('delhi-verdict-2026')
  })

  it('strips Latin diacritics via NFKD', () => {
    expect(slugify('Café Society')).toBe('cafe-society')
  })

  it('returns EMPTY for a purely Devanagari headline', () => {
    // The load-bearing case. Devanagari letters are letters, not combining
    // marks, so they survive NFKD unchanged and there is nothing to slugify.
    // Returning '' means "ask for a slug", never "invent one" — a machine
    // transliteration would be baked into a permanent URL.
    expect(slugify('दिल्ली में बड़ा फैसला')).toBe('')
  })

  it('keeps the Latin part of a code-mixed headline', () => {
    // Common in Hindi news: "Delhi में बड़ा फैसला".
    expect(slugify('Delhi में बड़ा फैसला')).toBe('delhi')
  })

  it('collapses runs of punctuation into a single hyphen', () => {
    expect(slugify('Budget 2026: what   it   means!!')).toBe('budget-2026-what-it-means')
  })

  it('never leaves a trailing hyphen after truncation', () => {
    // The slice can land mid-word; a trailing hyphen would fail isSlug and
    // produce an ugly URL.
    const long = `${'a'.repeat(MAX_SLUG_LENGTH - 1)} bcdef`
    const result = slugify(long)
    expect(result.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    expect(result.endsWith('-')).toBe(false)
    expect(isSlug(result)).toBe(true)
  })
})

describe('isSlug', () => {
  it.each(['delhi', 'delhi-verdict', 'budget-2026', 'a1'])('accepts %s', (value) => {
    expect(isSlug(value)).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['uppercase', 'Delhi'],
    ['leading hyphen', '-delhi'],
    ['trailing hyphen', 'delhi-'],
    ['double hyphen', 'delhi--verdict'],
    ['space', 'delhi verdict'],
    ['Devanagari', 'दिल्ली'],
    ['slash', 'a/b'],
    ['over length', 'a'.repeat(MAX_SLUG_LENGTH + 1)],
  ])('rejects %s', (_label, value) => {
    expect(isSlug(value)).toBe(false)
  })
})

describe('deriveSlug', () => {
  const articleId = '0d8f6b2a-1c34-4e77-9f21-abcdef123456'

  it('prefers a valid explicit slug over the title', () => {
    // The editor chose it, and they know the URL matters.
    expect(deriveSlug({ explicitSlug: 'my-choice', title: 'Some English Title', articleId })).toBe(
      'my-choice',
    )
  })

  it('ignores an INVALID explicit slug and falls through', () => {
    // Falling back rather than failing: validation has already reported the
    // bad slug to the editor, and losing their article to a rejected save
    // would be a worse outcome than giving it a derived URL.
    expect(deriveSlug({ explicitSlug: 'Not A Slug!', title: 'English Title', articleId })).toBe(
      'english-title',
    )
  })

  it('derives from the title when no slug is given', () => {
    expect(deriveSlug({ title: 'English Title', articleId })).toBe('english-title')
  })

  it('falls back to an id-based slug for a Devanagari headline', () => {
    // The NORMAL path for this product, not an error branch.
    expect(deriveSlug({ title: 'दिल्ली में बड़ा फैसला', articleId })).toBe('lekh-0d8f6b2a')
  })

  it('produces a VALID slug from the id fallback', () => {
    // UUIDs are hex, so the result is always in the slug alphabet — but assert
    // it, because a change to id generation could break the URL silently.
    const slug = deriveSlug({ title: 'हिन्दी', articleId })
    expect(isSlug(slug)).toBe(true)
  })

  it('is deterministic for the same article', () => {
    const once = deriveSlug({ title: 'हिन्दी', articleId })
    const twice = deriveSlug({ title: 'हिन्दी', articleId })
    expect(once).toBe(twice)
  })
})

describe('withSuffix', () => {
  it('appends the attempt number', () => {
    expect(withSuffix('delhi-verdict', 2)).toBe('delhi-verdict-2')
  })

  it('keeps the result within MAX_SLUG_LENGTH', () => {
    // Truncating the BASE rather than the result: a suffix chopped off the end
    // would collide with the slug it was meant to disambiguate.
    const result = withSuffix('a'.repeat(MAX_SLUG_LENGTH), 2)
    expect(result.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    expect(result.endsWith('-2')).toBe(true)
    expect(isSlug(result)).toBe(true)
  })

  it('does not produce a double hyphen when the base ends near the cut', () => {
    const result = withSuffix(`${'a'.repeat(MAX_SLUG_LENGTH - 3)}-bb`, 3)
    expect(result).not.toContain('--')
    expect(isSlug(result)).toBe(true)
  })
})
