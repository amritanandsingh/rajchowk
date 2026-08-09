import { describe, expect, it } from 'vitest'
import { getDictionary, t } from './index'
import { LOCALES } from './config'

describe('getDictionary', () => {
  it('returns the requested locale', () => {
    expect(getDictionary('hi').siteName).toBe('राज चौक')
    expect(getDictionary('en').siteName).toBe('Raj Chowk')
  })

  it('defaults to Hindi', () => {
    expect(getDictionary().siteName).toBe('राज चौक')
  })

  it('has a dictionary for every declared locale', () => {
    for (const locale of LOCALES) {
      expect(getDictionary(locale)).toBeTruthy()
    }
  })
})

describe('dictionary parity', () => {
  // A missing key is already a compile error (en.ts is typed as Dictionary),
  // but an empty string is not — and an empty label ships as invisible UI.
  function leafPaths(value: unknown, prefix = ''): string[] {
    if (typeof value === 'string') return [prefix]
    if (value && typeof value === 'object') {
      return Object.entries(value).flatMap(([key, child]) =>
        leafPaths(child, prefix ? `${prefix}.${key}` : key),
      )
    }
    return []
  }

  function leafAt(dict: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((node, key) => {
      if (node && typeof node === 'object') return (node as Record<string, unknown>)[key]
      return undefined
    }, dict)
  }

  const hiPaths = leafPaths(getDictionary('hi'))

  it('has the same key set in both languages', () => {
    expect(leafPaths(getDictionary('en')).sort()).toEqual([...hiPaths].sort())
  })

  it.each(LOCALES)('has no empty strings in %s', (locale) => {
    const dict = getDictionary(locale)
    const empty = hiPaths.filter((path) => String(leafAt(dict, path) ?? '').trim() === '')
    expect(empty, `empty strings at: ${empty.join(', ')}`).toEqual([])
  })

  it('keeps placeholders consistent between languages', () => {
    const placeholders = (value: string): string[] =>
      [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort()

    const mismatched = hiPaths.filter((path) => {
      const hiValue = String(leafAt(getDictionary('hi'), path))
      const enValue = String(leafAt(getDictionary('en'), path))
      return JSON.stringify(placeholders(hiValue)) !== JSON.stringify(placeholders(enValue))
    })

    expect(mismatched, `placeholder mismatch at: ${mismatched.join(', ')}`).toEqual([])
  })
})

describe('t', () => {
  it('substitutes named placeholders', () => {
    expect(t('{minutes} मिनट का पठन', { minutes: 5 })).toBe('5 मिनट का पठन')
    expect(t('Results for "{query}"', { query: 'चुनाव' })).toBe('Results for "चुनाव"')
  })

  it('substitutes a placeholder used more than once', () => {
    expect(t('{a} and {a}', { a: 'x' })).toBe('x and x')
  })

  it('leaves unknown placeholders untouched rather than printing "undefined"', () => {
    expect(t('{missing} value', {})).toBe('{missing} value')
    expect(t('{a} {b}', { a: '1' })).toBe('1 {b}')
  })

  it('accepts zero as a value', () => {
    expect(t('{count} परिणाम मिले', { count: 0 })).toBe('0 परिणाम मिले')
  })

  it('returns the template unchanged when there is nothing to substitute', () => {
    expect(t('कोई परिणाम नहीं मिला।')).toBe('कोई परिणाम नहीं मिला।')
  })

  it('does not interpret substituted values as further placeholders', () => {
    expect(t('{a}', { a: '{b}' })).toBe('{b}')
  })
})
