import { describe, expect, it } from 'vitest'
// @ts-expect-error: resolver is plain JavaScript with no type declaration.
import * as promiseDetail from './get-public-promise.js'
// @ts-expect-error: resolver is plain JavaScript with no type declaration.
import * as polls from './list-public-polls.js'
// @ts-expect-error: resolver is plain JavaScript with no type declaration.
import * as promises from './list-public-promises.js'

const ctx = (over: Record<string, unknown> = {}) => ({ args: {}, ...over })

describe('public poll resolver', () => {
  it('only permits OPEN and CLOSED status partitions', () => {
    expect(polls.request(ctx({ args: { status: 'OPEN' } })).query.expressionValues[':status']).toBe(
      'OPEN',
    )
    expect(
      polls.request(ctx({ args: { status: 'DRAFT' } })).query.expressionValues[':status'],
    ).toBe('OPEN')
  })

  it('clamps the requested page size', () => {
    expect(polls.request(ctx({ args: { limit: 999 } })).limit).toBe(20)
  })

  it('projects only public fields', () => {
    const result = polls.response(
      ctx({
        result: { items: [{ id: 'p1', question: 'Q?', status: 'OPEN', editorNotes: 'secret' }] },
      }),
    )
    expect(result.items[0]).not.toHaveProperty('editorNotes')
  })
})

describe('public promise resolvers', () => {
  it('hard-codes the public language partition and published filter', () => {
    const request = promises.request(ctx({ args: { language: 'EN', publicKey: 'INTERNAL' } }))
    expect(request.query.expressionValues[':publicKey']).toBe('PUBLIC#EN')
    expect(request.filter.expressionValues[':published']).toBe(true)
  })

  it('falls back to Hindi for an unknown language', () => {
    expect(
      promises.request(ctx({ args: { language: 'XX' } })).query.expressionValues[':publicKey'],
    ).toBe('PUBLIC#HI')
  })

  it('drops unpublished rows even if a bad index entry exists', () => {
    const result = promises.response(
      ctx({
        result: {
          items: [
            { id: 'hidden', isPublished: false },
            { id: 'shown', isPublished: true },
          ],
        },
      }),
    )
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(['shown'])
  })

  it('makes unpublished detail indistinguishable from missing', () => {
    expect(() =>
      promiseDetail.response(ctx({ result: { items: [{ slug: 'draft', isPublished: false }] } })),
    ).toThrow(/Promise not found/)
  })

  it('does not expose editorial fields from detail', () => {
    const result = promiseDetail.response(
      ctx({
        result: {
          items: [
            {
              id: 'p1',
              slug: 'x',
              title: 'X',
              politician: 'P',
              party: 'Y',
              promiseText: 'Text',
              status: 'ANNOUNCED',
              isPublished: true,
              publicKey: 'PUBLIC#HI',
              createdBySub: 'secret',
            },
          ],
        },
      }),
    )
    expect(result).not.toHaveProperty('createdBySub')
    expect(result).not.toHaveProperty('publicKey')
  })
})
