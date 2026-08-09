import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The create/update handler.
 *
 * This is the only path that can write an Article's content, so these tests
 * cover the two things that make that safe: it refuses callers who are not
 * administrators, and a repeated submit collapses onto one row instead of
 * creating two articles.
 *
 * DynamoDB is mocked at the shared client rather than with a local DynamoDB.
 * What is worth asserting here is the COMMAND the handler builds — which
 * condition expression, which index, which attributes — and a real database
 * would only confirm that DynamoDB works, which is not in question.
 */

import type * as DdbModule from '../shared/ddb'

const send = vi.fn()

vi.mock('../shared/ddb', async (importOriginal) => {
  // Keep the real `amplifyItem` and `isConditionalCheckFailed`: they encode
  // behaviour under test (the __typename stamp, the error-name match) and
  // stubbing them would test the stub.
  const actual = await importOriginal<typeof DdbModule>()
  return { ...actual, ddb: { send }, tableName: () => 'Article-test' }
})

const { handler } = await import('./handler')

/** A ConditionalCheckFailedException as the SDK actually shapes it. */
function conditionalFailure() {
  const error = new Error('The conditional request failed')
  error.name = 'ConditionalCheckFailedException'
  return error
}

const ADMIN_IDENTITY = {
  sub: 'admin-sub',
  claims: { sub: 'admin-sub', preferred_username: 'अमृत' },
  groups: ['ADMIN'],
}

const VALID_ARGS = {
  id: '0d8f6b2a-1c34-4e77-9f21-abcdef123456',
  title: 'दिल्ली में बड़ा फैसला',
  summary: 'सर्वोच्च न्यायालय ने आज एक महत्वपूर्ण निर्णय सुनाया है।',
  content: 'आज की सुनवाई में अदालत ने विस्तार से अपनी बात रखी और कई बिंदुओं पर टिप्पणी की।',
  slug: null,
}

// The handler's real signature is heavily generic; the tests only supply the
// two fields it reads.
const invoke = (event: { identity: unknown; arguments: Record<string, unknown> }) =>
  (handler as unknown as (e: unknown) => Promise<Record<string, unknown>>)(event)

/** Commands the handler sent, by SDK class name. */
const sentOfType = (name: string) =>
  send.mock.calls.map(([command]) => command).filter((command) => command.constructor.name === name)

beforeEach(() => {
  send.mockReset()
})

describe('authorization', () => {
  it('refuses an unauthenticated caller', async () => {
    const result = await invoke({ identity: null, arguments: VALID_ARGS })

    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' })
    // The decisive assertion: nothing was written. A handler that returns an
    // error AFTER writing would pass a shallower test.
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses an authenticated user who is NOT in the ADMIN group', async () => {
    // The requirement in one test: an ordinary Cognito user cannot create an
    // article, even though they hold a perfectly valid session.
    const result = await invoke({
      identity: { sub: 'member-sub', claims: { sub: 'member-sub' }, groups: [] },
      arguments: VALID_ARGS,
    })

    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses a user in a different group', async () => {
    const result = await invoke({
      identity: { sub: 'editor-sub', claims: { sub: 'editor-sub' }, groups: ['EDITOR'] },
      arguments: VALID_ARGS,
    })

    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('validation', () => {
  it('rejects invalid input before touching the database', async () => {
    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { ...VALID_ARGS, title: '' },
    })

    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only title', async () => {
    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { ...VALID_ARGS, title: '     ' },
    })
    expect(result).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
  })
})

describe('create', () => {
  beforeEach(() => {
    send
      // GetItem: no existing article.
      .mockResolvedValueOnce({ Item: undefined })
      // Query on articlesBySlug: slug is free.
      .mockResolvedValueOnce({ Items: [] })
      // PutItem.
      .mockResolvedValueOnce({})
  })

  it('creates a DRAFT with the idempotency condition', async () => {
    const result = await invoke({ identity: ADMIN_IDENTITY, arguments: VALID_ARGS })

    expect(result).toMatchObject({ ok: true, articleId: VALID_ARGS.id, status: 'DRAFT' })

    const [put] = sentOfType('PutCommand')
    // `attribute_not_exists(id)` IS the duplicate-submit protection.
    expect(put.input.ConditionExpression).toBe('attribute_not_exists(id)')
    expect(put.input.Item).toMatchObject({ id: VALID_ARGS.id, status: 'DRAFT', statusKey: 'DRAFT' })
  })

  it('does NOT set feedKey on a new draft', async () => {
    await invoke({ identity: ADMIN_IDENTITY, arguments: VALID_ARGS })

    const [put] = sentOfType('PutCommand')
    // Absent, not null. An attribute set to null still EXISTS in the index,
    // which would put a draft into the sparse public feed index.
    expect(put.input.Item).not.toHaveProperty('feedKey')
  })

  it('derives the byline from the VERIFIED claim, not from client input', async () => {
    await invoke({
      identity: ADMIN_IDENTITY,
      // A caller trying to forge authorship.
      arguments: { ...VALID_ARGS, authorName: 'किसी और का नाम', authorSub: 'someone-else' },
    })

    const [put] = sentOfType('PutCommand')
    expect(put.input.Item.authorName).toBe('अमृत')
    expect(put.input.Item.authorSub).toBe('admin-sub')
  })

  it('falls back to an id-based slug for a Devanagari headline', async () => {
    const result = await invoke({ identity: ADMIN_IDENTITY, arguments: VALID_ARGS })
    expect(result.slug).toBe('lekh-0d8f6b2a')
  })

  it('stamps __typename so the row is readable through the GraphQL layer', async () => {
    await invoke({ identity: ADMIN_IDENTITY, arguments: VALID_ARGS })
    // Without it, Article.get() returns the row with a null type and the
    // client discards it — the edit form would find nothing.
    expect(sentOfType('PutCommand')[0].input.Item.__typename).toBe('Article')
  })

  it('writes the TRIMMED values, not the raw ones', async () => {
    await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { ...VALID_ARGS, title: `  ${VALID_ARGS.title}  ` },
    })
    expect(sentOfType('PutCommand')[0].input.Item.title).toBe(VALID_ARGS.title)
  })
})

describe('slug uniqueness', () => {
  it('appends a suffix when the slug is taken by ANOTHER article', async () => {
    send
      .mockResolvedValueOnce({ Item: undefined })
      // First candidate is taken by a different id.
      .mockResolvedValueOnce({ Items: [{ id: 'someone-else' }] })
      // Suffixed candidate is free.
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})

    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { ...VALID_ARGS, title: 'Delhi Verdict' },
    })

    expect(result.slug).toBe('delhi-verdict-2')
  })

  it('does NOT treat the article itself as a collision', async () => {
    // Otherwise saving twice would append "-2" on every save.
    send
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Items: [{ id: VALID_ARGS.id }] })
      .mockResolvedValueOnce({})

    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { ...VALID_ARGS, title: 'Delhi Verdict' },
    })

    expect(result.slug).toBe('delhi-verdict')
  })

  it('checks uniqueness with a Query on the slug index, not a Scan', async () => {
    send
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})

    await invoke({ identity: ADMIN_IDENTITY, arguments: VALID_ARGS })

    const [query] = sentOfType('QueryCommand')
    expect(query.input.IndexName).toBe('articlesBySlug')
    expect(sentOfType('ScanCommand')).toHaveLength(0)
  })
})

describe('idempotency', () => {
  it('collapses a duplicate submit onto the existing article', async () => {
    send
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Items: [] })
      // The PutItem loses the race with the first submit.
      .mockRejectedValueOnce(conditionalFailure())
      // Re-read to report the article that actually exists.
      .mockResolvedValueOnce({
        Item: { id: VALID_ARGS.id, slug: 'lekh-0d8f6b2a', status: 'DRAFT' },
      })

    const result = await invoke({ identity: ADMIN_IDENTITY, arguments: VALID_ARGS })

    // ok:true — the caller's intent is satisfied. The UI treats this as a
    // successful save, which is the whole point of an idempotency key.
    expect(result).toMatchObject({
      ok: true,
      code: 'DUPLICATE',
      articleId: VALID_ARGS.id,
      slug: 'lekh-0d8f6b2a',
    })
  })

  it('returns the slug the FIRST write settled on, not the one it recomputed', async () => {
    // They differ when the first write took a collision suffix.
    send
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Items: [] })
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({
        Item: { id: VALID_ARGS.id, slug: 'delhi-verdict-3', status: 'PUBLISHED' },
      })

    const result = await invoke({ identity: ADMIN_IDENTITY, arguments: VALID_ARGS })
    expect(result.slug).toBe('delhi-verdict-3')
    expect(result.status).toBe('PUBLISHED')
  })

  it('reports CONFLICT when the condition failed and the row is gone', async () => {
    // Deleted between the write and the re-read: genuinely a conflict, not a
    // duplicate, and reporting it as success would be a lie.
    send
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({ Items: [] })
      .mockRejectedValueOnce(conditionalFailure())
      .mockResolvedValueOnce({ Item: undefined })

    const result = await invoke({ identity: ADMIN_IDENTITY, arguments: VALID_ARGS })
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' })
  })
})

describe('update', () => {
  const existing = {
    id: VALID_ARGS.id,
    slug: 'delhi-verdict',
    status: 'PUBLISHED',
    publishedAt: '2026-08-01T00:00:00.000Z',
  }

  it('updates content without touching status, feedKey or publishedAt', async () => {
    send.mockResolvedValueOnce({ Item: existing }).mockResolvedValueOnce({})

    const result = await invoke({ identity: ADMIN_IDENTITY, arguments: VALID_ARGS })

    const [update] = sentOfType('UpdateCommand')
    // Editing a published article must not republish it or reset its date.
    expect(update.input.UpdateExpression).not.toMatch(/status|feedKey|publishedAt/)
    expect(result).toMatchObject({ ok: true, status: 'PUBLISHED' })
  })

  it('KEEPS the existing slug when the title changes', async () => {
    // A slug is a permanent public URL. Silently changing it because someone
    // fixed a typo would break every inbound link with no redirect.
    send.mockResolvedValueOnce({ Item: existing }).mockResolvedValueOnce({})

    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { ...VALID_ARGS, title: 'A Completely Different Headline', slug: null },
    })

    expect(result.slug).toBe('delhi-verdict')
    expect(sentOfType('QueryCommand')).toHaveLength(0)
  })

  it('changes the slug only when a NEW one is explicitly supplied', async () => {
    send
      .mockResolvedValueOnce({ Item: existing })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})

    const result = await invoke({
      identity: ADMIN_IDENTITY,
      arguments: { ...VALID_ARGS, slug: 'new-url' },
    })

    expect(result.slug).toBe('new-url')
  })

  it('guards the update on the row still existing', async () => {
    send.mockResolvedValueOnce({ Item: existing }).mockResolvedValueOnce({})

    await invoke({ identity: ADMIN_IDENTITY, arguments: VALID_ARGS })

    // Without this, an UpdateItem would resurrect a deleted article as a
    // partial row with no status and no author.
    expect(sentOfType('UpdateCommand')[0].input.ConditionExpression).toBe('attribute_exists(id)')
  })

  it('infers DRAFT for an existing row with no status', async () => {
    send.mockResolvedValueOnce({ Item: { id: VALID_ARGS.id, slug: 's' } }).mockResolvedValueOnce({})

    const result = await invoke({ identity: ADMIN_IDENTITY, arguments: VALID_ARGS })
    expect(result.status).toBe('DRAFT')
  })
})

describe('failure handling', () => {
  it('returns INTERNAL and leaks nothing on an unexpected error', async () => {
    send.mockRejectedValueOnce(new Error('AccessDeniedException: user is not authorized'))

    const result = await invoke({ identity: ADMIN_IDENTITY, arguments: VALID_ARGS })

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL' })
    // The AWS message stays in CloudWatch. Echoing it to a browser would tell
    // an attacker about table names and IAM shape.
    expect(JSON.stringify(result)).not.toContain('AccessDenied')
  })
})
