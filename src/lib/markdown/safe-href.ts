/**
 * Link safety for editor-authored and user-authored content.
 *
 * Pure module — no React, no DOM. Shared by the markdown renderer and the
 * comment linkifier, and unit-tested directly.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * Validate a href from untrusted content.
 *
 * Returns null for anything that is not a plain navigational link. The caller
 * must render the link text as plain text when this returns null — never fall
 * back to the raw input.
 *
 * Site-relative paths are allowed, but protocol-relative (`//evil.com`) is
 * NOT: it looks relative and is not.
 */
export function safeHref(href: string | null | undefined, siteUrl?: string): string | null {
  if (!href) return null

  const trimmed = href.trim()
  if (!trimmed) return null

  // Reject control characters and whitespace outright: `java\tscript:` and
  // `java\nscript:` are classic filter bypasses that some parsers normalise
  // back into a working scheme.
  if (/[\u0000-\u0020\u007f-\u009f]/.test(trimmed)) return null

  // Protocol-relative URLs read as relative but are not.
  if (trimmed.startsWith('//')) return null

  // Same-page and site-relative links.
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return trimmed

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    // Not an absolute URL and not a recognised relative form.
    return null
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null

  // Normalise an absolute self-link back to a relative path.
  //
  // This MUST compare origins, not href prefixes. A naive
  // `url.href.startsWith(siteUrl)` treats https://rajchowk.in.evil.com/x as
  // internal — the attacker's host merely has to begin with ours — and would
  // then strip it to ".evil.com/x", which renders as a relative link to an
  // attacker-chosen path. Caught by safe-href.test.ts.
  if (siteUrl) {
    try {
      if (url.origin === new URL(siteUrl).origin) {
        return `${url.pathname}${url.search}${url.hash}` || '/'
      }
    } catch {
      // A malformed siteUrl must not make an external link look internal.
    }
  }

  return url.href
}

/** Is this href external, and therefore in need of rel/target treatment? */
export function isExternalHref(href: string, siteUrl?: string): boolean {
  if (href.startsWith('/') || href.startsWith('#')) return false
  if (siteUrl && href.startsWith(siteUrl)) return false
  return /^https?:/i.test(href)
}

/**
 * Split plain text into runs of text and safe links.
 *
 * Used for comments, which are stored as PLAIN TEXT and never parsed as
 * markdown. Tokenising on whitespace and validating each candidate with
 * `new URL()` is deliberately more conservative than a URL regex — a regex
 * that tries to find URLs inside arbitrary text is exactly where these things
 * go wrong.
 */
export type TextRun = { type: 'text'; value: string } | { type: 'link'; href: string; text: string }

const MAX_DISPLAY_LENGTH = 60

export function linkifyPlainText(input: string): TextRun[] {
  const runs: TextRun[] = []
  let buffer = ''

  for (const token of input.split(/(\s+)/)) {
    const candidate = token.trim()

    // Only bother with things that already look like an absolute web link.
    if (!/^https?:\/\//i.test(candidate)) {
      buffer += token
      continue
    }

    // Trailing punctuation is almost always sentence punctuation, not URL.
    // The Devanagari danda and double danda MUST be in this set: without
    // them `new URL()` percent-encodes them into the href, so every Hindi
    // sentence ending on a link produces a broken URL.
    const match = /[),.;:!?।॥]+$/u.exec(candidate)
    const trailing = match ? match[0] : ''
    const bare = trailing ? candidate.slice(0, -trailing.length) : candidate

    const href = safeHref(bare)
    if (!href || !/^https?:/i.test(href)) {
      buffer += token
      continue
    }

    if (buffer) {
      runs.push({ type: 'text', value: buffer })
      buffer = ''
    }

    const display =
      bare.length > MAX_DISPLAY_LENGTH ? `${bare.slice(0, MAX_DISPLAY_LENGTH)}…` : bare
    runs.push({ type: 'link', href, text: display })

    if (trailing) buffer += trailing
    // Preserve the whitespace token that followed.
    if (token !== candidate) buffer += token.slice(candidate.length)
  }

  if (buffer) runs.push({ type: 'text', value: buffer })
  return runs
}
