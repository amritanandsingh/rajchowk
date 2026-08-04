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

  it('mirrors publishArticle: allow.groups(STAFF), so not MODERATOR', () => {
    expect(canPublish([GROUP.ADMIN])).toBe(true)
    expect(canPublish([GROUP.EDITOR])).toBe(true)
    expect(canPublish([GROUP.MODERATOR])).toBe(false)
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
