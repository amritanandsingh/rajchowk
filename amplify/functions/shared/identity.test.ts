import { describe, expect, it } from 'vitest'

import { callerFrom, isAdmin } from './identity'

/**
 * Caller identity and the admin predicate.
 *
 * These two functions decide every write authorization in the system, so the
 * cases below are deliberately adversarial: what a hostile or malformed
 * identity object does, not merely what a well-formed one does.
 *
 * Worth restating what these tests can and cannot prove. `event.identity` is
 * populated by AppSync from a JWT it has ALREADY verified against the pool's
 * JWKS, so a forged `cognito:groups` never reaches this code. These tests
 * cover the layer below that: given whatever AppSync hands us, do we read the
 * claim correctly and fail closed when we cannot.
 */

const sub = '9f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f'

describe('callerFrom', () => {
  it('reads sub, groups and a preferred_username byline', () => {
    const caller = callerFrom({
      sub,
      username: sub,
      groups: ['ADMIN'],
      claims: { sub, preferred_username: 'अमृत', email: 'amrit@example.com' },
    })

    expect(caller).toEqual({ sub, displayName: 'अमृत', groups: ['ADMIN'] })
  })

  it('falls back to the email LOCAL-PART for the byline, never the full address', () => {
    // An article byline is public. Publishing "amrit@example.com" under a
    // headline hands a real address to every scraper that reads the feed.
    const caller = callerFrom({ sub, claims: { sub, email: 'amrit@example.com' } })
    expect(caller?.displayName).toBe('amrit')
    expect(caller?.displayName).not.toContain('@')
  })

  it('falls back to the username when there is no email', () => {
    const caller = callerFrom({ sub, username: 'editor-1', claims: { sub } })
    expect(caller?.displayName).toBe('editor-1')
  })

  it('has a last-resort byline rather than an empty one', () => {
    const caller = callerFrom({ sub, claims: { sub } })
    expect(caller?.displayName).toBe('संपादक')
  })

  it('reads groups from the raw cognito:groups claim when `groups` is absent', () => {
    // Which field is populated depends on the resolver kind. A handler that
    // only checked one authorised nobody when invoked the other way — an
    // outage-shaped bug, and an easy one to ship.
    const caller = callerFrom({ sub, claims: { sub, 'cognito:groups': ['ADMIN'] } })
    expect(caller?.groups).toEqual(['ADMIN'])
  })

  it('reads a space-delimited cognito:groups claim', () => {
    // Some Cognito configurations serialise the claim as a string.
    const caller = callerFrom({ sub, claims: { sub, 'cognito:groups': 'ADMIN EDITOR' } })
    expect(caller?.groups).toEqual(['ADMIN', 'EDITOR'])
  })

  it('falls back to the sub inside claims when the top-level one is missing', () => {
    const caller = callerFrom({ claims: { sub } })
    expect(caller?.sub).toBe(sub)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'ADMIN'],
    ['a number', 1],
    ['an empty object', {}],
    ['an identity with no sub', { username: 'x', groups: ['ADMIN'] }],
    ['an identity with an empty sub', { sub: '', groups: ['ADMIN'] }],
  ])('returns null for %s', (_label, identity) => {
    // Null rather than a partially-filled object, so a caller cannot proceed
    // with an empty `sub` and write an article owned by nobody.
    expect(callerFrom(identity)).toBeNull()
  })

  it('drops non-string entries from a groups array', () => {
    const caller = callerFrom({ sub, claims: { sub, 'cognito:groups': ['ADMIN', 42, null] } })
    expect(caller?.groups).toEqual(['ADMIN'])
  })
})

describe('isAdmin', () => {
  it('is true only for a caller carrying the ADMIN group', () => {
    expect(isAdmin(callerFrom({ sub, groups: ['ADMIN'] }))).toBe(true)
  })

  it('is true when ADMIN sits alongside other groups', () => {
    expect(isAdmin(callerFrom({ sub, groups: ['EDITOR', 'ADMIN'] }))).toBe(true)
  })

  it('is FALSE for an authenticated user in no group', () => {
    // The requirement in one line: an authenticated ordinary Cognito user must
    // not automatically be an administrator.
    expect(isAdmin(callerFrom({ sub, groups: [] }))).toBe(false)
  })

  it('is FALSE for an authenticated user in a different group', () => {
    expect(isAdmin(callerFrom({ sub, groups: ['EDITOR'] }))).toBe(false)
  })

  it('is FALSE for an unauthenticated caller', () => {
    expect(isAdmin(null)).toBe(false)
  })

  it.each(['admin', 'Admin', 'ADMIN ', ' ADMIN'])(
    'is FALSE for the near-miss group %o',
    (group) => {
      // Case-sensitive, exact. Cognito group names are case-sensitive, so a
      // lenient comparison here would grant admin to a group someone created
      // by mistake.
      expect(isAdmin(callerFrom({ sub, groups: [group] }))).toBe(false)
    },
  )
})
