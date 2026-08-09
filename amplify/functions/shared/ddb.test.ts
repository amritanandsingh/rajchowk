import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  amplifyItem,
  cancellationCodes,
  cancelledAt,
  isConditionalCheckFailed,
  isTransactionCancelled,
  tableName,
} from './ddb'

/**
 * The raw-SDK invariants.
 *
 * `amplifyItem` is the most consequential function in the codebase's write
 * path: a row written without `__typename` is stored happily by DynamoDB and
 * then breaks every GraphQL read of it. That failure mode is silent, which is
 * exactly why it is pinned down here as well as in the deployed-backend check.
 */

/** Shapes the AWS SDK error the same way the SDK does. */
function sdkError(name: string, extra: Record<string, unknown> = {}): Error {
  const error = new Error(`${name} raised`)
  error.name = name
  return Object.assign(error, extra)
}

describe('amplifyItem', () => {
  it('stamps __typename, createdAt and updatedAt', () => {
    const item = amplifyItem('Vote', { id: 'p1#u1', pollId: 'p1' }, '2026-08-03T00:00:00.000Z')

    expect(item.__typename).toBe('Vote')
    expect(item.createdAt).toBe('2026-08-03T00:00:00.000Z')
    expect(item.updatedAt).toBe('2026-08-03T00:00:00.000Z')
    expect(item.id).toBe('p1#u1')
    expect(item.pollId).toBe('p1')
  })

  it('defaults both timestamps to now when none is given', () => {
    const before = Date.now()
    const item = amplifyItem('Comment', { id: 'c1' })
    const stamped = Date.parse(item.createdAt)

    expect(stamped).toBeGreaterThanOrEqual(before - 1000)
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000)
    expect(item.createdAt).toBe(item.updatedAt)
  })

  it('emits ISO-8601 strings, which is what AWSDateTime requires', () => {
    const item = amplifyItem('Comment', { id: 'c1' })
    expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('never lets caller data overwrite the metadata', () => {
    // A handler spreading an existing row must not be able to relabel the
    // item's type — that would make it unreadable through GraphQL.
    const item = amplifyItem('Vote', {
      id: 'x',
      __typename: 'Article',
      createdAt: 'nonsense',
      updatedAt: 'nonsense',
    } as Record<string, unknown>)

    expect(item.__typename).toBe('Vote')
    expect(item.createdAt).not.toBe('nonsense')
    expect(item.updatedAt).not.toBe('nonsense')
  })

  it.each([
    'Vote',
    'QuestionUpvote',
    'Comment',
    'AudienceQuestion',
    'ContentReport',
    'AuditLog',
    'NewsletterSubscription',
    'SearchDocument',
    'SearchToken',
    'ArticleRevision',
  ])('stamps the type for %s, which is written by raw SDK only', (model) => {
    expect(amplifyItem(model, { id: 'x' }).__typename).toBe(model)
  })
})

describe('tableName', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the configured table name', () => {
    vi.stubEnv('VOTE_TABLE_NAME', 'Vote-abc-NONE')
    expect(tableName('VOTE_TABLE_NAME')).toBe('Vote-abc-NONE')
  })

  it('throws a diagnostic naming the grant when the variable is missing', () => {
    // Failing loudly at first use beats a cryptic ResourceNotFoundException
    // from DynamoDB later.
    vi.stubEnv('MISSING_TABLE_NAME', '')
    expect(() => tableName('MISSING_TABLE_NAME')).toThrow(/MISSING_TABLE_NAME is not set/)
    expect(() => tableName('MISSING_TABLE_NAME')).toThrow(/backend\.ts/)
  })
})

describe('error classifiers', () => {
  it('recognises a failed conditional write', () => {
    // Vote and upvote idempotency both turn on recognising this exactly.
    expect(isConditionalCheckFailed(sdkError('ConditionalCheckFailedException'))).toBe(true)
    expect(isConditionalCheckFailed(sdkError('ValidationException'))).toBe(false)
    expect(isConditionalCheckFailed(new Error('ConditionalCheckFailedException'))).toBe(false)
    expect(isConditionalCheckFailed(null)).toBe(false)
    expect(isConditionalCheckFailed('ConditionalCheckFailedException')).toBe(false)
  })

  it('recognises a cancelled transaction', () => {
    expect(isTransactionCancelled(sdkError('TransactionCanceledException'))).toBe(true)
    expect(isTransactionCancelled(sdkError('ConditionalCheckFailedException'))).toBe(false)
    expect(isTransactionCancelled(undefined)).toBe(false)
  })
})

describe('cancellationCodes / cancelledAt', () => {
  it('maps reasons POSITIONALLY to TransactItems', () => {
    // This positional mapping is how cast-vote tells "already voted" (item 0)
    // from "poll closed" (item 2). Getting it wrong would report the wrong
    // reason to the reader.
    const error = sdkError('TransactionCanceledException', {
      CancellationReasons: [
        { Code: 'ConditionalCheckFailed' },
        { Code: 'None' },
        { Code: 'ConditionalCheckFailed' },
      ],
    })

    expect(cancellationCodes(error)).toEqual([
      'ConditionalCheckFailed',
      'None',
      'ConditionalCheckFailed',
    ])
    expect(cancelledAt(error, 0)).toBe(true)
    expect(cancelledAt(error, 1)).toBe(false)
    expect(cancelledAt(error, 2)).toBe(true)
  })

  it('reports None for a reason with no code', () => {
    const error = sdkError('TransactionCanceledException', {
      CancellationReasons: [{}, { Code: 'ConditionalCheckFailed' }],
    })
    expect(cancellationCodes(error)).toEqual(['None', 'ConditionalCheckFailed'])
  })

  it('returns nothing for a non-transaction error, so no branch fires', () => {
    expect(cancellationCodes(sdkError('ValidationException'))).toEqual([])
    expect(cancellationCodes(null)).toEqual([])
    expect(cancelledAt(sdkError('ValidationException'), 0)).toBe(false)
  })

  it('is false for an index beyond the reasons array', () => {
    const error = sdkError('TransactionCanceledException', {
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    })
    expect(cancelledAt(error, 5)).toBe(false)
  })

  it('tolerates a cancelled transaction that carries no reasons at all', () => {
    const error = sdkError('TransactionCanceledException')
    expect(cancellationCodes(error)).toEqual([])
    expect(cancelledAt(error, 0)).toBe(false)
  })
})
