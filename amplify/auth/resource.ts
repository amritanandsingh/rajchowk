import { defineAuth, defineFunction } from '@aws-amplify/backend'

/**
 * Post-confirmation trigger.
 *
 * It does ONE thing: add the new user to MEMBER. It deliberately does not
 * touch any data resource.
 *
 * Why that matters: `defineData` references the user pool, so data depends on
 * auth. If this trigger also needed a data table name, auth would depend on
 * data and CloudFormation would refuse to deploy with a circular dependency
 * between the nested stacks. `resourceGroupName` cannot fix that — the cycle
 * is between stacks, not within one.
 *
 * Profile creation therefore lives in the `ensureUserProfile` mutation
 * (resourceGroupName: 'data'), which runs on first authenticated call. That is
 * also strictly more correct: post-confirmation does not fire for federated
 * sign-ins or admin-created users, so keying profile creation off the first
 * authenticated request covers every path.
 */
export const postConfirmation = defineFunction({
  name: 'post-confirmation',
  entry: './post-confirmation/handler.ts',
  runtime: 22, // The documented default is a stale Node 18.
  timeoutSeconds: 10,
  memoryMB: 256,
  resourceGroupName: 'auth',
  environment: {
    DEFAULT_GROUP: 'MEMBER',
  },
})

export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: 'CODE',
      verificationEmailSubject: 'राज चौक — आपका सत्यापन कोड',
      verificationEmailBody: (createCode) =>
        `राज चौक में आपका स्वागत है।\n\nआपका सत्यापन कोड है: ${createCode()}\n\n` +
        `यदि आपने खाता नहीं बनाया है, तो इस ईमेल को अनदेखा करें।`,
    },
  },

  userAttributes: {
    preferredUsername: { required: false, mutable: true },
    locale: { required: false, mutable: true },
  },

  // LIST ORDER IS PRECEDENCE: index 0 wins. A user in both ADMIN and MEMBER
  // resolves as ADMIN.
  //
  // Note that this creates the GROUPS, never memberships. There is no in-band
  // way to create the first ADMIN, and that is the point — every path that
  // could grant ADMIN is itself gated by allow.group('ADMIN'), so bootstrapping
  // from inside the application would require already being an admin. The only
  // principal who can promote the first admin holds AWS IAM credentials.
  // See docs/deployment.md, "First admin assignment".
  groups: ['ADMIN', 'EDITOR', 'MODERATOR', 'MEMBER'],

  triggers: { postConfirmation },

  access: (allow) => [allow.resource(postConfirmation).to(['addUserToGroup'])],

  accountRecovery: 'EMAIL_ONLY',

  // Optional for members; strongly recommended for staff. Advanced security
  // mode is switched to ENFORCED for production in backend.ts.
  multifactor: { mode: 'OPTIONAL', totp: true, sms: false },
})
