/**
 * Result codes returned to the browser.
 *
 * Two rules:
 *  1. The `message` is user-facing and generic. Detail goes to CloudWatch, not
 *     to the caller — an error string is an information-disclosure channel.
 *  2. Messages are Hindi, matching the default UI language. The frontend maps
 *     `code` to a localised string, so `message` is only a fallback.
 */

export const CODE = {
  OK: 'OK',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',

  ALREADY_VOTED: 'ALREADY_VOTED',
  POLL_CLOSED: 'POLL_CLOSED',
  INVALID_OPTION: 'INVALID_OPTION',
  CHANGE_LIMIT: 'CHANGE_LIMIT',

  NOT_AVAILABLE: 'NOT_AVAILABLE',
  DEPTH_EXCEEDED: 'DEPTH_EXCEEDED',
  DUPLICATE: 'DUPLICATE',
  COMMENTS_CLOSED: 'COMMENTS_CLOSED',
  SUSPENDED: 'SUSPENDED',
} as const

export type ResultCode = (typeof CODE)[keyof typeof CODE]

/** Generic, non-leaking user-facing text per code. */
const MESSAGES: Record<ResultCode, string> = {
  OK: 'हो गया।',
  UNAUTHENTICATED: 'कृपया पहले साइन इन करें।',
  FORBIDDEN: 'आपके पास इसकी अनुमति नहीं है।',
  NOT_FOUND: 'यह उपलब्ध नहीं है।',
  INVALID_INPUT: 'दी गई जानकारी सही नहीं है।',
  RATE_LIMITED: 'बहुत सारे अनुरोध। कृपया थोड़ी देर बाद कोशिश करें।',
  CONFLICT: 'अभी पूरा नहीं हो सका। कृपया फिर से कोशिश करें।',
  INTERNAL: 'कुछ गड़बड़ हो गई। कृपया फिर से कोशिश करें।',

  ALREADY_VOTED: 'आप इस जनमत में पहले ही वोट दे चुके हैं।',
  POLL_CLOSED: 'यह जनमत अभी खुला नहीं है।',
  INVALID_OPTION: 'यह विकल्प इस जनमत का नहीं है।',
  CHANGE_LIMIT: 'आप अपना वोट अधिकतम बार बदल चुके हैं।',

  NOT_AVAILABLE: 'यह अभी उपलब्ध नहीं है।',
  DEPTH_EXCEEDED: 'इस टिप्पणी पर और जवाब नहीं दिए जा सकते।',
  DUPLICATE: 'यह पहले ही भेजा जा चुका है।',
  COMMENTS_CLOSED: 'इस लेख पर टिप्पणियाँ बंद हैं।',
  SUSPENDED: 'आपका खाता अभी निलंबित है।',
}

export function message(code: ResultCode): string {
  return MESSAGES[code]
}

export function ok<T extends Record<string, unknown>>(
  extra: T = {} as T,
): { ok: true; code: string; message: string } & T {
  // The spread goes FIRST so ok/code/message always win. A handler that
  // spreads a DynamoDB item in here must not be able to flip `ok` to false.
  return { ...extra, ok: true, code: CODE.OK, message: MESSAGES.OK }
}

export function fail<T extends Record<string, unknown>>(
  code: ResultCode,
  extra: T = {} as T,
): { ok: false; code: string; message: string } & T {
  // Spread first — see the note in ok().
  return { ...extra, ok: false, code, message: MESSAGES[code] }
}
