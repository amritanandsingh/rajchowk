import { defineBackend } from '@aws-amplify/backend'
import { Stack } from 'aws-cdk-lib'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as iam from 'aws-cdk-lib/aws-iam'

import { auth } from './auth/resource'
import { data } from './data/resource'
import { createMediaUploadUrl } from './functions/create-media-upload-url/resource'
import { saveArticle } from './functions/save-article/resource'
import { setArticleStatus } from './functions/set-article-status/resource'
import { storage } from './storage/resource'

/* ===========================================================================
 * 0. Synth-time guards — these run BEFORE any AWS call
 *
 * Both throw rather than warn. A warning in a CI build scrolls past; a thrown
 * error fails the deploy, which is the only outcome that reliably stops the
 * thing it is guarding against.
 * ======================================================================== */

/** Injected by `ampx pipeline-deploy` in the Amplify build container. ABSENT
 *  under `ampx sandbox`, so everything branch-conditional must tolerate null. */
const branch = process.env.AWS_BRANCH ?? null
const isProduction = branch === 'main' || branch === 'production'

/* ---------------------------------------------------------------------------
 * THERE WAS A GUARD HERE, AND IT IS GONE ON PURPOSE. Read this before adding
 * one back, and before merging this branch to `main`.
 *
 * It refused to synthesise on branch main/production unless
 * ALLOW_MINIMAL_ON_MAIN=1 was set. Its premise: this repository declares ONE
 * model, while main's stack held the previous 25-model platform, so a deploy
 * there would ask CloudFormation to drop 24 live tables. It did its job once —
 * on 2026-08-09 the MVP was merged to main, and although that build actually
 * failed earlier (on `npm ci`), this guard was the next thing standing in the
 * way.
 *
 * It was removed deliberately as part of promoting this MVP to production.
 * Once main IS this application, the guard's premise is not merely satisfied,
 * it is inverted: main's stack becomes the one-model stack, and a check that
 * refuses to deploy the MVP to main would block every subsequent release.
 *
 * WHAT STILL PROTECTS PRODUCTION, now that this is gone:
 *
 *   1. DynamoDB deletion protection, which IS enabled on the v2 production
 *      tables (verified with `describe-table`: Article, Poll, Comment and
 *      UserProfile all report DeletionProtectionEnabled: true). A cutover
 *      deploy therefore does not quietly delete anything — CloudFormation
 *      fails partway and rolls back. Disabling that protection is the real,
 *      irreversible gate, and it is a manual step by design.
 *   2. docs/cutover.md, which is the written procedure for doing this once,
 *      in the right order, with the article content exported first.
 *
 * So the sequence is guarded by an AWS setting and a runbook rather than by
 * code. If you are reading this because a deploy just destroyed something,
 * the thing that was skipped is docs/cutover.md.
 * ------------------------------------------------------------------------- */

/**
 * REGION GUARD — Mumbai, or say so out loud.
 *
 * The application is for readers in India and every latency and data-residency
 * assumption in it follows from ap-south-1. The region is NOT settable from
 * this file: it is a property of the Amplify app for a branch deploy, and of
 * the shell environment for a sandbox. So this cannot enforce the region — it
 * can only refuse to synthesise quietly in the wrong one, which is the failure
 * mode worth catching (a developer with a stale AWS_REGION exported, silently
 * creating a duplicate stack in Virginia).
 */
const EXPECTED_REGION = 'ap-south-1'
const synthRegion = process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? null

if (synthRegion && synthRegion !== EXPECTED_REGION && process.env.ALLOW_ANY_REGION !== '1') {
  throw new Error(
    `Refusing to synthesise into ${synthRegion}. This application targets ${EXPECTED_REGION} ` +
      `(Mumbai) for Indian readers. Export AWS_REGION=${EXPECTED_REGION}, or set ` +
      `ALLOW_ANY_REGION=1 if you genuinely intend a different region.`,
  )
}

/* ===========================================================================
 * 1. The backend
 * ======================================================================== */

const backend = defineBackend({
  auth,
  data,
  storage,
  saveArticle,
  setArticleStatus,
  createMediaUploadUrl,
})

const stack = Stack.of(backend.data)

/* ===========================================================================
 * 2. Cognito hardening
 *
 * `defineAuth` has no props for any of this, so the L1 escape hatch is the
 * only route.
 * ======================================================================== */

const cfnUserPool = backend.auth.resources.cfnResources.cfnUserPool

/**
 * SELF SIGN-UP OFF. This is the single most important line in this file.
 *
 * Cognito pools accept public registration by default. Nothing in this product
 * needs it — readers are anonymous, and the only accounts that exist are
 * administrators created out-of-band by `npm run admin -- --create`. Left on,
 * this pool would be an open registration endpoint sending verification email
 * at our expense to anyone who found it.
 *
 * It is not a privilege-escalation hole (a self-registered account lands in no
 * group and can therefore do nothing), but "cannot do anything yet" is a
 * weaker property than "cannot exist".
 */
cfnUserPool.adminCreateUserConfig = { allowAdminCreateUserOnly: true }

cfnUserPool.policies = {
  passwordPolicy: {
    // Every account in this pool is an administrator, so the policy is set for
    // privileged users rather than for a general audience.
    minimumLength: 12,
    requireLowercase: true,
    requireUppercase: true,
    requireNumbers: true,
    requireSymbols: true,
    // The window between `admin --create` and the operator's first sign-in.
    temporaryPasswordValidityDays: 3,
  },
}

cfnUserPool.deletionProtection = isProduction ? 'ACTIVE' : 'INACTIVE'

if (isProduction) {
  // Blocks credential stuffing against admin accounts. Costs extra per MAU,
  // which is negligible for a pool holding a handful of editors, and this is
  // the pool where a compromise means someone publishing under our masthead.
  cfnUserPool.userPoolAddOns = { advancedSecurityMode: 'ENFORCED' }
}

/**
 * No guest identities.
 *
 * `defineAuth` provisions an identity pool with unauthenticated access on by
 * default. Anonymous readers here are served by API-key AppSync queries from
 * the Next.js server, never by a browser holding guest IAM credentials — so
 * the guest role is an unused principal with a real IAM identity attached, and
 * an unused capability is one to remove rather than to document.
 */
const cfnIdentityPool = backend.auth.resources.cfnResources.cfnIdentityPool
cfnIdentityPool.allowUnauthenticatedIdentities = false

/* ===========================================================================
 * 3. AppSync hardening
 * ======================================================================== */

const cfnApi = backend.data.resources.cfnResources.cfnGraphqlApi

/**
 * There are no relationships in this schema, so no legitimate query nests more
 * than a couple of levels. 4 leaves room for the custom types' item arrays
 * while making a deeply-nested denial-of-service query — the cheapest attack
 * on any GraphQL API — impossible to express.
 */
cfnApi.queryDepthLimit = 4
cfnApi.resolverCountLimit = 20

if (isProduction) {
  // Introspection off in production only: it is genuinely useful on a branch
  // deploy, and disabling it everywhere would break `ampx generate` locally.
  cfnApi.introspectionConfig = 'DISABLED'
}

/* ===========================================================================
 * 4. DynamoDB durability
 *
 * The table name is NOT set here, deliberately. An explicit `tableName` is the
 * standard way to break Amplify's per-branch isolation: two branches would
 * fight over one physical table, and CloudFormation cannot rename a table in
 * place, so changing it later means replacing it and losing every row.
 * Amplify derives a stable name from the model name plus the API id, which is
 * what makes redeployment idempotent — deploy #2 and #3 update the same table
 * rather than creating Article-1, Article-2. Never rename the `Article` model.
 * ======================================================================== */

const tables = backend.data.resources.tables
const amplifyTables = backend.data.resources.cfnResources.amplifyDynamoDbTables

if (amplifyTables['Article']) {
  // 35-day continuous backup. On-demand billing means this is charged per GB
  // stored, which for an article table is cents.
  amplifyTables['Article'].pointInTimeRecoveryEnabled = true
  // Only in production: a branch stack with deletion protection on cannot be
  // torn down without a console visit, which turns every experiment into a
  // cleanup chore.
  amplifyTables['Article'].deletionProtectionEnabled = isProduction
}

/* ===========================================================================
 * 5. Wire the handlers to the table
 * ======================================================================== */

type GrantableFunction = {
  addEnvironment: (key: string, value: string) => void
  resources: {
    lambda: iam.IGrantable & { addToRolePolicy: (statement: iam.PolicyStatement) => void }
  }
}

/**
 * Grant scoped table access and inject the table name.
 *
 * `grantReadWriteData` is deliberately NOT used: it does not cover secondary
 * indexes (aws-amplify/amplify-category-api#3054), and BOTH handlers Query a
 * GSI — save-article checks slug uniqueness through `articlesBySlug`. With the
 * convenience grant, that query fails at runtime with an AccessDenied that
 * points at the table rather than at the index, which is a genuinely annoying
 * afternoon. The explicit statement below covers the table AND `/index/*`.
 *
 * The action lists are per-function and minimal — least privilege is the
 * specification's first-priority requirement, and it is cheap to express here.
 */
function grantArticleTable(fn: GrantableFunction, actions: readonly string[]): void {
  const table = tables['Article']
  if (!table) throw new Error('Article table not found — was the model renamed?')

  fn.addEnvironment('ARTICLE_TABLE_NAME', table.tableName)
  fn.resources.lambda.addToRolePolicy(
    new iam.PolicyStatement({
      sid: 'AccessArticleTable',
      actions: actions.map((action) => `dynamodb:${action}`),
      resources: [table.tableArn, `${table.tableArn}/index/*`],
    }),
  )
}

// Query is for the articlesBySlug uniqueness check; there is no Scan and no
// Delete in either list, because neither handler does either of those things.
grantArticleTable(backend.saveArticle, ['GetItem', 'PutItem', 'UpdateItem', 'Query'])
grantArticleTable(backend.setArticleStatus, ['GetItem', 'UpdateItem'])

/* ===========================================================================
 * 5b. Article images — a private bucket behind a CloudFront distribution
 *
 * THE BUCKET IS NEVER PUBLIC. Nothing below opens it to the internet: readers
 * reach objects only through the distribution, which authenticates to S3 with
 * Origin Access Control. A direct S3 URL returns 403, and that is asserted
 * during sandbox verification rather than assumed.
 *
 * The alternative considered and rejected was serving images from the Next.js
 * origin at /media/…. It needs `s3:GetObject` on the Amplify Hosting SSR
 * compute role, and that role is not reachable from this file — attaching the
 * policy is a console step, invisible to this repository, that a new
 * environment would silently omit and then serve broken images. Everything
 * else here is infrastructure-as-code; that would not have been.
 * ======================================================================== */

const mediaBucket = backend.storage.resources.bucket

/**
 * Abort incomplete multipart uploads after a week.
 *
 * This is the first resource in the system with unbounded storage growth, and
 * a failed browser upload leaves parts that are invisible in the console but
 * billed. Given how much of this repository is about orphaned resources that
 * are still costing money, silence here would have been the wrong default.
 *
 * Note there is NO expiry rule on the objects themselves — an article image
 * must outlive the article's edit history. Orphaned images (uploaded, then the
 * Markdown reference removed) are not collected; see the README.
 */
backend.storage.resources.cfnResources.cfnBucket.lifecycleConfiguration = {
  rules: [
    {
      id: 'AbortIncompleteUploads',
      status: 'Enabled',
      abortIncompleteMultipartUpload: { daysAfterInitiation: 7 },
    },
  ],
}

/**
 * `nosniff` on every image response.
 *
 * The presign handler never sees the bytes it authorises, so a file's declared
 * content type is not verified against its actual contents. This header is the
 * control that makes that survivable: a mislabelled HTML file stored as
 * `image/png` is rendered inert rather than executed. It matters more here
 * than on the app origin, because these objects are attacker-influenced in a
 * way the application's own responses are not.
 */
const mediaHeaders = new cloudfront.ResponseHeadersPolicy(stack, 'MediaHeaders', {
  securityHeadersBehavior: {
    contentTypeOptions: { override: true },
    referrerPolicy: {
      referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
      override: true,
    },
  },
})

const mediaDistribution = new cloudfront.Distribution(stack, 'MediaDistribution', {
  comment: 'राज चौक — article images',
  defaultBehavior: {
    // OAC, not the legacy OAI, and not a public bucket policy. This is what
    // lets the bucket stay private while the images stay public.
    origin: origins.S3BucketOrigin.withOriginAccessControl(mediaBucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    // Images are immutable — the key contains a uuid, so a changed image is a
    // new key. Nothing needs to be invalidated, ever.
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
    responseHeadersPolicy: mediaHeaders,
    compress: true,
  },
  // PRICE_CLASS_ALL would put edges in regions with no readers. India, plus
  // the diaspora that Europe and North America edges already cover, is served
  // by 200 — and it is materially cheaper.
  priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
  httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
  enableIpv6: true,
})

/**
 * Grant the presign handler the one action it performs.
 *
 * Same discipline as grantArticleTable above: an explicit statement rather
 * than `bucket.grantPut()`, which also grants `s3:PutObjectAcl` and
 * `s3:Abort*`. This function puts objects under one prefix and does nothing
 * else — it cannot read, cannot list, cannot delete, and cannot touch anything
 * outside `articles/`.
 *
 * Worth being precise about what this permission is for: the LAMBDA never
 * uploads anything. It holds this so that it can SIGN a request the browser
 * then makes, and a presigned URL can never convey more authority than the
 * signer has. Narrowing this narrows every URL it issues.
 */
backend.createMediaUploadUrl.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    sid: 'PutArticleMedia',
    actions: ['s3:PutObject'],
    resources: [mediaBucket.arnForObjects('articles/*')],
  }),
)

backend.createMediaUploadUrl.addEnvironment('MEDIA_BUCKET_NAME', mediaBucket.bucketName)
backend.createMediaUploadUrl.addEnvironment('MEDIA_CDN_DOMAIN', mediaDistribution.domainName)

/* ===========================================================================
 * 6. Outputs consumed by the Next.js app
 * ======================================================================== */

backend.addOutput({
  custom: {
    environment: isProduction ? 'production' : (branch ?? 'sandbox'),
    region: stack.region,
    /**
     * The image CDN host, published here rather than set as a NEXT_PUBLIC_ env
     * var because CloudFront assigns it at deploy time and it differs per
     * environment — a hand-maintained variable would be one more thing to get
     * wrong on a new branch. The app never reads this: the URL is baked into
     * an article's Markdown when the image is uploaded. It is here so an
     * operator can find the distribution without opening the console.
     */
    mediaUrl: `https://${mediaDistribution.domainName}`,
  },
})

export { backend }
