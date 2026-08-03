import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Hashing helpers shared by every Lambda.
 *
 * The rule this file exists to enforce: raw IP addresses are never stored.
 */

/** Stable, non-secret hash. Used for content-duplicate detection and for the
 *  newsletter's email-derived primary key. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * HMAC an IP address with a secret salt.
 *
 * A bare SHA-256 of an IP is reversible in seconds — the entire IPv4 space is
 * 2^32 and a rainbow table is trivial to build. The keyed HMAC is what makes
 * the stored value non-reversible without the salt. Truncated to 22 base64url
 * characters, which is still 132 bits: far beyond collision risk at our scale
 * and shorter to store on every rate-limit row.
 */
export function hashIp(ip: string, salt: string): string {
  return createHmac('sha256', salt).update(ip, 'utf8').digest('base64url').slice(0, 22)
}

/** Signature for one-click unsubscribe links. Stateless: verification
 *  recomputes it, so no database read is needed to validate. */
export function signUnsubscribe(subscriptionId: string, secret: string): string {
  return createHmac('sha256', secret).update(`unsub:${subscriptionId}`, 'utf8').digest('base64url')
}

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws on length mismatch, which would itself leak length
 * — so both sides are hashed to a fixed 32 bytes first. Used for verification
 * tokens and unsubscribe signatures.
 */
export function safeCompare(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest()
  const hb = createHash('sha256').update(b, 'utf8').digest()
  return timingSafeEqual(ha, hb)
}

/**
 * Extract a caller IP from an AppSync identity, falling back to the request
 * headers.
 *
 * `x-forwarded-for` is read from the END, not the start: a client can prepend
 * arbitrary values, so only the last hop — the one CloudFront appended — is
 * trustworthy.
 */
export function callerIp(
  identity: { sourceIp?: string[] } | null | undefined,
  headers?: Record<string, string | undefined> | null,
): string | undefined {
  const fromIdentity = identity?.sourceIp?.[0]
  if (fromIdentity) return fromIdentity

  const forwarded = headers?.['x-forwarded-for']
  if (!forwarded) return undefined

  const hops = forwarded
    .split(',')
    .map((hop) => hop.trim())
    .filter(Boolean)
  return hops.at(-1)
}
