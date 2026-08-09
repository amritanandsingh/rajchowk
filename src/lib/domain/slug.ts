/**
 * URL slug derivation.
 *
 * Modules under src/lib/domain/ are shared with the Lambdas in amplify/, which
 * import them by RELATIVE PATH and bundle them with esbuild. They must
 * therefore stay pure: no React, no next/*, no DOM globals, no `@/` aliases.
 * Breaking that rule fails the backend build, not the frontend one, which is a
 * slow way to find out.
 *
 * The rule that shapes this file: a slug is a PERMANENT PUBLIC URL
 * (/article/<slug>), and this product is written in Hindi. Devanagari has no
 * ASCII form, so `slugify` deliberately returns '' rather than inventing one —
 * a transliterated guess would be baked into a URL that cannot be changed
 * afterwards without breaking every inbound link.
 *
 * `deriveSlug` is the layer above that decides what to do about it.
 */

/** Shared with the `pattern` attribute on the slug input, so the browser's
 *  validation and the server's agree by construction rather than by review. */
export const SLUG_PATTERN = '[a-z0-9-]+'

/** Long enough for any real headline slug; short enough to keep URLs readable. */
export const MAX_SLUG_LENGTH = 80

/** Lowercase alphanumeric groups joined by single hyphens. No leading or
 *  trailing hyphen, no double hyphen. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Latin combining marks left behind by NFKD decomposition (é -> e + U+0301). */
const COMBINING_MARKS = /[̀-ͯ]/g

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
  return value.length > 0 && value.length <= MAX_SLUG_LENGTH && SLUG.test(value)
}

/**
 * Prefix for the fallback slug of a headline with no ASCII content.
 *
 * "lekh" (लेख, "article") rather than a bare id, so the URL still reads as a
 * URL. This is the honest outcome for a Devanagari headline: a stable opaque
 * identifier, not a machine transliteration pretending to be words.
 */
const FALLBACK_PREFIX = 'lekh'

/**
 * The slug an article will actually get.
 *
 * Precedence, and each step exists for a reason:
 *
 *  1. An explicit slug the editor typed. They know the URL matters; if they
 *     bothered to choose one it wins over anything derived.
 *  2. Slugified title. Works for code-mixed headlines ("Delhi में बड़ा फैसला"
 *     -> "delhi"), which are common enough to be worth handling.
 *  3. `lekh-<first 8 of the article id>`. Reached for a fully Devanagari
 *     headline, which is the NORMAL case for this product — so this is a
 *     first-class path, not an error branch.
 *
 * Uniqueness is NOT decided here. This function is pure and cannot see the
 * table; the save-article handler queries `articlesBySlug` and appends a
 * suffix on collision. Keeping the two apart is what makes this testable
 * without DynamoDB.
 */
export function deriveSlug(options: {
  explicitSlug?: string | null | undefined
  title: string
  articleId: string
}): string {
  const explicit = options.explicitSlug?.trim().toLowerCase()
  if (explicit && isSlug(explicit)) return explicit

  const fromTitle = slugify(options.title)
  if (fromTitle) return fromTitle

  // Hyphens removed so the id segment reads as one token. UUIDs are hex, so
  // the result is always valid slug alphabet.
  const suffix = options.articleId.replace(/-/g, '').slice(0, 8).toLowerCase()
  return `${FALLBACK_PREFIX}-${suffix}`
}

/**
 * Disambiguate a slug that is already taken.
 *
 * A numeric suffix rather than a random one, so re-running against the same
 * collision is deterministic and the URLs stay guessable in the obvious way
 * (`-2`, `-3`). Truncates the base first so the result cannot exceed
 * MAX_SLUG_LENGTH and silently become a different slug than the caller checked.
 */
export function withSuffix(slug: string, attempt: number): string {
  const suffix = `-${attempt}`
  const base = slug.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, '')
  return `${base}${suffix}`
}
