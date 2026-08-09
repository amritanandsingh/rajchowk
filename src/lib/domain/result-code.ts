/**
 * Result codes returned by the Lambdas, mapped to localised UI strings.
 *
 * amplify/functions/shared/result.ts says of its own `message` field: "The
 * frontend maps `code` to a localised string, so `message` is only a fallback."
 * Nothing implemented that half of the contract, so every failure surfaced as
 * the Lambda's own generic Hindi text — untranslatable, and identical for
 * causes that need completely different responses from the reader. A publish
 * that lost a race and a publish that could never have succeeded both read
 * "कृपया फिर से कोशिश करें", which is precisely why a deterministic bug looked
 * intermittent for as long as it did.
 *
 * The codes are re-declared here rather than imported from
 * amplify/functions/shared/result.ts because that is Lambda runtime code: a
 * value import would pull it into the client bundle. This mirrors the reasoning
 * in src/lib/domain/staff-role.ts, which re-declares the group names for the
 * same reason. Keep the two files in agreement — the `satisfies` below fails
 * the build if a code is added there and forgotten here.
 */
import type { Dictionary } from '@/lib/i18n/dictionaries/hi'

/** Mirrors CODE in amplify/functions/shared/result.ts. */
export const RESULT_CODES = [
  'OK',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_INPUT',
  'RATE_LIMITED',
  'CONFLICT',
  'INTERNAL',
  'ALREADY_VOTED',
  'POLL_CLOSED',
  'INVALID_OPTION',
  'CHANGE_LIMIT',
  'NOT_AVAILABLE',
  'DEPTH_EXCEEDED',
  'DUPLICATE',
  'COMMENTS_CLOSED',
  'SUSPENDED',
] as const

export type ResultCode = (typeof RESULT_CODES)[number]

type ErrorKey = keyof Dictionary['errors']

/**
 * OK maps to `generic` only so the record is total. A caller that reaches the
 * error path with an OK code has a bug, and a generic message is the right
 * thing to show while it is being found.
 */
const CODE_TO_KEY = {
  OK: 'generic',
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'notFound',
  INVALID_INPUT: 'invalidInput',
  RATE_LIMITED: 'rateLimited',
  CONFLICT: 'conflict',
  INTERNAL: 'internal',
  ALREADY_VOTED: 'alreadyVoted',
  POLL_CLOSED: 'pollClosed',
  INVALID_OPTION: 'invalidOption',
  CHANGE_LIMIT: 'changeLimit',
  NOT_AVAILABLE: 'notAvailable',
  DEPTH_EXCEEDED: 'depthExceeded',
  DUPLICATE: 'duplicate',
  COMMENTS_CLOSED: 'commentsClosed',
  SUSPENDED: 'suspended',
} satisfies Record<ResultCode, ErrorKey>

export function isResultCode(value: unknown): value is ResultCode {
  return typeof value === 'string' && (RESULT_CODES as readonly string[]).includes(value)
}

/**
 * The localised message for a Lambda result.
 *
 * `fallback` is the Lambda's own `message`, used when the code is unrecognised
 * — a newer backend returning a code this build predates should still say
 * something specific rather than degrade to "something went wrong".
 */
export function resultMessage(
  dict: Dictionary,
  code: string | null | undefined,
  fallback?: string | null,
): string {
  if (isResultCode(code)) return dict.errors[CODE_TO_KEY[code]]
  return fallback || dict.errors.generic
}
