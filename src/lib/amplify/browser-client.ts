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
 * Client for GUEST-REACHABLE operations.
 *
 * `identityPool` is the schema default (see `defaultAuthorizationMode` in
 * amplify/data/resource.ts); it is stated explicitly here so that the split
 * below reads as a decision rather than an omission.
 *
 * Only the operations that actually declare `allow.guest()` belong on this
 * client — `newsletterSubscribe`, `newsletterVerify`, `newsletterUnsubscribe`
 * and `searchContent`. Those three-rule authorizations (`allow.guest()`,
 * `allow.authenticated('identityPool')`, `allow.authenticated()`) are the tell.
 */
export const browserDataClient = generateClient<Schema>({ authMode: 'identityPool' })

/**
 * Client for SIGNED-IN STAFF operations, and the only one that works for them.
 *
 * This exists because of a single, easily-missed default: `allow.authenticated()`
 * and `allow.group(...)` both resolve to the Cognito USER POOL provider, never the
 * identity pool. Category, Article, `publishArticle` and `moderateContent` are
 * authorized exclusively through those rules, so a SigV4/identityPool request —
 * which carries no user-pool token at all — matches no rule and AppSync answers
 * `Unauthorized`. That was the bug behind an empty category dropdown and an
 * "Unauthorized" article table on /admin/articles: not a missing permission, a
 * request signed the wrong way.
 *
 * `scripts/verify-backend.ts` exercises this exact authMode against the deployed
 * API, which is why it can create a Category while the browser could not.
 */
export const adminDataClient = generateClient<Schema>({ authMode: 'userPool' })

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
