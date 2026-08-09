import { describe, expect, it } from 'vitest'
import {
  allowedFromStatuses,
  appearsInFeeds,
  ARTICLE_STATUSES,
  availableActions,
  categoryFeedKeyFor,
  checkTransition,
  feedKeyFor,
  isArticleStatus,
  isPubliclyReadable,
  isPublishAction,
  PUBLISH_ACTIONS,
  requiresAdmin,
  tagFeedKeyFor,
  type ArticleStatus,
} from './article-status'

describe('type guards', () => {
  it('recognises valid statuses and actions', () => {
    expect(isArticleStatus('PUBLISHED')).toBe(true)
    expect(isArticleStatus('published')).toBe(false)
    expect(isArticleStatus(undefined)).toBe(false)
    expect(isPublishAction('PUBLISH')).toBe(true)
    expect(isPublishAction('DELETE')).toBe(false)
  })
})

describe('checkTransition — the publishing rules', () => {
  it('lets an admin publish from any pre-publication state', () => {
    for (const from of ['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'UNPUBLISHED'] as ArticleStatus[]) {
      const result = checkTransition(from, 'PUBLISH', true)
      expect(result, from).toEqual({ allowed: true, to: 'PUBLISHED' })
    }
  })

  it('does NOT let an editor publish — the core requirement', () => {
    // "Only an administrator can publish." The @auth directive admits editors
    // to this mutation because they legitimately submit and return to draft;
    // this is the check that separates those cases.
    const result = checkTransition('IN_REVIEW', 'PUBLISH', false)
    expect(result).toEqual({ allowed: false, reason: 'REQUIRES_ADMIN' })
  })

  it('does not let an editor schedule, unpublish or archive either', () => {
    expect(checkTransition('DRAFT', 'SCHEDULE', false)).toEqual({
      allowed: false,
      reason: 'REQUIRES_ADMIN',
    })
    expect(checkTransition('PUBLISHED', 'UNPUBLISH', false)).toEqual({
      allowed: false,
      reason: 'REQUIRES_ADMIN',
    })
    expect(checkTransition('PUBLISHED', 'ARCHIVE', false)).toEqual({
      allowed: false,
      reason: 'REQUIRES_ADMIN',
    })
  })

  it('lets an editor move work through review', () => {
    expect(checkTransition('DRAFT', 'SUBMIT_FOR_REVIEW', false)).toEqual({
      allowed: true,
      to: 'IN_REVIEW',
    })
    expect(checkTransition('IN_REVIEW', 'RETURN_TO_DRAFT', false)).toEqual({
      allowed: true,
      to: 'DRAFT',
    })
  })

  it('rejects illegal transitions even for an admin', () => {
    // Republishing something already published, or unpublishing a draft.
    expect(checkTransition('PUBLISHED', 'PUBLISH', true)).toEqual({
      allowed: false,
      reason: 'ILLEGAL_TRANSITION',
    })
    expect(checkTransition('DRAFT', 'UNPUBLISH', true)).toEqual({
      allowed: false,
      reason: 'ILLEGAL_TRANSITION',
    })
    expect(checkTransition('ARCHIVED', 'PUBLISH', true)).toEqual({
      allowed: false,
      reason: 'ILLEGAL_TRANSITION',
    })
  })

  it('requires an explicit restore before an archived article can go live again', () => {
    expect(checkTransition('ARCHIVED', 'RESTORE', true)).toEqual({ allowed: true, to: 'DRAFT' })
    expect(checkTransition('DRAFT', 'PUBLISH', true).allowed).toBe(true)
  })

  it('rejects an unknown action', () => {
    expect(checkTransition('DRAFT', 'FLY' as never, true)).toEqual({
      allowed: false,
      reason: 'UNKNOWN_ACTION',
    })
  })
})

describe('allowedFromStatuses / requiresAdmin', () => {
  it('reports the source states used for the atomic ConditionExpression', () => {
    // The handler writes these into a DynamoDB condition so the status check
    // and the write commit together.
    expect(allowedFromStatuses('UNPUBLISH')).toEqual(['PUBLISHED'])
    expect(allowedFromStatuses('PUBLISH')).toContain('SCHEDULED')
  })

  it('treats an unknown action as admin-only, failing closed', () => {
    expect(requiresAdmin('NOPE' as never)).toBe(true)
    expect(allowedFromStatuses('NOPE' as never)).toEqual([])
  })
})

describe('availableActions', () => {
  it('offers an editor strictly fewer actions than an admin', () => {
    const editor = availableActions('IN_REVIEW', false)
    const admin = availableActions('IN_REVIEW', true)
    expect(editor).not.toContain('PUBLISH')
    expect(admin).toContain('PUBLISH')
    expect(admin.length).toBeGreaterThan(editor.length)
  })

  it('returns only legal actions for the given status', () => {
    for (const status of ARTICLE_STATUSES) {
      for (const action of availableActions(status, true)) {
        expect(checkTransition(status, action, true).allowed, `${status} -> ${action}`).toBe(true)
      }
    }
  })

  it('offers nothing illegal from ARCHIVED beyond restore', () => {
    expect(availableActions('ARCHIVED', true)).toEqual(['RESTORE'])
  })
})

describe('public visibility', () => {
  it('exposes PUBLISHED and ARCHIVED, nothing else', () => {
    // ARCHIVED stays reachable on purpose: dropping it out of feeds is right,
    // but breaking every inbound link and citation to it is not.
    expect(isPubliclyReadable('PUBLISHED')).toBe(true)
    expect(isPubliclyReadable('ARCHIVED')).toBe(true)

    for (const status of ['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'UNPUBLISHED'] as ArticleStatus[]) {
      expect(isPubliclyReadable(status), status).toBe(false)
    }
  })

  it('puts only PUBLISHED in feeds', () => {
    expect(appearsInFeeds('PUBLISHED')).toBe(true)
    expect(appearsInFeeds('ARCHIVED')).toBe(false)
    expect(appearsInFeeds('DRAFT')).toBe(false)
  })
})

describe('feed keys — the sparse-index mechanism', () => {
  it('builds a key only for PUBLISHED', () => {
    expect(feedKeyFor('PUBLISHED', 'HI')).toBe('PUBLISHED#HI')
    expect(feedKeyFor('PUBLISHED', 'EN')).toBe('PUBLISHED#EN')
  })

  it('returns null for every non-feed status', () => {
    // Null means the attribute is REMOVED, so the row leaves the GSI entirely.
    // A draft is absent from the index, not filtered out of it — which is why
    // a filter bug cannot leak one.
    for (const status of [
      'DRAFT',
      'IN_REVIEW',
      'SCHEDULED',
      'UNPUBLISHED',
      'ARCHIVED',
    ] as ArticleStatus[]) {
      expect(feedKeyFor(status, 'HI'), status).toBeNull()
      expect(categoryFeedKeyFor(status, 'HI', 'cat-1'), status).toBeNull()
      expect(tagFeedKeyFor(status, 'HI', 'tag-1'), status).toBeNull()
    }
  })

  it('scopes category and tag keys correctly', () => {
    expect(categoryFeedKeyFor('PUBLISHED', 'HI', 'cat-1')).toBe('cat-1#PUBLISHED#HI')
    expect(tagFeedKeyFor('PUBLISHED', 'EN', 'tag-9')).toBe('tag-9#PUBLISHED#EN')
  })

  it('keeps languages in separate partitions', () => {
    expect(feedKeyFor('PUBLISHED', 'HI')).not.toBe(feedKeyFor('PUBLISHED', 'EN'))
  })
})

describe('table completeness', () => {
  it('defines a transition for every declared action', () => {
    for (const action of PUBLISH_ACTIONS) {
      expect(allowedFromStatuses(action).length, action).toBeGreaterThan(0)
    }
  })

  it('can reach every status from DRAFT through some legal path', () => {
    const reachable = new Set<ArticleStatus>(['DRAFT'])
    for (let i = 0; i < ARTICLE_STATUSES.length; i += 1) {
      for (const from of [...reachable]) {
        for (const action of availableActions(from, true)) {
          const result = checkTransition(from, action, true)
          if (result.allowed) reachable.add(result.to)
        }
      }
    }
    expect([...reachable].sort()).toEqual([...ARTICLE_STATUSES].sort())
  })
})
