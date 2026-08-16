/**
 * Image upload rules — the single definition, shared by both sides.
 *
 * Pure module, same discipline as article.ts: imported by the Lambda in
 * amplify/ by relative path, so no React, no next/*, no DOM globals, no `@/`
 * aliases.
 *
 * The browser check is a CONVENIENCE — it stops a 40 MB photo being uploaded
 * before the network is touched. The call inside the Lambda is the one that
 * decides, and it runs against arguments that crossed the network and cannot
 * be trusted no matter what the file picker did.
 */

/**
 * WHY SVG IS NOT HERE, AND MUST NOT BE ADDED.
 *
 * An SVG is not an image in the sense the rest of this list is — it is an XML
 * document that may contain `<script>`, `<foreignObject>` and event handlers,
 * and a browser executes all of them when the file is loaded as a document.
 * Every other type on this list is inert data that a decoder turns into
 * pixels; SVG is the one that can act.
 *
 * The sanitiser cannot help here: it governs the article's Markdown, not the
 * bytes behind a URL the Markdown points at. Serving the file from a separate
 * origin and with `nosniff` limits the blast radius, but the honest control is
 * simply not to accept the format.
 *
 * Keyed by MIME type, valued by the extension the stored object gets. The
 * extension is derived here rather than taken from the uploaded filename,
 * which is attacker-controlled and routinely contains `../` or a second dot.
 */
export const ALLOWED_IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type AllowedImageType = keyof typeof ALLOWED_IMAGE_TYPES

export const MEDIA_LIMITS = {
  /**
   * 5 MB. Generous for editorial photography straight off a phone, and small
   * enough that a single article cannot quietly cost a reader thirty megabytes
   * — there is no resizing step in this system, so whatever is uploaded is
   * exactly what every reader downloads.
   */
  maxBytes: 5 * 1024 * 1024,
} as const

/** Mirrors ArticleFieldError so the form can place these the same way. */
export type MediaFieldError = { field: 'image'; message: string }

export type MediaUploadInput = {
  contentType: string
  byteSize: number
}

const MEGABYTE = 1024 * 1024

export function isAllowedImageType(value: string): value is AllowedImageType {
  return Object.prototype.hasOwnProperty.call(ALLOWED_IMAGE_TYPES, value)
}

/**
 * Validate an upload request before anything is signed or sent.
 *
 * Returns every error rather than the first, matching validateArticle, so the
 * editor is told about the type and the size in one go instead of discovering
 * them one attempt at a time.
 */
export function validateUpload(input: MediaUploadInput): MediaFieldError[] {
  const errors: MediaFieldError[] = []

  if (!input.contentType) {
    errors.push({ field: 'image', message: 'चित्र का प्रकार पहचाना नहीं जा सका।' })
  } else if (!isAllowedImageType(input.contentType)) {
    errors.push({
      field: 'image',
      message: 'केवल JPG, PNG या WebP चित्र चलेंगे। SVG स्वीकार नहीं किया जाता।',
    })
  }

  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0) {
    errors.push({ field: 'image', message: 'यह फ़ाइल खाली है।' })
  } else if (input.byteSize > MEDIA_LIMITS.maxBytes) {
    const limit = Math.round(MEDIA_LIMITS.maxBytes / MEGABYTE)
    errors.push({ field: 'image', message: `चित्र अधिकतम ${limit} MB का हो सकता है।` })
  }

  return errors
}

/**
 * The one legal shape for a stored object key.
 *
 * Anchored at both ends, and every segment is constrained: a UUID article id,
 * a UUID object id, one of three extensions. There is no path separator a
 * caller could reach and no way to express `..`, so a key that matches this
 * cannot escape the `articles/` prefix the IAM policy is scoped to.
 */
export const MEDIA_KEY_PATTERN =
  /^articles\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/

/**
 * Build the key for a new object.
 *
 * Grouped under the article id so everything belonging to one piece is in one
 * prefix — which is what would make a future cleanup job expressible at all.
 * The article id is available before the row exists (it is minted in
 * app/admin/articles/new/page.tsx as the idempotency key), so this works on
 * the very first upload of a brand-new article.
 *
 * Both ids are lowercased and the result is verified against the pattern
 * above: the function refuses to produce a key it would not itself accept,
 * rather than leaving that to the caller to remember.
 */
export function mediaKeyFor(articleId: string, objectId: string, extension: string): string | null {
  const key = `articles/${articleId.toLowerCase()}/${objectId.toLowerCase()}.${extension}`
  return MEDIA_KEY_PATTERN.test(key) ? key : null
}

/** Whether a key is one this system could have produced. The Lambda checks
 *  this immediately before signing, so a bug upstream cannot turn into a
 *  signed URL pointing somewhere unintended. */
export function isValidMediaKey(key: string): boolean {
  return MEDIA_KEY_PATTERN.test(key)
}
