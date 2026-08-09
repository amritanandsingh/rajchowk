/**
 * The contract between the write Lambdas and the admin UI.
 *
 * Pure module: imported by the Lambdas in amplify/ by relative path, so no
 * React, no next/*, no DOM globals, no `@/` aliases.
 *
 * WHY CODES AND NOT MESSAGES. The handlers return a discriminated result
 * rather than throwing a GraphQL error, because the UI has to tell three
 * unlike things apart:
 *
 *   - "your title is too short"  -> mark the field, keep the form
 *   - "someone else published it"-> refresh the list, explain, do not retry
 *   - "the API is unreachable"   -> error state with a retry affordance
 *
 * A stringly-typed `errors[0].message` collapses all three into one channel,
 * and the UI ends up regex-matching English AWS prose to decide what to render.
 * A code survives translation, log redaction and a change of wording.
 *
 * The Lambda never sends the human-readable text — it sends the code, and the
 * client maps it. That also keeps backend logs free of the Hindi copy and
 * keeps the copy in one place (src/lib/i18n/hi.ts owns the rest of it).
 */

export const CODE = {
  /** No verified identity on the request. Should be impossible past AppSync's
   *  own auth, so seeing this means something is wrong with the session. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** Authenticated, but not in the ADMIN group. */
  FORBIDDEN: 'FORBIDDEN',
  /** Failed `validateArticle`. The per-field detail travels separately. */
  INVALID_INPUT: 'INVALID_INPUT',
  /** The article id does not exist. */
  NOT_FOUND: 'NOT_FOUND',
  /** The transition is illegal from the article's CURRENT state — normally a
   *  stale dashboard racing another admin. */
  CONFLICT: 'CONFLICT',
  /** The idempotency key was already used. Not an error: the handler returns
   *  the article that already exists, and the UI treats it as success. */
  DUPLICATE: 'DUPLICATE',
  /** Anything unhandled. The detail stays in CloudWatch, never in the response
   *  — an internal error message is an information leak. */
  INTERNAL: 'INTERNAL',
} as const

export type ResultCode = (typeof CODE)[keyof typeof CODE]

export function isResultCode(value: unknown): value is ResultCode {
  return typeof value === 'string' && Object.values(CODE).includes(value as ResultCode)
}

/**
 * Reader-facing text for a code.
 *
 * Hindi, because every surface that renders one of these is an admin screen
 * and /admin is Hindi-only by design.
 *
 * INTERNAL deliberately says nothing specific. "Something went wrong, try
 * again" is not evasion here — the alternative is echoing an AWS exception to
 * a browser, which tells an attacker about table names and IAM shape and tells
 * the editor nothing they can act on.
 */
const MESSAGES: Record<ResultCode, string> = {
  UNAUTHENTICATED: 'आपका सत्र समाप्त हो गया है। कृपया दोबारा साइन इन करें।',
  FORBIDDEN: 'यह कार्य करने की अनुमति आपके पास नहीं है।',
  INVALID_INPUT: 'दी गई जानकारी अधूरी या अमान्य है।',
  NOT_FOUND: 'यह लेख नहीं मिला। हो सकता है इसे हटा दिया गया हो।',
  CONFLICT: 'इस लेख की स्थिति बदल चुकी है। सूची ताज़ा करके दोबारा कोशिश करें।',
  DUPLICATE: 'यह लेख पहले ही सहेजा जा चुका है।',
  INTERNAL: 'कुछ गड़बड़ हो गई। कृपया थोड़ी देर बाद दोबारा कोशिश करें।',
}

/** Falls back to INTERNAL for an unrecognised code, so a backend that learns a
 *  new code before the frontend does degrades to a sane message instead of
 *  rendering `undefined`. */
export function resultMessage(code: unknown): string {
  return isResultCode(code) ? MESSAGES[code] : MESSAGES.INTERNAL
}

/** True when the code means "the session is gone", which is the one case the
 *  UI responds to by navigating rather than by rendering a message. */
export function isSessionExpired(code: unknown): boolean {
  return code === CODE.UNAUTHENTICATED
}
