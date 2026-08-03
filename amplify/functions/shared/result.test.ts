import { describe, expect, it } from 'vitest'
import { CODE, fail, message, ok, type ResultCode } from './result'

/**
 * Result codes.
 *
 * Two properties matter here. First, every code has a user-facing message, so
 * no path can return an empty string to a reader. Second, no message leaks
 * internal detail — an error string is an information-disclosure channel, and
 * detail belongs in CloudWatch.
 */

const ALL_CODES = Object.values(CODE) as ResultCode[]

describe('CODE', () => {
  it('has a message for every code', () => {
    for (const code of ALL_CODES) {
      expect(message(code), code).toBeTruthy()
      expect(message(code).trim(), code).not.toBe('')
    }
  })

  it('uses code names that match their key, so logs and responses agree', () => {
    for (const [key, value] of Object.entries(CODE)) {
      expect(value).toBe(key)
    }
  })

  it('writes messages in Hindi, matching the default UI language', () => {
    // The frontend maps `code` to a localised string; `message` is the fallback
    // and is shown as-is, so it must be in the primary language.
    const devanagari = /[ऀ-ॿ]/
    for (const code of ALL_CODES) {
      expect(devanagari.test(message(code)), `${code}: ${message(code)}`).toBe(true)
    }
  })

  it('never leaks internal detail in a user-facing message', () => {
    // No table names, ARNs, stack traces, SDK exception names or field paths.
    const leaks = [
      /dynamodb/i,
      /appsync/i,
      /lambda/i,
      /arn:aws/i,
      /ConditionalCheck/i,
      /TransactionCanceled/i,
      /table/i,
      /\bstack\b/i,
      /undefined/i,
      /null/i,
    ]
    for (const code of ALL_CODES) {
      for (const leak of leaks) {
        expect(leak.test(message(code)), `${code} matched ${leak}`).toBe(false)
      }
    }
  })
})

describe('ok', () => {
  it('reports success with the OK code', () => {
    const result = ok()
    expect(result.ok).toBe(true)
    expect(result.code).toBe(CODE.OK)
    expect(result.message).toBe(message(CODE.OK))
  })

  it('merges extra fields onto the result', () => {
    const result = ok({ pollId: 'p1', totalVotes: 42, changed: false })
    expect(result).toMatchObject({ ok: true, code: 'OK', pollId: 'p1', totalVotes: 42 })
  })

  it('does not let extra fields override ok, code or message', () => {
    // A handler spreading a DynamoDB item into the result must not be able to
    // flip `ok` to false or forge a code.
    const result = ok({
      ok: false,
      code: 'HACKED',
      message: 'leaked internals',
    } as unknown as Record<string, unknown>)
    expect(result.ok).toBe(true)
    expect(result.code).toBe(CODE.OK)
    expect(result.message).toBe(message(CODE.OK))
  })
})

describe('fail', () => {
  it('reports failure with the given code and its message', () => {
    const result = fail(CODE.ALREADY_VOTED)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('ALREADY_VOTED')
    expect(result.message).toBe(message(CODE.ALREADY_VOTED))
  })

  it('merges extra fields, which is how search returns an empty result set', () => {
    const result = fail(CODE.RATE_LIMITED, { items: [], nextToken: null, totalScanned: 0 })
    expect(result).toMatchObject({ ok: false, code: 'RATE_LIMITED', items: [], totalScanned: 0 })
  })

  it.each(ALL_CODES.filter((code) => code !== CODE.OK))('reports ok=false for %s', (code) => {
    expect(fail(code).ok).toBe(false)
  })

  it('does not let extra fields forge success', () => {
    const result = fail(CODE.FORBIDDEN, { ok: true } as unknown as Record<string, unknown>)
    expect(result.ok).toBe(false)
    expect(result.code).toBe(CODE.FORBIDDEN)
  })
})

describe('the codes handlers actually branch on', () => {
  it('defines every code referenced by the vote and upvote flows', () => {
    // If one of these is renamed, a handler silently returns an unknown code
    // and the frontend falls through to a generic error.
    for (const code of [
      'OK',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'INVALID_INPUT',
      'RATE_LIMITED',
      'CONFLICT',
      'ALREADY_VOTED',
      'POLL_CLOSED',
      'INVALID_OPTION',
      'CHANGE_LIMIT',
      'NOT_AVAILABLE',
      'DEPTH_EXCEEDED',
      'DUPLICATE',
      'COMMENTS_CLOSED',
      'SUSPENDED',
    ]) {
      expect(CODE, code).toHaveProperty(code)
    }
  })
})
