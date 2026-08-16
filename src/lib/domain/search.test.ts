import { describe, expect, it } from 'vitest'

import { SEARCH_TERM_LIMITS, isSearchable, normalizeSearchTerm } from './search'

/**
 * `?q=` arrives from a URL, so nothing upstream has trimmed it, bounded it or
 * normalised it — the form's maxLength is a courtesy to whoever types, not a
 * constraint on whoever navigates. This module is where a search term becomes
 * something safe to compare against index bytes.
 */

/** U+0958 क़ is a Unicode composition exclusion: NFC turns it INTO the
 *  decomposed pair क + nukta, rather than the other way round. */
const PRECOMPOSED_QA = String.fromCodePoint(0x0958)
const DECOMPOSED_QA = String.fromCodePoint(0x0915, 0x093c)

describe('normalizeSearchTerm', () => {
  it('NFC-normalises, so a term matches text that was normalised on write', () => {
    // THE reason this function exists. Article titles go through
    // normalizeArticleInput on save, and DynamoDB's `contains` compares bytes.
    // Skip this and a reader typing क़ानून on one keyboard finds nothing,
    // while the same word from another keyboard finds everything.
    const normalized = normalizeSearchTerm(`${PRECOMPOSED_QA}ानून`)

    expect(normalized).toBe(`${DECOMPOSED_QA}ानून`)
    expect(normalized).not.toBe(`${PRECOMPOSED_QA}ानून`)
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeSearchTerm('  चुनाव  ')).toBe('चुनाव')
  })

  it('keeps whitespace inside a multi-word term', () => {
    // A phrase is a legitimate search. Collapsing it to one word would return
    // more results than were asked for, not fewer.
    expect(normalizeSearchTerm(' लोक सभा ')).toBe('लोक सभा')
  })

  it('caps an over-long term at the maximum', () => {
    const term = normalizeSearchTerm('क'.repeat(500))
    expect(term).toHaveLength(SEARCH_TERM_LIMITS.max)
  })

  it('trims again after capping, so the cap cannot expose trailing space', () => {
    // Slicing at `max` can land immediately after a space that the first trim
    // never saw, and a term ending in a space matches differently.
    const term = normalizeSearchTerm(`${'क'.repeat(SEARCH_TERM_LIMITS.max - 1)} खोज`)
    expect(term).toBe(term.trim())
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace only', '   '],
  ])('returns an empty string for %s input', (_label, raw) => {
    expect(normalizeSearchTerm(raw)).toBe('')
  })

  it('is idempotent, so a caller may normalise twice without harm', () => {
    // The page normalises for display and the data layer normalises again
    // before querying. Both must agree, or the heading and the results will
    // describe different searches.
    const once = normalizeSearchTerm(`  ${PRECOMPOSED_QA}ानून  `)
    expect(normalizeSearchTerm(once)).toBe(once)
  })
})

describe('isSearchable', () => {
  it.each(['', 'क', ' '])('rejects %p as too short to be worth a query', (term) => {
    // A one-character term matches nearly every article and costs a full
    // partition read to prove it.
    expect(isSearchable(normalizeSearchTerm(term))).toBe(false)
  })

  it('accepts a term at the minimum length', () => {
    expect(isSearchable('कब')).toBe(true)
    expect(SEARCH_TERM_LIMITS.min).toBe(2)
  })
})
