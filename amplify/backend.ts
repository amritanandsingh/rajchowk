import { defineBackend } from '@aws-amplify/backend'
import { Stack } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'

import { auth } from './auth/resource'
import { data } from './data/resource'
import { saveArticle } from './functions/save-article/resource'
import { setArticleStatus } from './functions/set-article-status/resource'

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

/**
 * GUARD 1 — do not deploy this schema onto the v2 production backend.
 *
 * This repository holds a one-model MVP. Branch `main` of the same Amplify app
 * (d1z2jyqeifr0gd) hosts the previous 25-model platform, and Amplify Gen 2
 * gives each branch its own backend stack — which is exactly why deploying
 * this on a NEW branch is safe, and why deploying it on `main` is not.
 *
 * If this schema ever reached main's stack, CloudFormation would compare 25
 * existing tables against the 1 declared here and attempt to delete 24 of
 * them. Several carry deletion protection, so the stack update would fail
 * partway and roll back — leaving the production API in an indeterminate state
 * for the duration. There is no version of that outcome anyone wants.
 *
 * Promoting this MVP to production is a real migration (export Article rows
 * from the v2 table, import into this one, repoint the domain), not a merge.
 * The override exists so that migration is possible; it should be set
 * deliberately, once, by someone who has read this comment.
 */
if (isProduction && process.env.ALLOW_MINIMAL_ON_MAIN !== '1') {
  throw new Error(
    [
      `Refusing to deploy the minimal MVP backend to branch "${branch}".`,
      '',
      'This schema declares ONE model. The production stack for this Amplify app',
      'holds 25. Deploying here would ask CloudFormation to delete 24 live tables,',
      'and deletion protection would fail the update partway through.',
      '',
      'Deploy this to its own branch instead — Amplify Gen 2 gives every branch an',
      'isolated backend stack, so a non-production branch cannot touch main:',
      '',
      '  aws amplify create-branch --app-id d1z2jyqeifr0gd --branch-name <name> \\',
      '    --region ap-south-1 --framework "Next.js - SSR" --enable-auto-build',
      '',
      'If you have genuinely migrated the data and intend to replace production,',
      'set ALLOW_MINIMAL_ON_MAIN=1 in the branch environment variables.',
    ].join('\n'),
  )
}

/**
 * GUARD 2 — Mumbai, or say so out loud.
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
  saveArticle,
  setArticleStatus,
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
 * 6. Outputs consumed by the Next.js app
 * ======================================================================== */

backend.addOutput({
  custom: {
    environment: isProduction ? 'production' : (branch ?? 'sandbox'),
    region: stack.region,
  },
})

export { backend }
