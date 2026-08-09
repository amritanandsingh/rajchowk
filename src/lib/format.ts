/**
 * Date formatting for a Hindi, India-first product.
 *
 * Two decisions worth stating, because both look like details and neither is.
 *
 * TIME ZONE IS PINNED to Asia/Kolkata. Article timestamps are stored as UTC
 * ISO-8601, and formatting them in the runtime's local zone means the SERVER
 * decides what date an article carries. An article published at 03:00 IST
 * renders as the previous day when formatted in UTC — so the same article
 * would show one date in the server-rendered HTML and another after hydration
 * on a reader's machine, which React reports as a hydration mismatch. Pinning
 * the zone makes the output deterministic everywhere.
 *
 * NUMERALS ARE LATIN, not Devanagari. `hi-IN` defaults to Devanagari digits
 * (१२), which Indian readers overwhelmingly do not use for dates in print or
 * online. The `-u-nu-latn` extension asks for Hindi month names with Latin
 * numerals, which is what a Hindi newspaper masthead actually looks like.
 */

const LOCALE = 'hi-IN-u-nu-latn'
const TIME_ZONE = 'Asia/Kolkata'

const longDate = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: TIME_ZONE,
})

const shortDate = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: TIME_ZONE,
})

/**
 * Parse an ISO-8601 timestamp, or null.
 *
 * `publishedAt` is nullable in the schema (it is Lambda-owned and a draft has
 * never had one), and `new Date(null)` is silently the Unix epoch — so an
 * unguarded format would print "1 जनवरी 1970" on any article missing a date
 * rather than printing nothing.
 */
function parse(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "9 अगस्त 2026" — article pages, where the date is a real piece of content. */
export function formatLongDate(value: string | null | undefined): string {
  const date = parse(value)
  return date ? longDate.format(date) : ''
}

/** "9 अग. 2026" — feed cards and the admin table, where it is metadata. */
export function formatShortDate(value: string | null | undefined): string {
  const date = parse(value)
  return date ? shortDate.format(date) : ''
}

/**
 * The `datetime` attribute for a <time> element.
 *
 * Machine-readable UTC, deliberately unlike everything above: this is what
 * search engines and feed readers parse, and they want the instant, not the
 * Indian rendering of it.
 */
export function isoDateTime(value: string | null | undefined): string | undefined {
  return parse(value)?.toISOString()
}
