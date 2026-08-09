'use client'

import { Amplify } from 'aws-amplify'
import { generateClient } from 'aws-amplify/data'

import type { Schema } from '@/../amplify/data/resource'
import outputs from '@/../amplify_outputs.json'

/**
 * The browser-side Amplify client. Admin surfaces only.
 *
 * Nothing on a public page imports this module. Reader-facing pages are
 * server-rendered and read through src/lib/amplify/queries.ts, so the article
 * feed ships no Amplify JavaScript to visitors at all — which is most of why
 * the public bundle stays small.
 */

let configured = false

/**
 * `ssr: true` is load-bearing.
 *
 * It switches Amplify's token storage from localStorage to COOKIES, which is
 * what lets the Next.js middleware and the server components under /admin see
 * the session at all. With the default storage, sign-in would appear to work
 * in the browser and every server-side authorization check would see an
 * anonymous request — the middleware would bounce the admin straight back to
 * the login page they just completed.
 */
export function configureBrowserAmplify(): void {
  if (configured) return
  Amplify.configure(outputs, { ssr: true })
  configured = true
}

configureBrowserAmplify()

/**
 * Cognito user-pool client.
 *
 * The ONLY client this app needs in the browser. Every operation a browser can
 * reach — `saveArticle`, `setArticleStatus`, `Article.get` — is
 * `allow.group('ADMIN')`, and a group rule resolves to the user pool. There is
 * deliberately no identity-pool client here: guest identities are disabled in
 * amplify/backend.ts, so a SigV4 request would carry a principal that does not
 * exist.
 */
export const userPoolDataClient = generateClient<Schema>({ authMode: 'userPool' })

/**
 * First GraphQL error message, or null.
 *
 * The Amplify v6 client does NOT throw on a GraphQL error — it resolves with
 * `{ data, errors }`. Code that only inspects `data` renders an empty list
 * while the API is refusing every request, which looks like "there are no
 * articles" rather than "you are not authorised". Every call must check.
 */
export function firstErrorMessage(
  errors: readonly { message?: string }[] | null | undefined,
): string | null {
  if (!errors?.length) return null
  return errors[0]?.message ?? null
}

/**
 * Does this error mean the Cognito session is gone?
 *
 * Matched on the exception NAME, not on message text: the message is
 * human-facing English prose that AWS is free to reword, and a regex over it
 * is a silent breakage waiting for an SDK update. An expired session must lead
 * to a redirect rather than to an error toast, because no amount of retrying
 * fixes it.
 */
export function isAuthError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = (error as { name?: unknown }).name
  return (
    name === 'NotAuthorizedException' ||
    name === 'UserUnAuthenticatedException' ||
    name === 'UnauthorizedException'
  )
}

/** Last-resort message for an exception with nothing useful in it. Hindi,
 *  because every caller is an admin surface. */
export function readableAmplifyError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'कुछ गड़बड़ हो गई। कृपया दोबारा कोशिश करें।'
}
