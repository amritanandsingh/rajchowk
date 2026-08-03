/**
 * UI chrome language.
 *
 * This is deliberately NOT in the URL. The public URL shape is fixed as
 * /news/{slug}, /opinion/{slug}, /promises/{slug}, so the chrome locale comes
 * from a cookie (explicit user choice) falling back to Accept-Language.
 *
 * Article language is a separate axis: it is a data field on the article and
 * drives <article lang>, og:locale and JSON-LD inLanguage. A Hindi article
 * viewed with English chrome is still a Hindi article.
 *
 * Migration path to /en/... prefixes: add a [locale] segment above (public),
 * keep this module as the resolver, and switch `resolveLocale` to read the
 * segment first. No component changes required — they all take `dict`.
 */

export const LOCALES = ['hi', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'hi'

/** Cookie holding an explicit user choice. Not httpOnly — the language
 *  switcher is a client component and this value is not a secret. */
export const LOCALE_COOKIE = 'rc_locale'
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** BCP 47 tags, for `<html lang>`, og:locale and hreflang. */
export const LOCALE_TAGS: Record<Locale, string> = {
  hi: 'hi-IN',
  en: 'en-IN',
}

export const OG_LOCALES: Record<Locale, string> = {
  hi: 'hi_IN',
  en: 'en_IN',
}

/** Language names in their own language, for the switcher. */
export const LOCALE_LABELS: Record<Locale, string> = {
  hi: 'हिन्दी',
  en: 'English',
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * Pick a locale from an Accept-Language header.
 *
 * Deliberately hand-rolled rather than pulling in negotiator: we support
 * exactly two languages, and the full RFC 4647 lookup algorithm is not worth a
 * dependency that would also have to run in middleware.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const qParam = params.find((p) => p.trim().startsWith('q='))
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1
      return { tag: (tag ?? '').trim().toLowerCase(), q: Number.isNaN(q) ? 0 : q }
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q)

  for (const { tag } of ranked) {
    if (tag === '*') return DEFAULT_LOCALE
    // Match the primary subtag: `hi-IN`, `hi`, and `HI-in` all mean Hindi.
    const primary = tag.split('-')[0]
    if (isLocale(primary)) return primary
  }
  return null
}

/** Cookie first (an explicit choice must stick), then Accept-Language. */
export function resolveLocale(
  cookieValue: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (isLocale(cookieValue)) return cookieValue
  return localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE
}
