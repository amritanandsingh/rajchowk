import { describe, expect, it } from 'vitest'

import {
  availableActions,
  checkTransition,
  feedKeyFor,
  isArticleStatus,
  isPublishAction,
  statusKeyFor,
  statusOf,
} from './article-status'

/**
 * The publishing state machine.
 *
 * Both the admin UI and the Lambda read this table, so these tests are
 * simultaneously testing what buttons appear and what the backend permits.
 * The two cannot drift apart, which is the point of having one table.
 */

describe('statusOf', () => {
  it('reads a known status', () => {
    expect(statusOf('PUBLISHED')).toBe('PUBLISHED')
    expect(statusOf('DRAFT')).toBe('DRAFT')
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an unknown string', 'ARCHIVED'],
    ['a number', 42],
    ['an object', {}],
  ])('treats %s as DRAFT', (_label, value) => {
    // FAIL CLOSED. A row with no readable status must never be treated as
    // public — `feedKey` is only ever written on the same transition that
    // writes `status`, so an article in this state is genuinely not published.
    expect(statusOf(value)).toBe('DRAFT')
  })
})

describe('checkTransition', () => {
  it('allows DRAFT -> PUBLISHED', () => {
    expect(checkTransition('DRAFT', 'PUBLISH')).toEqual({ allowed: true, to: 'PUBLISHED' })
  })

  it('allows PUBLISHED -> DRAFT', () => {
    // "Unpublish" returns to DRAFT rather than introducing a third state.
    expect(checkTransition('PUBLISHED', 'UNPUBLISH')).toEqual({ allowed: true, to: 'DRAFT' })
  })

  it('refuses publishing something already published', () => {
    // The real-world case: two admins with the dashboard open, one publishes,
    // the other's stale page still offers the button.
    expect(checkTransition('PUBLISHED', 'PUBLISH')).toEqual({
      allowed: false,
      reason: 'ILLEGAL_TRANSITION',
    })
  })

  it('refuses unpublishing a draft', () => {
    expect(checkTransition('DRAFT', 'UNPUBLISH')).toEqual({
      allowed: false,
      reason: 'ILLEGAL_TRANSITION',
    })
  })

  it.each(['', 'DELETE', 'publish', 'ARCHIVE', 'PUBLISH '])(
    'refuses the unknown action %o',
    (action) => {
      // Case-sensitive and exact: `action` arrives as a raw string argument
      // from the network, and a lenient match here would let a caller reach a
      // transition by approximation.
      expect(checkTransition('DRAFT', action)).toEqual({
        allowed: false,
        reason: 'UNKNOWN_ACTION',
      })
    },
  )
})

describe('availableActions', () => {
  it('offers only PUBLISH for a draft', () => {
    expect(availableActions('DRAFT')).toEqual(['PUBLISH'])
  })

  it('offers only UNPUBLISH for a published article', () => {
    expect(availableActions('PUBLISHED')).toEqual(['UNPUBLISH'])
  })

  it('never offers an action checkTransition would refuse', () => {
    // The property that keeps the UI and the backend honest: a button the
    // handler always rejects is worse than no button.
    for (const status of ['DRAFT', 'PUBLISHED'] as const) {
      for (const action of availableActions(status)) {
        expect(checkTransition(status, action).allowed).toBe(true)
      }
    }
  })
})

describe('feedKeyFor', () => {
  it('returns the literal PUBLISHED partition for a published article', () => {
    expect(feedKeyFor('PUBLISHED')).toBe('PUBLISHED')
  })

  it('returns NULL for a draft, meaning REMOVE the attribute', () => {
    // This is what makes the public feed index sparse. A sentinel string, or
    // an attribute set to null, would leave the item IN the index — an
    // unpublished article would stay in the feed, held back only by the
    // redundant status filter.
    expect(feedKeyFor('DRAFT')).toBeNull()
  })
})

describe('statusKeyFor', () => {
  it('is always present, unlike feedKey', () => {
    // The admin dashboard has to be able to enumerate drafts, so this
    // partition key exists for both states.
    expect(statusKeyFor('DRAFT')).toBe('DRAFT')
    expect(statusKeyFor('PUBLISHED')).toBe('PUBLISHED')
  })
})

describe('type guards', () => {
  it('isArticleStatus accepts only the two states', () => {
    expect(isArticleStatus('DRAFT')).toBe(true)
    expect(isArticleStatus('PUBLISHED')).toBe(true)
    expect(isArticleStatus('ARCHIVED')).toBe(false)
    expect(isArticleStatus(null)).toBe(false)
  })

  it('isPublishAction accepts only the two actions', () => {
    expect(isPublishAction('PUBLISH')).toBe(true)
    expect(isPublishAction('UNPUBLISH')).toBe(true)
    expect(isPublishAction('DELETE')).toBe(false)
    expect(isPublishAction(undefined)).toBe(false)
  })
})
