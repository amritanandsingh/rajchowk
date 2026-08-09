/**
 * URL slug derivation.
 *
 * Modules under src/lib/domain/ are shared with the Lambdas in amplify/, which
 * import them by relative path and bundle them with esbuild. They must
 * therefore stay pure: no React, no next/*, no DOM globals, no `@/` aliases.
 *
 * The rule that shapes this file: a slug is a PERMANENT PUBLIC URL
 * (/category/<slug>, /news/<slug>), and this product is written in Hindi. So
 * slugs are derived from the English name, never the Hindi one — Devanagari has
 * no ASCII form, and `slugify` deliberately returns '' rather than inventing
 * one. An empty return means "ask the human for a slug", never "generate one":
 * a random or transliterated guess would be baked into a URL that can no longer
 * be changed without breaking every inbound link.
 */

/** Shared with the `pattern` attribute on slug inputs, so both agree by construction. */
export const SLUG_PATTERN = '[a-z0-9-]+'

/** Long enough for any real headline slug; short enough to keep URLs readable. */
export const MAX_SLUG_LENGTH = 80

/** Lowercase alphanumeric groups joined by single hyphens. No leading/trailing hyphen. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Latin combining marks left behind by NFKD decomposition (é -> e + U+0301). */
const COMBINING_MARKS = /[\u0300-\u036f]/g

/**
 * Best-effort ASCII slug.
 *
 * Returns '' when the input has no ASCII alphanumerics at all — which is the
 * case for any purely Devanagari string, because Devanagari letters are
 * letters, not combining marks, and so survive NFKD unchanged.
 */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      .replace(COMBINING_MARKS, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_SLUG_LENGTH)
      // The slice can land mid-word and leave a trailing hyphen behind.
      .replace(/-+$/g, '')
  )
}

export function isSlug(value: string): boolean {
  return value.length <= MAX_SLUG_LENGTH && SLUG.test(value)
}
