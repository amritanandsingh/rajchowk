import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipSubject, RATE_LIMITS, subjectFor, type RateLimitRule } from './rate-limit'

/**
 * Rate-limit budgets and subject derivation.
 *
 * The network path (`enforceRateLimit`) is exercised against the real table in
 * tests/integration/rate-limit.test.ts. What is worth pinning down here is the
 * shape of the budgets and, more importantly, that a raw IP never becomes a
 * stored key.
 */

const SALT = 'test-salt-not-a-real-secret'

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_TABLE_NAME', 'RateLimit-test')
  vi.stubEnv('RATE_LIMIT_IP_SALT', SALT)
})

const ALL_BUDGETS: Array<[string, RateLimitRule[]]> = [
  ['vote', RATE_LIMITS.vote('u_1')],
  ['upvote', RATE_LIMITS.upvote('u_1')],
  ['comment', RATE_LIMITS.comment('u_1', 'ip_x')],
  ['question', RATE_LIMITS.question('u_1')],
  ['report', RATE_LIMITS.report('u_1')],
  ['newsletter', RATE_LIMITS.newsletter('ip_x')],
  ['search', RATE_LIMITS.search('u_1')],
]

describe('RATE_LIMITS budgets', () => {
  it.each(ALL_BUDGETS)('%s declares at least one rule', (_name, rules) => {
    expect(rules.length).toBeGreaterThan(0)
  })

  it.each(ALL_BUDGETS)('%s uses positive limits and windows', (_name, rules) => {
    for (const rule of rules) {
      expect(rule.limit, rule.scope).toBeGreaterThan(0)
      expect(rule.windowSeconds, rule.scope).toBeGreaterThan(0)
      expect(rule.scope).toBeTruthy()
      expect(rule.subject).toBeTruthy()
    }
  })

  it.each(ALL_BUDGETS)('%s orders rules tightest-window-first per subject', (_name, rules) => {
    // enforceRateLimit short-circuits on the first rejection, so the burst rule
    // must come before the sustained one — otherwise a burst spends a write on
    // the sustained counter before being refused.
    //
    // The ordering only has to hold WITHIN a subject: the comment budget limits
    // the user and the IP independently, so its windows are not globally
    // monotonic and should not be.
    const bySubject = new Map<string, number[]>()
    for (const rule of rules) {
      bySubject.set(rule.subject, [...(bySubject.get(rule.subject) ?? []), rule.windowSeconds])
    }

    for (const [subject, windows] of bySubject) {
      expect(
        [...windows].sort((a, b) => a - b),
        subject,
      ).toEqual(windows)
    }
  })

  it.each(ALL_BUDGETS)('%s uses unique scopes so counters cannot collide', (_name, rules) => {
    const scopes = rules.map((rule) => rule.scope)
    expect(new Set(scopes).size).toBe(scopes.length)
  })

  it('namespaces every scope by operation, so budgets never share a counter', () => {
    const all = ALL_BUDGETS.flatMap(([, rules]) => rules.map((rule) => rule.scope))
    expect(new Set(all).size).toBe(all.length)
  })

  it('limits comments on the user AND the IP', () => {
    // A comment-spam ring runs many accounts from one host, so a per-user
    // budget alone does not stop it.
    const rules = RATE_LIMITS.comment('u_alice', 'ip_hashed')
    expect(rules.some((rule) => rule.subject === 'u_alice')).toBe(true)
    expect(rules.some((rule) => rule.subject === 'ip_hashed')).toBe(true)
  })

  it('keeps the question budget tighter than the comment budget', () => {
    // Questions are answered personally by the publisher, so the cost of spam
    // is higher and the budget is deliberately stricter.
    const question = RATE_LIMITS.question('u_1')[0]!
    const comment = RATE_LIMITS.comment('u_1', 'ip_1')[0]!
    expect(question.limit).toBeLessThanOrEqual(comment.limit)
  })
})

describe('subjectFor', () => {
  it('prefers the authenticated sub', () => {
    expect(subjectFor({ sub: 'abc-123', sourceIp: ['203.0.113.7'] })).toBe('u_abc-123')
  })

  it('falls back to a HASHED ip when unauthenticated', () => {
    const subject = subjectFor({ sourceIp: ['203.0.113.7'] })
    expect(subject.startsWith('ip_')).toBe(true)
    // The property that matters: the raw address never becomes a stored key.
    expect(subject).not.toContain('203.0.113.7')
    expect(subject).not.toContain('203')
  })

  it('is stable for the same ip, so the counter accumulates', () => {
    expect(subjectFor({ sourceIp: ['203.0.113.7'] })).toBe(
      subjectFor({ sourceIp: ['203.0.113.7'] }),
    )
  })

  it('distinguishes different ips', () => {
    expect(subjectFor({ sourceIp: ['203.0.113.7'] })).not.toBe(
      subjectFor({ sourceIp: ['203.0.113.8'] }),
    )
  })

  it('falls back to a fixed anonymous subject when there is nothing to key on', () => {
    // A shared bucket is the safe default: it throttles rather than exempting.
    expect(subjectFor(undefined)).toBe('anon_unknown')
    expect(subjectFor({})).toBe('anon_unknown')
    expect(subjectFor({ sourceIp: [] })).toBe('anon_unknown')
  })

  it('prefixes sub and ip subjects differently, so they cannot collide', () => {
    expect(subjectFor({ sub: 'x' })).toMatch(/^u_/)
    expect(subjectFor({ sourceIp: ['1.1.1.1'] })).toMatch(/^ip_/)
  })
})

describe('ipSubject', () => {
  it('hashes the address', () => {
    const subject = ipSubject('198.51.100.4')
    expect(subject.startsWith('ip_')).toBe(true)
    expect(subject).not.toContain('198.51.100.4')
  })

  it('agrees with subjectFor for the same address', () => {
    expect(ipSubject('198.51.100.4')).toBe(subjectFor({ sourceIp: ['198.51.100.4'] }))
  })

  it('returns the anonymous subject for a missing address', () => {
    expect(ipSubject(undefined)).toBe('anon_unknown')
  })

  it('handles IPv6', () => {
    expect(ipSubject('2001:db8::1')).not.toBe(ipSubject('2001:db8::2'))
  })
})
