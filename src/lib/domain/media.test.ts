import { describe, expect, it } from 'vitest'

import {
  ALLOWED_IMAGE_TYPES,
  MEDIA_KEY_PATTERN,
  MEDIA_LIMITS,
  isAllowedImageType,
  isValidMediaKey,
  mediaKeyFor,
  validateUpload,
} from './media'

/**
 * Upload rules.
 *
 * Two things here are security controls rather than validation niceties: the
 * SVG rejection, and the key pattern. The rest is ordinary bounds-checking.
 */

const ARTICLE_ID = '0d8f6b2a-1c34-4e77-9f21-abcdef123456'
const OBJECT_ID = 'a3f21c88-4b90-4c11-8e77-0123456789ab'

const upload = (over: Partial<{ contentType: string; byteSize: number }> = {}) => ({
  contentType: 'image/jpeg',
  byteSize: 200_000,
  ...over,
})

describe('validateUpload — accepted types', () => {
  it.each(Object.keys(ALLOWED_IMAGE_TYPES))('accepts %s', (contentType) => {
    expect(validateUpload(upload({ contentType }))).toEqual([])
  })
})

describe('validateUpload — SVG', () => {
  it('REJECTS image/svg+xml', () => {
    /**
     * The one rejection that is a security control rather than a preference.
     * An SVG is an XML document that may carry <script> and event handlers,
     * and a browser executes them when it loads the file. Every other accepted
     * type is inert data a decoder turns into pixels.
     */
    const errors = validateUpload(upload({ contentType: 'image/svg+xml' }))
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('SVG')
  })

  it('is not in the allowlist at all, so it cannot be reached another way', () => {
    expect(isAllowedImageType('image/svg+xml')).toBe(false)
    expect(Object.keys(ALLOWED_IMAGE_TYPES)).not.toContain('image/svg+xml')
  })
})

describe('validateUpload — other rejections', () => {
  it.each([
    ['a document', 'application/pdf'],
    ['HTML', 'text/html'],
    ['an unknown image format', 'image/gif'],
    ['a made-up type', 'image/jpeg; charset=evil'],
    ['empty', ''],
  ])('rejects %s', (_label, contentType) => {
    expect(validateUpload(upload({ contentType })).length).toBeGreaterThan(0)
  })

  it('rejects a file over the size ceiling', () => {
    const errors = validateUpload(upload({ byteSize: MEDIA_LIMITS.maxBytes + 1 }))
    expect(errors).toHaveLength(1)
    expect(errors[0]!.message).toContain('MB')
  })

  it('accepts a file exactly at the ceiling', () => {
    // An off-by-one here would reject a file the message says is allowed.
    expect(validateUpload(upload({ byteSize: MEDIA_LIMITS.maxBytes }))).toEqual([])
  })

  it.each([
    ['zero bytes', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s', (_label, byteSize) => {
    expect(validateUpload(upload({ byteSize })).length).toBeGreaterThan(0)
  })

  it('reports the type AND the size together', () => {
    // One round of corrections, not two.
    const errors = validateUpload({ contentType: 'application/pdf', byteSize: 0 })
    expect(errors).toHaveLength(2)
  })
})

describe('mediaKeyFor', () => {
  it('groups an object under its article', () => {
    expect(mediaKeyFor(ARTICLE_ID, OBJECT_ID, 'jpg')).toBe(
      `articles/${ARTICLE_ID}/${OBJECT_ID}.jpg`,
    )
  })

  it('produces a key it would itself accept', () => {
    const key = mediaKeyFor(ARTICLE_ID, OBJECT_ID, 'webp')
    expect(key).not.toBeNull()
    expect(isValidMediaKey(key!)).toBe(true)
  })

  it('lowercases both ids so one article cannot own two prefixes', () => {
    expect(mediaKeyFor(ARTICLE_ID.toUpperCase(), OBJECT_ID.toUpperCase(), 'png')).toBe(
      `articles/${ARTICLE_ID}/${OBJECT_ID}.png`,
    )
  })

  it.each([
    ['a traversal attempt in the article id', '../../etc', OBJECT_ID, 'jpg'],
    ['a traversal attempt in the object id', ARTICLE_ID, '../../../secret', 'jpg'],
    ['a slash in the object id', ARTICLE_ID, `${OBJECT_ID}/nested`, 'jpg'],
    ['a non-uuid article id', 'not-a-uuid', OBJECT_ID, 'jpg'],
    ['an extension outside the allowlist', ARTICLE_ID, OBJECT_ID, 'svg'],
    ['a double extension', ARTICLE_ID, OBJECT_ID, 'jpg.html'],
  ])('returns null for %s rather than a usable key', (_label, articleId, objectId, extension) => {
    // Refusing beats sanitising: a key this function will not build is a key
    // the Lambda will not sign.
    expect(mediaKeyFor(articleId, objectId, extension)).toBeNull()
  })
})

describe('MEDIA_KEY_PATTERN', () => {
  it.each([
    ['a bare filename', 'photo.jpg'],
    ['an absolute path', '/articles/x/y.jpg'],
    ['a traversal', `articles/${ARTICLE_ID}/../../../secret.jpg`],
    ['another prefix', `uploads/${ARTICLE_ID}/${OBJECT_ID}.jpg`],
    ['no extension', `articles/${ARTICLE_ID}/${OBJECT_ID}`],
    ['a trailing suffix', `articles/${ARTICLE_ID}/${OBJECT_ID}.jpg.html`],
  ])('rejects %s', (_label, key) => {
    expect(isValidMediaKey(key)).toBe(false)
  })

  it('is anchored at both ends', () => {
    expect(MEDIA_KEY_PATTERN.source.startsWith('^')).toBe(true)
    expect(MEDIA_KEY_PATTERN.source.endsWith('$')).toBe(true)
  })
})
