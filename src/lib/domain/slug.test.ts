import { describe, expect, it } from 'vitest'
import { isSlug, MAX_SLUG_LENGTH, slugify } from './slug'

describe('slugify', () => {
  it('lowercases and joins words with single hyphens', () => {
    expect(slugify('Politics & Society')).toBe('politics-society')
    expect(slugify('Fact Check')).toBe('fact-check')
    expect(slugify('a---b')).toBe('a-b')
  })

  it('trims surrounding whitespace and punctuation', () => {
    expect(slugify('  Khel  ')).toBe('khel')
    expect(slugify('--khel--')).toBe('khel')
    expect(slugify('"Khel!"')).toBe('khel')
  })

  it('folds Latin diacritics to ASCII', () => {
    expect(slugify('Café')).toBe('cafe')
    expect(slugify('Ökonomie')).toBe('okonomie')
  })

  it('returns an empty string for Devanagari rather than inventing a slug', () => {
    // The whole reason slugs are derived from the English name. An invented
    // slug would be baked into a permanent public URL.
    expect(slugify('राजनीति')).toBe('')
    expect(slugify('खेल जगत')).toBe('')
  })

  it('keeps ASCII that is mixed in with Devanagari', () => {
    expect(slugify('राजनीति Politics')).toBe('politics')
  })

  it('caps the length and never leaves a trailing hyphen behind', () => {
    const long = `${'a'.repeat(MAX_SLUG_LENGTH - 1)} tail`
    const result = slugify(long)
    expect(result.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    expect(result.endsWith('-')).toBe(false)
    expect(result).toBe('a'.repeat(MAX_SLUG_LENGTH - 1))
  })

  it('returns an empty string for input with no alphanumerics at all', () => {
    expect(slugify('')).toBe('')
    expect(slugify('---')).toBe('')
    expect(slugify('!!!')).toBe('')
  })
})

describe('isSlug', () => {
  it('accepts what slugify produces', () => {
    for (const value of ['politics', 'fact-check', 'a-b-c', 'khel2024']) {
      expect(isSlug(value), value).toBe(true)
      expect(isSlug(slugify(value)), value).toBe(true)
    }
  })

  it('rejects anything that would make an unstable URL', () => {
    for (const value of ['Khel', 'khel_1', '-khel', 'khel-', 'khel--x', 'खेल', '', 'a b']) {
      expect(isSlug(value), value).toBe(false)
    }
  })

  it('rejects a slug over the length cap', () => {
    expect(isSlug('a'.repeat(MAX_SLUG_LENGTH))).toBe(true)
    expect(isSlug('a'.repeat(MAX_SLUG_LENGTH + 1))).toBe(false)
  })
})
