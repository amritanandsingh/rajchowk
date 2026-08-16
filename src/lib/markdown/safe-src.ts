/**
 * Image-source safety for editor-authored content.
 *
 * The sibling of safe-href.ts, and it exists for the same reason that one
 * does: the sanitiser in sanitize-schema.ts restricts protocols on the parsed
 * tree, and this runs again at render time on what React is about to put in
 * the DOM. Two independent checks, because they fail differently — a parser
 * quirk producing an unexpected node shape would slip past one but not both.
 *
 * WHY NOT JUST CALL `safeHref`. It accepts two things that are meaningless
 * and unwanted in a `src`:
 *
 *   - `mailto:` — a legitimate link target, never an image;
 *   - `#fragment` — a same-page anchor, which as an image source resolves to
 *     the page itself and makes the browser re-request the document.
 *
 * Narrowing the protocol set is the whole difference, but it has to be a
 * separate function rather than a flag: the day someone widens safeHref to
 * accept a new link scheme, images must not silently inherit it.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Validate an image source from authored content.
 *
 * Returns null for anything that is not a plain image reference. Callers MUST
 * render nothing when this returns null — never fall back to the raw input,
 * which would reinstate exactly what was rejected.
 *
 * Site-relative paths are allowed; protocol-relative (`//evil.com`) is not —
 * it reads as relative and is not.
 */
export function safeSrc(src: string | null | undefined, siteUrl?: string): string | null {
  if (!src) return null

  const trimmed = src.trim()
  if (!trimmed) return null

  // Reject control characters and embedded whitespace outright. `java\tscript:`
  // and `java\nscript:` are classic filter bypasses: some parsers strip the
  // control character and normalise the result back into a working scheme.
  if (/[\u0000-\u0020\u007f-\u009f]/.test(trimmed)) return null

  if (trimmed.startsWith('//')) return null

  // A fragment is not an image. safeHref allows it; here it is a rejection.
  if (trimmed.startsWith('#')) return null

  // Site-relative paths need no further analysis — same origin by definition.
  if (trimmed.startsWith('/')) return trimmed

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    // Not an absolute URL and not a recognised relative form. Bare words like
    // "photo.jpg" land here and are rejected: guessing a scheme for the author
    // is how `javascript:` gets a second chance, and a relative filename has
    // no meaning once the article is served from a different path depth.
    return null
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null

  /**
   * Normalise an absolute self-reference back to a relative path.
   *
   * Compares ORIGINS, not href prefixes — the same look-alike-host defence
   * safe-href.ts documents. `https://rajchowk.in.evil.example/x.jpg` must not
   * be treated as ours and rewritten to a local-looking path.
   */
  if (siteUrl) {
    try {
      if (url.origin === new URL(siteUrl).origin) {
        return `${url.pathname}${url.search}` || '/'
      }
    } catch {
      // A malformed siteUrl must never make an external source look internal.
    }
  }

  return url.href
}
