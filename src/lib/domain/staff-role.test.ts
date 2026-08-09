import { describe, expect, it } from 'vitest'
import { canCreateCategory, canPublish, canWriteArticles, GROUP, isStaff } from './staff-role'

describe('staff capability predicates', () => {
  it('treats all three staff groups as staff', () => {
    for (const group of [GROUP.ADMIN, GROUP.EDITOR, GROUP.MODERATOR]) {
      expect(isStaff([group]), group).toBe(true)
    }
    expect(isStaff([GROUP.MEMBER])).toBe(false)
    expect(isStaff([])).toBe(false)
  })

  it('lets only ADMIN and EDITOR write — MODERATOR is read-only on Article', () => {
    expect(canWriteArticles([GROUP.ADMIN])).toBe(true)
    expect(canWriteArticles([GROUP.EDITOR])).toBe(true)
    expect(canWriteArticles([GROUP.MODERATOR])).toBe(false)
    expect(canWriteArticles([GROUP.MEMBER])).toBe(false)
  })

  it('mirrors the Category rules: EDITOR and ADMIN create, MODERATOR reads', () => {
    expect(canCreateCategory([GROUP.EDITOR])).toBe(true)
    expect(canCreateCategory([GROUP.ADMIN])).toBe(true)
    expect(canCreateCategory([GROUP.MODERATOR])).toBe(false)
  })

  it('lets ONLY an ADMIN publish — the core editorial rule', () => {
    // PUBLISH and UNPUBLISH are adminOnly in the transition table and the
    // publish function enforces it. Following the `allow.groups(STAFF)`
    // directive instead would offer an editor a button that always fails.
    expect(canPublish([GROUP.ADMIN])).toBe(true)
    expect(canPublish([GROUP.EDITOR])).toBe(false)
    expect(canPublish([GROUP.MODERATOR])).toBe(false)
    expect(canPublish([GROUP.EDITOR, GROUP.MODERATOR])).toBe(false)
    expect(canPublish([])).toBe(false)
  })

  it('reads a multi-group claim', () => {
    expect(canWriteArticles([GROUP.MEMBER, GROUP.EDITOR])).toBe(true)
    expect(canWriteArticles([GROUP.MEMBER, GROUP.MODERATOR])).toBe(false)
  })

  it('ignores unknown groups', () => {
    expect(isStaff(['SUPERUSER'])).toBe(false)
    expect(canWriteArticles(['admin'])).toBe(false)
  })
})
