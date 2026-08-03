/**
 * Stub for `@aws-appsync/utils`.
 *
 * The real `util` object is injected by the APPSYNC_JS runtime, not by the
 * package — importing the package outside AppSync gives you types but no
 * working implementation. This stub provides just enough behaviour to unit-test
 * the resolvers in `amplify/data/resolvers/`, which is worth doing because
 * those resolvers ARE the public read surface: they are what stops a guest
 * reaching draft content.
 *
 * Two behaviours matter for the tests:
 *   - `util.error()` must THROW, so a test can assert that a resolver rejects
 *     bad input rather than falling through.
 *   - `util.dynamodb.toMapValues()` is identity here. The real one produces
 *     DynamoDB AttributeValue maps, but the tests assert on the *logical*
 *     values a resolver passes (which partition key, which filter), not on
 *     their wire encoding.
 */

/** Thrown by `util.error`, so tests can assert type and message. */
export class AppSyncError extends Error {
  constructor(
    message: string,
    public readonly errorType?: string,
  ) {
    super(message)
    this.name = 'AppSyncError'
  }
}

/** Fixed clock, so resolver output is deterministic across runs. */
export const FIXED_NOW = '2026-08-03T12:00:00.000Z'

export const util = {
  error(message: string, errorType?: string): never {
    throw new AppSyncError(message, errorType)
  },

  autoId(): string {
    return '00000000-0000-4000-8000-000000000000'
  },

  time: {
    nowISO8601(): string {
      return FIXED_NOW
    },
    nowEpochMilliSeconds(): number {
      return Date.parse(FIXED_NOW)
    },
    nowEpochSeconds(): number {
      return Math.floor(Date.parse(FIXED_NOW) / 1000)
    },
  },

  dynamodb: {
    // Identity: tests assert on logical values, not the AttributeValue encoding.
    toMapValues<T>(value: T): T {
      return value
    },
    toDynamoDB<T>(value: T): T {
      return value
    },
  },
}

export const runtime = {
  earlyReturn(value: unknown): never {
    throw new AppSyncError(`earlyReturn:${JSON.stringify(value)}`, 'EarlyReturn')
  },
}

export default { util, runtime }
