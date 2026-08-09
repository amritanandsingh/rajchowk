'use client'

import { Amplify } from 'aws-amplify'
import { generateClient } from 'aws-amplify/data'
import type { Schema } from '@/../amplify/data/resource'
import outputs from '@/../amplify_outputs.json'

let configured = false

export function configureBrowserAmplify(): void {
  if (configured) return
  Amplify.configure(outputs, { ssr: true })
  configured = true
}

configureBrowserAmplify()

/**
 * WHICH CLIENT DO I USE? Read the operation's authorization rules, not its audience.
 *
 *   Does the rule list literally contain `allow.guest()`?
 *     YES -> guestDataClient
 *     NO  -> userPoolDataClient
 *
 * That is the whole rule, and it is decided by the SCHEMA, never by whether the
 * feature feels public. `allow.authenticated()`, `allow.group(...)` and
 * `allow.owner*(...)` ALL resolve to the Cognito user pool. A request signed
 * SigV4 through the identity pool carries no user-pool token, matches no such
 * rule, and AppSync answers `Unauthorized` before any resolver or Lambda runs.
 *
 * These two clients were previously named `browserDataClient` / `adminDataClient`,
 * which framed the choice as public-vs-staff. That framing is wrong and it caused
 * the same bug twice: first on /admin/articles (fixed in ce29d4a — an empty
 * category dropdown and an "Unauthorized" article table), then on five
 * MEMBER-FACING forms — castVote, submitComment, submitQuestion,
 * toggleQuestionUpvote and EventRegistration.create — which are not staff
 * operations at all, so `adminDataClient` looked like the wrong tool, yet every
 * one of them is `allow.authenticated()` and therefore user-pool-only. The
 * result was that no signed-in member could vote, comment, ask a question,
 * upvote or register for an event. The names now describe the AUTH PROVIDER,
 * which is the thing that actually has to match.
 */

/**
 * Identity-pool (SigV4) client, for operations reachable WITHOUT signing in.
 *
 * `identityPool` is also the schema default (`defaultAuthorizationMode` in
 * amplify/data/resource.ts); it is stated explicitly so this reads as a decision
 * rather than an omission.
 *
 * Correct here only for the four operations that declare `allow.guest()`:
 * `newsletterSubscribe`, `newsletterVerify`, `newsletterUnsubscribe` and
 * `searchContent`. Their three-rule authorization — `allow.guest()`,
 * `allow.authenticated('identityPool')`, `allow.authenticated()` — is the tell,
 * and the second rule is what lets a signed-in user keep using this client.
 */
export const guestDataClient = generateClient<Schema>({ authMode: 'identityPool' })

/**
 * Cognito user-pool client, for every operation that requires a signed-in user —
 * MEMBER as well as staff.
 *
 * Required by `allow.authenticated()` (castVote, submitComment, submitQuestion,
 * submitReport, toggleQuestionUpvote, ensureUserProfile),
 * `allow.owner*(...)` (EventRegistration) and `allow.group(...)` (Category,
 * Article, publishArticle, moderateContent) alike.
 *
 * `scripts/verify-backend.ts` exercises this exact authMode against the deployed
 * API, which is why it could create a Category while the browser could not.
 */
export const userPoolDataClient = generateClient<Schema>({ authMode: 'userPool' })

/**
 * First GraphQL error message, or null.
 *
 * The Amplify v6 client does NOT throw on a GraphQL error — it resolves with
 * `{ data, errors }`. Code that only looks at `data` renders an empty list while
 * the API is refusing every request, which is precisely how the category
 * dropdown came to look like a missing feature. Every call must check.
 */
export function firstErrorMessage(
  errors: readonly { message?: string }[] | null | undefined,
): string | null {
  if (!errors?.length) return null
  return errors[0]?.message ?? null
}

export function readableAmplifyError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'कुछ गलत हो गया। कृपया फिर से कोशिश करें।'
}
