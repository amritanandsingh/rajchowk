import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  isLocale,
  localeFromAcceptLanguage,
  LOCALE_LABELS,
  LOCALES,
  LOCALE_TAGS,
  OG_LOCALES,
  resolveLocale,
} from './config'

describe('isLocale', () => {
  it('accepts supported locales', () => {
    expect(isLocale('hi')).toBe(true)
    expect(isLocale('en')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isLocale('fr')).toBe(false)
    expect(isLocale('HI')).toBe(false) // callers must normalise case first
    expect(isLocale('hi-IN')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(isLocale(null)).toBe(false)
    expect(isLocale(42)).toBe(false)
  })
})

describe('localeFromAcceptLanguage', () => {
  it('returns null when the header is absent or empty', () => {
    expect(localeFromAcceptLanguage(null)).toBeNull()
    expect(localeFromAcceptLanguage(undefined)).toBeNull()
    expect(localeFromAcceptLanguage('')).toBeNull()
  })

  it('matches on the primary subtag', () => {
    expect(localeFromAcceptLanguage('hi-IN')).toBe('hi')
    expect(localeFromAcceptLanguage('en-GB')).toBe('en')
    expect(localeFromAcceptLanguage('HI-in')).toBe('hi')
  })

  it('honours q-value ordering rather than source order', () => {
    expect(localeFromAcceptLanguage('en;q=0.4,hi;q=0.9')).toBe('hi')
    expect(localeFromAcceptLanguage('hi;q=0.3,en;q=0.8')).toBe('en')
  })

  it('treats a missing q as 1.0', () => {
    expect(localeFromAcceptLanguage('en,hi;q=0.9')).toBe('en')
  })

  it('skips unsupported languages and falls through to a supported one', () => {
    expect(localeFromAcceptLanguage('fr-FR,de;q=0.8,hi;q=0.5')).toBe('hi')
  })

  it('returns null when nothing is supported', () => {
    expect(localeFromAcceptLanguage('fr-FR,de;q=0.8')).toBeNull()
  })

  it('ignores entries with q=0, which explicitly mean "not acceptable"', () => {
    expect(localeFromAcceptLanguage('hi;q=0,en;q=0.5')).toBe('en')
    expect(localeFromAcceptLanguage('hi;q=0')).toBeNull()
  })

  it('maps the wildcard to the default locale', () => {
    expect(localeFromAcceptLanguage('*')).toBe(DEFAULT_LOCALE)
    expect(localeFromAcceptLanguage('fr;q=0.9,*;q=0.1')).toBe(DEFAULT_LOCALE)
  })

  it('does not crash on malformed headers', () => {
    expect(localeFromAcceptLanguage(',,,')).toBeNull()
    expect(localeFromAcceptLanguage('hi;q=abc')).toBeNull()
    expect(localeFromAcceptLanguage(';;;q=1')).toBeNull()
  })
})

describe('resolveLocale', () => {
  it('prefers an explicit cookie choice over the browser header', () => {
    expect(resolveLocale('en', 'hi-IN,hi;q=0.9')).toBe('en')
    expect(resolveLocale('hi', 'en-US')).toBe('hi')
  })

  it('falls back to Accept-Language when the cookie is absent or invalid', () => {
    expect(resolveLocale(undefined, 'en-US')).toBe('en')
    expect(resolveLocale(null, 'hi-IN')).toBe('hi')
    expect(resolveLocale('klingon', 'en-US')).toBe('en')
  })

  it('falls back to Hindi when there is nothing to go on', () => {
    expect(resolveLocale(null, null)).toBe('hi')
    expect(resolveLocale(undefined, 'fr-FR')).toBe('hi')
    expect(DEFAULT_LOCALE).toBe('hi')
  })
})

describe('locale metadata tables', () => {
  it('covers every locale in every table', () => {
    for (const locale of LOCALES) {
      expect(LOCALE_TAGS[locale]).toBeTruthy()
      expect(OG_LOCALES[locale]).toBeTruthy()
      expect(LOCALE_LABELS[locale]).toBeTruthy()
    }
  })

  it('uses India-specific BCP 47 tags', () => {
    expect(LOCALE_TAGS.hi).toBe('hi-IN')
    expect(LOCALE_TAGS.en).toBe('en-IN')
  })

  it('names each language in its own script', () => {
    expect(LOCALE_LABELS.hi).toBe('हिन्दी')
  })
})
