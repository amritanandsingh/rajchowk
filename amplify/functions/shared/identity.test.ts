import { describe, expect, it } from 'vitest'
import {
  callerFrom,
  canPublish,
  GROUP,
  hasGroup,
  isAdmin,
  isModerator,
  isStaff,
  type Caller,
} from './identity'

/**
 * The authorization predicates.
 *
 * These are the functions every privileged Lambda calls before doing anything,
 * so their boundaries are worth pinning down precisely. The most important
 * property is negative: identity comes from the verified token and from nowhere
 * else, so there is no argument a caller could forge.
 */

const caller = (groups: string[], overrides: Partial<Caller> = {}): Caller => ({
  sub: 'sub-1',
  username: 'user-1',
  groups,
  sourceIp: undefined,
  ...overrides,
})

describe('callerFrom', () => {
  it('extracts the identity from a Cognito claim set', () => {
    expect(
      callerFrom({
        sub: 'abc-123',
        username: 'amrit',
        groups: ['ADMIN'],
        sourceIp: ['203.0.113.7'],
      }),
    ).toEqual({
      sub: 'abc-123',
      username: 'amrit',
      groups: ['ADMIN'],
      sourceIp: '203.0.113.7',
    })
  })

  it('returns null when there is no sub — an unauthenticated request', () => {
    // Every handler treats null as UNAUTHENTICATED. Anything that produced a
    // non-null caller without a verified sub would be a privilege escalation.
    expect(callerFrom(undefined)).toBeNull()
    expect(callerFrom(null)).toBeNull()
    expect(callerFrom({})).toBeNull()
    expect(callerFrom({ username: 'amrit', groups: ['ADMIN'] })).toBeNull()
    expect(callerFrom({ sub: '' })).toBeNull()
  })

  it('falls back to the sub when no username is present', () => {
    expect(callerFrom({ sub: 'abc-123' })?.username).toBe('abc-123')
  })

  it('treats a null or missing group list as no groups, never as all groups', () => {
    expect(callerFrom({ sub: 'x', groups: null })?.groups).toEqual([])
    expect(callerFrom({ sub: 'x' })?.groups).toEqual([])
  })

  it('takes only the first sourceIp, and undefined when the list is empty', () => {
    expect(callerFrom({ sub: 'x', sourceIp: ['1.1.1.1', '2.2.2.2'] })?.sourceIp).toBe('1.1.1.1')
    expect(callerFrom({ sub: 'x', sourceIp: [] })?.sourceIp).toBeUndefined()
    expect(callerFrom({ sub: 'x' })?.sourceIp).toBeUndefined()
  })

  it('ignores any group claim smuggled in as a non-array', () => {
    // A malformed claim must not widen access.
    const result = callerFrom({ sub: 'x', groups: 'ADMIN' as unknown as string[] })
    expect(isAdmin(result)).toBe(false)
  })
})

describe('hasGroup', () => {
  it('matches any of the listed groups', () => {
    expect(hasGroup(caller(['EDITOR']), GROUP.ADMIN, GROUP.EDITOR)).toBe(true)
    expect(hasGroup(caller(['MEMBER']), GROUP.ADMIN, GROUP.EDITOR)).toBe(false)
  })

  it('is false for a null caller and for an empty group list', () => {
    expect(hasGroup(null, GROUP.ADMIN)).toBe(false)
    expect(hasGroup(caller([]), GROUP.ADMIN)).toBe(false)
  })

  it('is exact about group names — no prefix or case tolerance', () => {
    expect(hasGroup(caller(['admin']), GROUP.ADMIN)).toBe(false)
    expect(hasGroup(caller(['ADMINISTRATOR']), GROUP.ADMIN)).toBe(false)
    expect(hasGroup(caller(['SUPER_ADMIN']), GROUP.ADMIN)).toBe(false)
  })
})

describe('role predicates', () => {
  it.each([
    ['ADMIN', true, true, true, true],
    ['EDITOR', false, true, true, false],
    ['MODERATOR', false, false, true, false],
    ['MEMBER', false, false, false, false],
  ])(
    '%s: admin=%s staff=%s moderator=%s canPublish=%s',
    (group, admin, staff, moderator, publish) => {
      const subject = caller([group])
      expect(isAdmin(subject)).toBe(admin)
      expect(isStaff(subject)).toBe(staff)
      expect(isModerator(subject)).toBe(moderator)
      expect(canPublish(subject)).toBe(publish)
    },
  )

  it('grants nothing to an unauthenticated caller', () => {
    for (const predicate of [isAdmin, isStaff, isModerator, canPublish]) {
      expect(predicate(null)).toBe(false)
    }
  })

  it('grants nothing to a caller with no groups', () => {
    const subject = caller([])
    for (const predicate of [isAdmin, isStaff, isModerator, canPublish]) {
      expect(predicate(subject)).toBe(false)
    }
  })

  it('restricts publishing to ADMIN — the editor/publisher boundary', () => {
    // "Only an administrator can publish." The publishArticle @auth directive
    // admits EDITOR too, because editors legitimately submit for review and
    // return to draft; canPublish is the check that separates those cases.
    expect(canPublish(caller(['EDITOR']))).toBe(false)
    expect(canPublish(caller(['MODERATOR']))).toBe(false)
    expect(canPublish(caller(['EDITOR', 'MODERATOR']))).toBe(false)
    expect(canPublish(caller(['ADMIN']))).toBe(true)
  })

  it('resolves a multi-group caller by the widest role held', () => {
    const subject = caller(['MEMBER', 'MODERATOR'])
    expect(isModerator(subject)).toBe(true)
    expect(isStaff(subject)).toBe(false)
    expect(isAdmin(subject)).toBe(false)
  })

  it('does not let an unrecognised group grant anything', () => {
    const subject = caller(['SUPERUSER', 'ROOT', 'OWNER'])
    for (const predicate of [isAdmin, isStaff, isModerator, canPublish]) {
      expect(predicate(subject)).toBe(false)
    }
  })
})

describe('GROUP constants', () => {
  it('matches the group names created by defineAuth', () => {
    // These strings must equal amplify/auth/resource.ts `groups`. A typo here
    // silently denies everyone.
    expect(Object.values(GROUP)).toEqual(['ADMIN', 'EDITOR', 'MODERATOR', 'MEMBER'])
  })
})
