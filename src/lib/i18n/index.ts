import { en } from './dictionaries/en'
import { hi, type Dictionary } from './dictionaries/hi'
import { DEFAULT_LOCALE, type Locale } from './config'

export type { Dictionary }
export * from './config'

/**
 * Dictionaries are imported statically rather than dynamically imported.
 *
 * They total a few kilobytes for two languages, and a static import means the
 * chrome strings are available synchronously in both Server and Client
 * Components without a provider, a suspense boundary, or a request-time await.
 * Revisit if the key count grows past a few hundred or a third language lands.
 */
const dictionaries: Record<Locale, Dictionary> = { hi, en }

export function getDictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE]
}

/**
 * Substitute `{name}` placeholders.
 *
 * Deliberately not ICU: the chrome has no plural- or gender-dependent strings,
 * and Hindi's two-form plural is handled by writing counted strings as
 * "{count} वोट", which is correct for both. If real ICU need appears, this is
 * the single function to replace.
 */
export function t(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}
