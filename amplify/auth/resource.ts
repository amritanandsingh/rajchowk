import { defineAuth } from '@aws-amplify/backend'

/**
 * Cognito, for administrators only.
 *
 * The product has exactly two kinds of visitor and only one of them has an
 * account:
 *
 *   - Readers are anonymous. Every public page is server-rendered and reads
 *     through API-key-authorised AppSync queries, so a reader never touches
 *     Cognito at all. There is no sign-up page, no member tier, no profile.
 *   - Administrators sign in here, and their `cognito:groups` claim is what
 *     every write authorisation in the system is decided on.
 *
 * ONE GROUP, ON PURPOSE. `groups: ['ADMIN']` creates the group; it never
 * creates a MEMBERSHIP. That distinction is the whole authorisation model:
 * a Cognito account with no group has no capability whatsoever, so an
 * authenticated ordinary user cannot become an administrator by any in-app
 * path — every route that could grant ADMIN is itself behind
 * `allow.group('ADMIN')`.
 *
 * The first administrator therefore CANNOT be bootstrapped from inside the
 * application, and that is the intended property rather than a gap. The only
 * principal who can create one holds AWS IAM credentials:
 *
 *   npm run admin -- --create --email you@example.com
 *   npm run admin -- --grant  --email you@example.com
 *
 * Self sign-up is disabled outright in amplify/backend.ts via
 * `allowAdminCreateUserOnly`. Without that, this pool would accept public
 * registrations: harmless in capability terms (a new account gets no group)
 * but a live open-registration surface that sends verification email at our
 * cost, for a product where no reader needs an account.
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: 'CODE',
      verificationEmailSubject: 'राज चौक — आपका सत्यापन कोड',
      verificationEmailBody: (createCode) =>
        `राज चौक प्रशासन में आपका स्वागत है।\n\n` +
        `आपका सत्यापन कोड है: ${createCode()}\n\n` +
        `यदि आपने यह खाता नहीं बनाया है, तो इस ईमेल को अनदेखा करें।`,
    },
  },

  userAttributes: {
    // The byline. Optional so an admin created by the bootstrap script can
    // sign in before setting one; the save-article handler falls back to the
    // email local-part when it is absent.
    preferredUsername: { required: false, mutable: true },
  },

  groups: ['ADMIN'],

  accountRecovery: 'EMAIL_ONLY',

  // Every account in this pool is privileged, so TOTP is offered to all of
  // them. OPTIONAL rather than REQUIRED because enforcing it would lock out
  // the first administrator between `admin --create` and their first sign-in,
  // which is exactly when they have no authenticator registered yet.
  multifactor: { mode: 'OPTIONAL', totp: true, sms: false },
})
