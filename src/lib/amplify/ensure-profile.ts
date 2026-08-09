'use client'

import { fetchAuthSession } from 'aws-amplify/auth'
import { firstErrorMessage, userPoolDataClient } from './browser-client'

/**
 * Create the caller's UserProfile row if it does not exist yet.
 *
 * WHY THIS EXISTS AT ALL
 * ---------------------
 * `ensureUserProfile` has been defined in the schema
 * (amplify/data/resource.ts) and implemented as a Lambda
 * (amplify/functions/ensure-user-profile/handler.ts) since the beginning, and it
 * was never called from anywhere in the app. The post-confirmation trigger
 * (amplify/auth/post-confirmation/handler.ts) only issues
 * AdminAddUserToGroup for MEMBER — it does not write a profile row.
 *
 * Nothing degrades gracefully without that row. `submitQuestion` does
 * `if (!profile) return fail(CODE.FORBIDDEN)` and `submitComment` does the same,
 * so EVERY newly registered member was refused when they tried to ask a question
 * or comment. That is the reported /ask failure, and it was masked until now by
 * a second bug: the forms signed their requests through the identity pool, so
 * AppSync answered Unauthorized before the Lambda ever ran.
 *
 * WHY HERE AND NOT IN THE POST-CONFIRMATION TRIGGER
 * -------------------------------------------------
 * The trigger is the tempting place, but it deliberately swallows its own errors
 * so that a failure can never block sign-up — which means a failed profile write
 * there would be invisible. It would also need DynamoDB write grants on an auth
 * trigger. Calling it from the authenticated client keeps the write on a path
 * where failure is observable and the caller's identity is already verified.
 *
 * Idempotent as to the ROW: the handler guards its Put with
 * `attribute_not_exists(#id)`, so concurrent or repeat calls cannot create a
 * second profile.
 *
 * NOT idempotent as to the display name, and that is deliberate — verified
 * against the deployed handler by tests/integration/member-actions.test.ts.
 * amplify/functions/ensure-user-profile/handler.ts treats an explicitly supplied
 * `displayName` as a rename request and applies it on every call; only the
 * username FALLBACK is withheld from overwriting an existing name.
 *
 * Since we pass `preferred_username` below, every sign-in therefore re-syncs
 * `UserProfile.displayName` from Cognito. That is correct today because
 * `preferred_username` (set from the sign-up form's "नाम" field) is the ONLY
 * editable source of a member's name — there is no UserProfile editor anywhere
 * in the product.
 *
 * IF A PROFILE EDITOR IS EVER ADDED, this must change: as written, sign-in would
 * silently revert whatever the member set. The fix then is to stop sending
 * `displayName` here and instead have the handler read `preferred_username` from
 * `event.identity.claims` for its creation fallback.
 *
 * Calling this on sign-in also BACKFILLS every member who registered before this
 * fix shipped — they get a profile the next time they log in.
 */
export async function ensureUserProfile(): Promise<string | null> {
  try {
    // `preferred_username` is set from the sign-up form's "नाम" field. Without
    // it the Lambda falls back to the local part of the username, which for this
    // pool is the email address — so the member's chosen name would be silently
    // replaced by their email prefix.
    const session = await fetchAuthSession()
    const payload = session.tokens?.idToken?.payload
    const preferred = payload?.['preferred_username']
    const displayName = typeof preferred === 'string' ? preferred.trim() : ''

    const response = await userPoolDataClient.mutations.ensureUserProfile(
      // exactOptionalPropertyTypes is on: an explicit undefined is not
      // assignable to an optional property, so the key is omitted instead.
      displayName ? { displayName } : {},
    )

    const failure = firstErrorMessage(response.errors)
    if (failure) return failure
    if (response.data && response.data.ok === false) {
      return response.data.message ?? 'प्रोफ़ाइल तैयार नहीं हो सकी।'
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'प्रोफ़ाइल तैयार नहीं हो सकी।'
  }
}
