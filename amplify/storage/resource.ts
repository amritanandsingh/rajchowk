import { defineStorage } from '@aws-amplify/backend'

/**
 * Article images.
 *
 * NOTE WHAT IS NOT HERE: there is no `access` callback, and that is the whole
 * design rather than an omission.
 *
 * `defineStorage`'s access rules grant S3 permissions to identity-pool
 * principals — `allow.guest`, `allow.authenticated`, `allow.entity`. This
 * application has no use for any of them:
 *
 *  - Guest identities are disabled outright in amplify/backend.ts, so
 *    `allow.guest` would name a principal that does not exist.
 *  - Admins never touch S3 with IAM credentials either. Uploads go through the
 *    `createMediaUploadUrl` mutation, which is the same doctrine every other
 *    write in this system follows: a Lambda re-derives the caller's identity
 *    from the verified JWT and does the privileged thing on their behalf. That
 *    keeps the invariant src/lib/amplify/browser-client.ts states outright —
 *    "there is deliberately no identity-pool client here".
 *  - Readers fetch images through CloudFront, which reaches the bucket via
 *    Origin Access Control, not via the identity pool.
 *
 * So exactly two principals can reach these objects, and both are granted in
 * amplify/backend.ts with explicit, scoped policies: the presign Lambda
 * (`s3:PutObject` on `articles/*` only) and the CloudFront distribution
 * (read, via OAC). An access rule here would add a third that nothing needs.
 *
 * The bucket stays private. Nothing in this file or in backend.ts opens it to
 * the public internet — an object is reachable only through the distribution.
 */
export const storage = defineStorage({
  name: 'rajchowkMedia',
})
