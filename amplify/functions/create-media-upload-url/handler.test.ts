import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The presign handler.
 *
 * This function hands out a CREDENTIAL — a signed grant to write one object
 * into the media bucket — so the assertions below are mostly about who is
 * refused, and about the exact shape of what gets signed when someone is not.
 *
 * The signer is mocked. What matters is not that AWS's SigV4 works, but which
 * bucket, key, content type and length this code asks it to bind into the
 * signature, because those four are what bound the grant.
 */

const getSignedUrl = vi.fn()

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrl(...args),
}))

process.env['MEDIA_BUCKET_NAME'] = 'media-bucket-test'
process.env['MEDIA_CDN_DOMAIN'] = 'd111111abcdef8.cloudfront.net'

const { handler } = await import('./handler')

const ADMIN_IDENTITY = { sub: 'admin-sub', claims: { sub: 'admin-sub' }, groups: ['ADMIN'] }
const ARTICLE_ID = '0d8f6b2a-1c34-4e77-9f21-abcdef123456'

const invoke = (event: { identity: unknown; arguments: Record<string, unknown> }) =>
  (handler as unknown as (e: unknown) => Promise<Record<string, unknown>>)(event)

const args = (over: Record<string, unknown> = {}) => ({
  articleId: ARTICLE_ID,
  contentType: 'image/jpeg',
  byteSize: 200_000,
  ...over,
})

/** The PutObjectCommand the signer was handed. */
const signedCommand = () => getSignedUrl.mock.calls[0]?.[1] as { input: Record<string, unknown> }

beforeEach(() => {
  getSignedUrl.mockReset().mockResolvedValue('https://media-bucket-test.s3.amazonaws.com/signed')
})

describe('authorization', () => {
  it('refuses an unauthenticated caller without signing anything', async () => {
    const result = await invoke({ identity: null, arguments: args() })

    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' })
    expect(getSignedUrl).not.toHaveBeenCalled()
    // A failure must not hand back a half-formed target.
    expect(result['uploadUrl']).toBeNull()
  })

  it('refuses an authenticated non-admin', async () => {
    // AppSync's allow.group(ADMIN) should already have stopped this. That it
    // is checked again here is the point — this guard catches a mutation added
    // to the schema without its authorization rule.
    const result = await invoke({
      identity: { sub: 'member-sub', claims: { sub: 'member-sub' }, groups: [] },
      arguments: args(),
    })

    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(getSignedUrl).not.toHaveBeenCalled()
  })
})

describe('validation happens before signing', () => {
  it('REFUSES an SVG', async () => {
    // The one rejection that is a security control: an SVG is a script
    // container, and this is the only accepted-looking format that can act.
    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: args({ contentType: 'image/svg+xml' }),
    })

    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it.each([
    ['a PDF', { contentType: 'application/pdf' }],
    ['HTML', { contentType: 'text/html' }],
    ['a missing content type', { contentType: '' }],
    ['an over-size file', { byteSize: 5 * 1024 * 1024 + 1 }],
    ['an empty file', { byteSize: 0 }],
  ])('refuses %s', async (_label, over) => {
    const result = await invoke({ identity: ADMIN_IDENTITY, arguments: args(over) })

    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it('refuses an article id that is not a uuid, rather than signing a odd key', async () => {
    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: args({ articleId: '../../etc/passwd' }),
    })

    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(getSignedUrl).not.toHaveBeenCalled()
  })
})

describe('the signed grant', () => {
  it('binds the bucket and a server-derived key', async () => {
    await invoke({ identity: ADMIN_IDENTITY, arguments: args() })

    const input = signedCommand().input
    expect(input['Bucket']).toBe('media-bucket-test')
    // Grouped under the article, with a uuid filename this handler minted.
    expect(input['Key']).toMatch(new RegExp(`^articles/${ARTICLE_ID}/[0-9a-f-]{36}\\.jpg$`))
  })

  it('takes the extension from the content type, never from a filename', async () => {
    await invoke({ identity: ADMIN_IDENTITY, arguments: args({ contentType: 'image/webp' }) })
    expect(signedCommand().input['Key']).toMatch(/\.webp$/)
  })

  it('ignores anything path-like the caller sends alongside', async () => {
    // There is no filename or key argument in the schema, but a caller can put
    // extra fields on the wire. None of them may reach the key.
    await invoke({
      identity: ADMIN_IDENTITY,
      arguments: args({ key: 'evil.html', filename: '../../../etc/passwd', path: '/wherever' }),
    })

    const key = signedCommand().input['Key'] as string
    expect(key).toMatch(/^articles\//)
    expect(key).not.toContain('..')
    expect(key).not.toContain('evil')
  })

  it('signs the content type and length, so the grant is bounded not merely described', async () => {
    // Without these in the signature the size limit is advisory: a URL issued
    // for a 200 KB JPEG would accept 40 MB of anything.
    await invoke({ identity: ADMIN_IDENTITY, arguments: args() })

    const input = signedCommand().input
    expect(input['ContentType']).toBe('image/jpeg')
    expect(input['ContentLength']).toBe(200_000)
  })

  it('expires in minutes, not hours', async () => {
    await invoke({ identity: ADMIN_IDENTITY, arguments: args() })

    const options = getSignedUrl.mock.calls[0]?.[2] as { expiresIn: number }
    expect(options.expiresIn).toBeLessThanOrEqual(900)
    expect(options.expiresIn).toBeGreaterThan(0)
  })
})

describe('the response', () => {
  it('returns the CDN URL, never the bucket URL', async () => {
    const result = await invoke({ identity: ADMIN_IDENTITY, arguments: args() })

    // The bucket is private. Publishing an S3 URL would be a promise the
    // infrastructure deliberately does not keep — every reader would get 403.
    expect(result['mediaUrl']).toMatch(/^https:\/\/d111111abcdef8\.cloudfront\.net\/articles\//)
    expect(result['mediaUrl']).not.toContain('s3')
    expect(result).toMatchObject({ ok: true, code: null })
  })

  it('returns the signed URL for the browser to PUT to', async () => {
    const result = await invoke({ identity: ADMIN_IDENTITY, arguments: args() })
    expect(result['uploadUrl']).toBe('https://media-bucket-test.s3.amazonaws.com/signed')
  })

  it('the CDN URL and the signed key refer to the same object', async () => {
    const result = await invoke({ identity: ADMIN_IDENTITY, arguments: args() })

    // A mismatch here means the editor writes a URL that will 404 forever.
    expect(result['mediaUrl']).toContain(signedCommand().input['Key'] as string)
  })

  it('degrades to INTERNAL without leaking the SDK error', async () => {
    getSignedUrl.mockRejectedValue(new Error('AccessDenied: arn:aws:s3:::secret-bucket'))

    const result = await invoke({ identity: ADMIN_IDENTITY, arguments: args() })

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL' })
    // The bucket ARN stays in CloudWatch; it is reconnaissance in a browser.
    expect(JSON.stringify(result)).not.toContain('secret-bucket')
  })
})
