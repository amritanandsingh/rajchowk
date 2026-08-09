import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The publish / unpublish handler.
 *
 * This function is the reason `status` can be trusted: the field is
 * Lambda-owned, and this code holding scoped table IAM is the only thing that
 * ever writes it. So the assertions below are mostly about the exact shape of
 * one UpdateItem — which attributes move together, and what the write is
 * guarded on.
 */

import type * as DdbModule from '../shared/ddb'

const send = vi.fn()

vi.mock('../shared/ddb', async (importOriginal) => {
  const actual = await importOriginal<typeof DdbModule>()
  return { ...actual, ddb: { send }, tableName: () => 'Article-test' }
})

const { handler } = await import('./handler')

function conditionalFailure() {
  const error = new Error('The conditional request failed')
  error.name = 'ConditionalCheckFailedException'
  return error
}

const ADMIN_IDENTITY = { sub: 'admin-sub', claims: { sub: 'admin-sub' }, groups: ['ADMIN'] }
const ARTICLE_ID = '0d8f6b2a-1c34-4e77-9f21-abcdef123456'

const draft = { id: ARTICLE_ID, slug: 'delhi-verdict', status: 'DRAFT' }
const published = {
  id: ARTICLE_ID,
  slug: 'delhi-verdict',
  status: 'PUBLISHED',
  feedKey: 'PUBLISHED',
  publishedAt: '2026-08-01T00:00:00.000Z',
}

const invoke = (event: { identity: unknown; arguments: Record<string, unknown> }) =>
  (handler as unknown as (e: unknown) => Promise<Record<string, unknown>>)(event)

const lastUpdate = () =>
  send.mock.calls
    .map(([command]) => command)
    .filter((command) => command.constructor.name === 'UpdateCommand')
    .at(-1)

beforeEach(() => {
  send.mockReset()
})

describe('authorization', () => {
  it('refuses an unauthenticated caller without reading anything', async () => {
    const result = await invoke({
      identity: null,
      arguments: { articleId: ARTICLE_ID, action: 'PUBLISH' },
    })

    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' })
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses an authenticated non-admin', async () => {
    const result = await invoke({
      identity: { sub: 'member-sub', claims: { sub: 'member-sub' }, groups: [] },
      arguments: { articleId: ARTICLE_ID, action: 'PUBLISH' },
    })

    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('publish', () => {
  beforeEach(() => {
    send.mockResolvedValueOnce({ Item: draft }).mockResolvedValueOnce({})
  })

  it('sets status, feedKey, statusKey and publishedAt in ONE write', async () => {
    // Atomicity matters: any interleaving that left status PUBLISHED without a
    // matching feedKey would produce an article that is published but
    // invisible, or the reverse.
    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'PUBLISH' },
    })

    expect(result).toMatchObject({ ok: true, status: 'PUBLISHED', slug: 'delhi-verdict' })

    const update = lastUpdate()
    expect(update.input.ExpressionAttributeValues[':next']).toBe('PUBLISHED')
    expect(update.input.ExpressionAttributeValues[':feedKey']).toBe('PUBLISHED')
    expect(update.input.ExpressionAttributeValues[':statusKey']).toBe('PUBLISHED')
    expect(update.input.UpdateExpression).toContain('publishedAt = :publishedAt')
  })

  it('aliases the reserved word `status`', async () => {
    await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'PUBLISH' },
    })
    // `status` is a DynamoDB reserved word; unaliased it fails at runtime.
    expect(lastUpdate().input.ExpressionAttributeNames['#status']).toBe('status')
  })

  it('guards the write on the CURRENT status so concurrent admins cannot both win', async () => {
    await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'PUBLISH' },
    })

    const update = lastUpdate()
    expect(update.input.ConditionExpression).toBe('attribute_exists(id) AND #status = :expected')
    expect(update.input.ExpressionAttributeValues[':expected']).toBe('DRAFT')
  })
})

describe('unpublish', () => {
  it('REMOVES feedKey rather than setting it to null', async () => {
    // The sparse-index property. An attribute set to null still exists in the
    // index, so an unpublished article would remain in the feed's index and be
    // held back only by the redundant status filter.
    send.mockResolvedValueOnce({ Item: published }).mockResolvedValueOnce({})

    await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'UNPUBLISH' },
    })

    const update = lastUpdate()
    expect(update.input.UpdateExpression).toContain('REMOVE feedKey')
    expect(update.input.ExpressionAttributeValues).not.toHaveProperty(':feedKey')
  })

  it('PRESERVES publishedAt so a republish keeps its original date', async () => {
    send.mockResolvedValueOnce({ Item: published }).mockResolvedValueOnce({})

    await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'UNPUBLISH' },
    })

    expect(lastUpdate().input.ExpressionAttributeValues[':publishedAt']).toBe(
      '2026-08-01T00:00:00.000Z',
    )
  })

  it('moves statusKey to DRAFT so the article stays visible in the admin list', async () => {
    send.mockResolvedValueOnce({ Item: published }).mockResolvedValueOnce({})

    await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'UNPUBLISH' },
    })

    expect(lastUpdate().input.ExpressionAttributeValues[':statusKey']).toBe('DRAFT')
  })
})

describe('republish', () => {
  it('keeps the ORIGINAL publishedAt rather than resetting it to now', async () => {
    // Resetting it would reorder the feed and rewrite history: an article
    // corrected a week after publication should keep its date.
    const wasPublished = { ...draft, publishedAt: '2026-07-01T00:00:00.000Z' }
    send.mockResolvedValueOnce({ Item: wasPublished }).mockResolvedValueOnce({})

    await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'PUBLISH' },
    })

    expect(lastUpdate().input.ExpressionAttributeValues[':publishedAt']).toBe(
      '2026-07-01T00:00:00.000Z',
    )
  })
})

describe('transitions', () => {
  it('refuses publishing an already-published article', async () => {
    send.mockResolvedValueOnce({ Item: published })

    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'PUBLISH' },
    })

    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' })
    // Refused before writing, not after.
    expect(lastUpdate()).toBeUndefined()
  })

  it('refuses unpublishing a draft', async () => {
    send.mockResolvedValueOnce({ Item: draft })

    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'UNPUBLISH' },
    })

    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' })
  })

  it.each(['DELETE', '', 'publish', 'ARCHIVE'])('refuses the unknown action %o', async (action) => {
    send.mockResolvedValueOnce({ Item: draft })

    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action },
    })

    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
  })

  it('returns NOT_FOUND for an article that does not exist', async () => {
    send.mockResolvedValueOnce({ Item: undefined })

    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'PUBLISH' },
    })

    expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('rejects an empty articleId before reading', async () => {
    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: '', action: 'PUBLISH' },
    })

    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('an article whose status attribute is ABSENT', () => {
  const noStatus = { id: ARTICLE_ID, slug: 'delhi-verdict' }

  it('is treated as a DRAFT and can be published', async () => {
    send.mockResolvedValueOnce({ Item: noStatus }).mockResolvedValueOnce({})

    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'PUBLISH' },
    })

    expect(result).toMatchObject({ ok: true, status: 'PUBLISHED' })
  })

  it('is guarded on ABSENCE, not on equality', async () => {
    // The bug this prevents: `#status = :expected` never matches a missing
    // attribute, so guarding an inferred DRAFT that way would make publishing
    // it impossible — a permanent conflict nobody could explain.
    send.mockResolvedValueOnce({ Item: noStatus }).mockResolvedValueOnce({})

    await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'PUBLISH' },
    })

    const update = lastUpdate()
    expect(update.input.ConditionExpression).toBe(
      'attribute_exists(id) AND attribute_not_exists(#status)',
    )
    expect(update.input.ExpressionAttributeValues).not.toHaveProperty(':expected')
  })
})

describe('failure handling', () => {
  it('reports CONFLICT when another admin won the race at the database', async () => {
    send.mockResolvedValueOnce({ Item: draft }).mockRejectedValueOnce(conditionalFailure())

    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'PUBLISH' },
    })

    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' })
  })

  it('returns INTERNAL and leaks no AWS detail on an unexpected error', async () => {
    send
      .mockResolvedValueOnce({ Item: draft })
      .mockRejectedValueOnce(new Error('ResourceNotFoundException: Requested resource not found'))

    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { articleId: ARTICLE_ID, action: 'PUBLISH' },
    })

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL' })
    expect(JSON.stringify(result)).not.toContain('ResourceNotFound')
  })
})
