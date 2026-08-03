import { describe, expect, it } from 'vitest'
import { callerIp, hashIp, safeCompare, sha256Hex, signUnsubscribe } from './hash'

describe('sha256Hex', () => {
  it('is deterministic and 64 hex characters', () => {
    const digest = sha256Hex('amrit@example.com')
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256Hex('amrit@example.com')).toBe(digest)
  })

  it('differs for different inputs', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'))
  })

  it('handles Devanagari input', () => {
    expect(sha256Hex('राज चौक')).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256Hex('राज चौक')).toBe(sha256Hex('राज चौक'))
    expect(sha256Hex('राज चौक')).not.toBe(sha256Hex('राज चौक '))
  })
})

describe('hashIp', () => {
  const salt = 'test-salt-not-a-real-secret'

  it('is deterministic for the same ip and salt', () => {
    expect(hashIp('203.0.113.7', salt)).toBe(hashIp('203.0.113.7', salt))
  })

  it('never returns the raw address', () => {
    const hashed = hashIp('203.0.113.7', salt)
    expect(hashed).not.toContain('203')
    expect(hashed).not.toContain('113')
  })

  it('produces a different value under a different salt', () => {
    // This is the property that makes the stored value non-reversible: an
    // attacker with the database but not the salt cannot rebuild the mapping.
    expect(hashIp('203.0.113.7', salt)).not.toBe(hashIp('203.0.113.7', 'other-salt'))
  })

  it('distinguishes different addresses', () => {
    expect(hashIp('203.0.113.7', salt)).not.toBe(hashIp('203.0.113.8', salt))
  })

  it('is 22 base64url characters with no padding', () => {
    const hashed = hashIp('2001:db8::1', salt)
    expect(hashed).toHaveLength(22)
    expect(hashed).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('handles IPv6', () => {
    expect(hashIp('2001:db8::1', salt)).not.toBe(hashIp('2001:db8::2', salt))
  })
})

describe('signUnsubscribe', () => {
  const secret = 'test-secret'

  it('is deterministic, so verification needs no database read', () => {
    expect(signUnsubscribe('abc123', secret)).toBe(signUnsubscribe('abc123', secret))
  })

  it('differs per subscription and per secret', () => {
    expect(signUnsubscribe('abc123', secret)).not.toBe(signUnsubscribe('abc124', secret))
    expect(signUnsubscribe('abc123', secret)).not.toBe(signUnsubscribe('abc123', 'other'))
  })

  it('is url-safe, since it is carried in a query string', () => {
    expect(signUnsubscribe('abc123', secret)).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('safeCompare', () => {
  it('matches identical strings', () => {
    expect(safeCompare('token', 'token')).toBe(true)
  })

  it('rejects different strings', () => {
    expect(safeCompare('token', 'tokeN')).toBe(false)
  })

  it('rejects strings of different length without throwing', () => {
    // timingSafeEqual throws on a length mismatch, which would itself leak
    // length. Both sides are hashed to 32 bytes first.
    expect(() => safeCompare('short', 'much-longer-value')).not.toThrow()
    expect(safeCompare('short', 'much-longer-value')).toBe(false)
  })

  it('handles empty strings', () => {
    expect(safeCompare('', '')).toBe(true)
    expect(safeCompare('', 'x')).toBe(false)
  })
})

describe('callerIp', () => {
  it('prefers the AppSync identity sourceIp', () => {
    expect(callerIp({ sourceIp: ['198.51.100.4'] }, { 'x-forwarded-for': '203.0.113.9' })).toBe(
      '198.51.100.4',
    )
  })

  it('falls back to x-forwarded-for', () => {
    expect(callerIp(undefined, { 'x-forwarded-for': '203.0.113.9' })).toBe('203.0.113.9')
  })

  it('takes the LAST forwarded hop, not the first', () => {
    // A client can prepend arbitrary values to x-forwarded-for. Only the last
    // hop — appended by CloudFront — is trustworthy. Reading the first entry
    // would let anyone spoof their way past the rate limiter.
    expect(callerIp(null, { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 203.0.113.9' })).toBe(
      '203.0.113.9',
    )
  })

  it('returns undefined when there is nothing to read', () => {
    expect(callerIp(undefined, undefined)).toBeUndefined()
    expect(callerIp(null, null)).toBeUndefined()
    expect(callerIp({ sourceIp: [] }, {})).toBeUndefined()
    expect(callerIp(undefined, { 'x-forwarded-for': '' })).toBeUndefined()
  })

  it('ignores empty hops', () => {
    expect(callerIp(null, { 'x-forwarded-for': '1.2.3.4, , ' })).toBe('1.2.3.4')
  })
})
