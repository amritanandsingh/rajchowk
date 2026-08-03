import { defineBackend, secret } from '@aws-amplify/backend'
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as sns from 'aws-cdk-lib/aws-sns'

import { auth } from './auth/resource'
import { data } from './data/resource'
import { storage } from './storage/resource'

import { castVote } from './functions/cast-vote/resource'
import { ensureUserProfile } from './functions/ensure-user-profile/resource'
import { listArticlesByTag } from './functions/list-articles-by-tag/resource'
import { moderateContent } from './functions/moderate-content/resource'
import { newsletterSubscribe } from './functions/newsletter-subscribe/resource'
import { newsletterUnsubscribe } from './functions/newsletter-unsubscribe/resource'
import { newsletterVerify } from './functions/newsletter-verify/resource'
import { publishArticle } from './functions/publish-article/resource'
import { reconcileCounters } from './functions/reconcile-counters/resource'
import { searchContent } from './functions/search-content/resource'
import { submitComment } from './functions/submit-comment/resource'
import { submitQuestion } from './functions/submit-question/resource'
import { submitReport } from './functions/submit-report/resource'
import { toggleQuestionUpvote } from './functions/toggle-question-upvote/resource'

const backend = defineBackend({
  auth,
  data,
  storage,
  castVote,
  toggleQuestionUpvote,
  submitComment,
  submitQuestion,
  submitReport,
  ensureUserProfile,
  listArticlesByTag,
  moderateContent,
  publishArticle,
  reconcileCounters,
  searchContent,
  newsletterSubscribe,
  newsletterVerify,
  newsletterUnsubscribe,
})

/**
 * AWS_BRANCH is injected by `ampx pipeline-deploy` in the Amplify build
 * container. It is ABSENT under `ampx sandbox`, so every production-only
 * hardening below is guarded — an unguarded reference here is the classic way
 * to make local sandbox deploys fail.
 */
const branch = process.env.AWS_BRANCH
const isProduction = branch === 'main' || branch === 'production'
const stack = Stack.of(backend.data)
const { region, account } = stack

/* ===========================================================================
 * 1. Cognito hardening
 *
 * defineAuth has no passwordPolicy prop, so this is the L1 escape hatch.
 * ======================================================================== */
const cfnUserPool = backend.auth.resources.cfnResources.cfnUserPool
cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 12,
    requireLowercase: true,
    requireUppercase: true,
    requireNumbers: true,
    requireSymbols: true,
    temporaryPasswordValidityDays: 3,
  },
}
cfnUserPool.deletionProtection = isProduction ? 'ACTIVE' : 'INACTIVE'

if (isProduction) {
  // Blocks credential stuffing against staff accounts. Costs extra per MAU,
  // so production only.
  cfnUserPool.userPoolAddOns = { advancedSecurityMode: 'ENFORCED' }
}

/**
 * Enable the admin username/password auth flow OUTSIDE production only.
 *
 * The integration test suite mints one Cognito ID token per role so several
 * principals can be in flight inside a single Node process — `aws-amplify` keeps
 * one module-scoped session, so signing in and out per test would be race-prone
 * and would make the concurrent-voting test impossible to express.
 *
 * ADMIN_USER_PASSWORD_AUTH can only be invoked by a caller holding AWS IAM
 * credentials, so it is not an end-user attack surface. It is still withheld
 * from production on the principle that a capability nothing needs should not
 * exist there.
 */
if (!isProduction) {
  const cfnUserPoolClient = backend.auth.resources.cfnResources.cfnUserPoolClient
  cfnUserPoolClient.explicitAuthFlows = [
    'ALLOW_USER_SRP_AUTH',
    'ALLOW_REFRESH_TOKEN_AUTH',
    'ALLOW_ADMIN_USER_PASSWORD_AUTH',
  ]
}

/* ===========================================================================
 * 2. AppSync hardening
 * ======================================================================== */
const cfnApi = backend.data.resources.cfnResources.cfnGraphqlApi
// Caps nested traversal (article -> comments -> author -> articles -> ...),
// which is the cheapest denial-of-service against a GraphQL API.
cfnApi.queryDepthLimit = 6
cfnApi.resolverCountLimit = 100
if (isProduction) {
  cfnApi.introspectionConfig = 'DISABLED'
}

/* ===========================================================================
 * 3. DynamoDB durability
 * ======================================================================== */
const tables = backend.data.resources.tables
const amplifyTables = backend.data.resources.cfnResources.amplifyDynamoDbTables

// Skips unknown names rather than throwing, so renaming a model cannot break
// synth in a way that is hard to diagnose.
const DURABLE_TABLES = [
  'UserProfile',
  'Article',
  'ArticleSource',
  'ArticleRevision',
  'ArticleRedirect',
  'ArticleTag',
  'Category',
  'Tag',
  'Poll',
  'PollOption',
  'Vote',
  'AudienceQuestion',
  'QuestionUpvote',
  'Comment',
  'ContentReport',
  'LiveEvent',
  'EventRegistration',
  'PromiseTrackerEntry',
  'PromiseStatusChange',
  'SavedArticle',
  'NewsletterSubscription',
  'AuditLog',
  'SearchDocument',
  'SearchToken',
  'SiteSetting',
]

for (const name of DURABLE_TABLES) {
  const table = amplifyTables[name]
  if (!table) continue
  table.pointInTimeRecoveryEnabled = true
  table.deletionProtectionEnabled = isProduction
}

// High volume and disposable: a 90-day TTL instead of point-in-time recovery.
if (amplifyTables['AnalyticsEvent']) {
  amplifyTables['AnalyticsEvent'].timeToLiveAttribute = {
    enabled: true,
    attributeName: 'expiresAt',
  }
}

/* ===========================================================================
 * 4. Operational stack
 * ======================================================================== */
const ops = backend.createStack('RajChowkOps')

/**
 * Rate limiting lives on a plain CDK table, NOT an Amplify model.
 *
 * It is written on every request including rejected ones, it needs a TTL, and
 * it must never appear in the GraphQL schema. As a model it would add a
 * `listRateLimits` field to the public API and force __typename/createdAt/
 * updatedAt onto the hottest write in the system.
 */
const rateLimitTable = new dynamodb.TableV2(ops, 'RateLimitTable', {
  partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
  timeToLiveAttribute: 'expiresAt',
  billing: dynamodb.Billing.onDemand(),
  encryption: dynamodb.TableEncryptionV2.awsManagedKey(),
  removalPolicy: isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
  deletionProtection: isProduction,
})

/* ===========================================================================
 * 5. Wire the raw-SDK Lambdas to their tables
 * ======================================================================== */

type GrantableFunction = {
  addEnvironment: (key: string, value: string) => void
  resources: { lambda: iam.IGrantable & { addToRolePolicy: (s: iam.PolicyStatement) => void } }
}

type TableGrant = { model: string; env: string; actions: string[] }

/**
 * Grant table access and inject the table name.
 *
 * `grantReadWriteData` is deliberately NOT used: it does not cover secondary
 * indexes (aws-amplify/amplify-category-api#3054), and almost every read in
 * this codebase is a GSI Query. The explicit statement below covers both the
 * table and `/index/*`.
 */
function grantTables(fn: GrantableFunction, grants: TableGrant[]): void {
  for (const { model, env, actions } of grants) {
    const table = tables[model]
    if (!table) throw new Error(`Unknown model table: ${model}`)

    fn.addEnvironment(env, table.tableName)
    fn.resources.lambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: `Access${model}`,
        actions: actions.map((action) => `dynamodb:${action}`),
        resources: [table.tableArn, `${table.tableArn}/index/*`],
      }),
    )
  }
}

grantTables(backend.castVote, [
  { model: 'Poll', env: 'POLL_TABLE_NAME', actions: ['GetItem', 'UpdateItem'] },
  { model: 'PollOption', env: 'POLL_OPTION_TABLE_NAME', actions: ['GetItem', 'UpdateItem'] },
  { model: 'Vote', env: 'VOTE_TABLE_NAME', actions: ['GetItem', 'PutItem', 'UpdateItem'] },
  { model: 'AuditLog', env: 'AUDIT_LOG_TABLE_NAME', actions: ['PutItem'] },
])

grantTables(backend.toggleQuestionUpvote, [
  {
    model: 'AudienceQuestion',
    env: 'AUDIENCE_QUESTION_TABLE_NAME',
    actions: ['GetItem', 'UpdateItem'],
  },
  {
    model: 'QuestionUpvote',
    env: 'QUESTION_UPVOTE_TABLE_NAME',
    actions: ['PutItem', 'DeleteItem'],
  },
])

grantTables(backend.submitComment, [
  { model: 'Article', env: 'ARTICLE_TABLE_NAME', actions: ['GetItem'] },
  { model: 'Comment', env: 'COMMENT_TABLE_NAME', actions: ['GetItem', 'PutItem', 'Query'] },
  { model: 'UserProfile', env: 'USER_PROFILE_TABLE_NAME', actions: ['GetItem', 'UpdateItem'] },
])

grantTables(backend.submitQuestion, [
  { model: 'AudienceQuestion', env: 'AUDIENCE_QUESTION_TABLE_NAME', actions: ['PutItem'] },
  { model: 'UserProfile', env: 'USER_PROFILE_TABLE_NAME', actions: ['GetItem'] },
])

grantTables(backend.submitReport, [
  {
    model: 'ContentReport',
    env: 'CONTENT_REPORT_TABLE_NAME',
    actions: ['PutItem', 'UpdateItem', 'Query'],
  },
  { model: 'Comment', env: 'COMMENT_TABLE_NAME', actions: ['UpdateItem'] },
])

grantTables(backend.ensureUserProfile, [
  { model: 'UserProfile', env: 'USER_PROFILE_TABLE_NAME', actions: ['PutItem', 'UpdateItem'] },
])

grantTables(backend.moderateContent, [
  { model: 'Comment', env: 'COMMENT_TABLE_NAME', actions: ['GetItem', 'UpdateItem'] },
  {
    model: 'AudienceQuestion',
    env: 'AUDIENCE_QUESTION_TABLE_NAME',
    actions: ['GetItem', 'UpdateItem'],
  },
  { model: 'Article', env: 'ARTICLE_TABLE_NAME', actions: ['GetItem', 'UpdateItem'] },
  {
    model: 'ContentReport',
    env: 'CONTENT_REPORT_TABLE_NAME',
    actions: ['GetItem', 'UpdateItem', 'Query'],
  },
  { model: 'AuditLog', env: 'AUDIT_LOG_TABLE_NAME', actions: ['PutItem'] },
])

grantTables(backend.publishArticle, [
  { model: 'Article', env: 'ARTICLE_TABLE_NAME', actions: ['GetItem', 'UpdateItem', 'Query'] },
  { model: 'ArticleRevision', env: 'ARTICLE_REVISION_TABLE_NAME', actions: ['PutItem', 'Query'] },
  {
    model: 'ArticleRedirect',
    env: 'ARTICLE_REDIRECT_TABLE_NAME',
    actions: ['GetItem', 'PutItem', 'UpdateItem', 'Query'],
  },
  { model: 'ArticleTag', env: 'ARTICLE_TAG_TABLE_NAME', actions: ['Query', 'UpdateItem'] },
  {
    model: 'SearchDocument',
    env: 'SEARCH_DOCUMENT_TABLE_NAME',
    actions: ['PutItem', 'DeleteItem'],
  },
  {
    model: 'SearchToken',
    env: 'SEARCH_TOKEN_TABLE_NAME',
    actions: ['PutItem', 'DeleteItem', 'BatchWriteItem', 'Query'],
  },
  { model: 'Category', env: 'CATEGORY_TABLE_NAME', actions: ['UpdateItem'] },
  { model: 'AuditLog', env: 'AUDIT_LOG_TABLE_NAME', actions: ['PutItem'] },
])

grantTables(backend.reconcileCounters, [
  { model: 'Poll', env: 'POLL_TABLE_NAME', actions: ['GetItem', 'UpdateItem', 'Query', 'Scan'] },
  { model: 'PollOption', env: 'POLL_OPTION_TABLE_NAME', actions: ['UpdateItem', 'Query'] },
  { model: 'Vote', env: 'VOTE_TABLE_NAME', actions: ['Query'] },
  {
    model: 'AudienceQuestion',
    env: 'AUDIENCE_QUESTION_TABLE_NAME',
    actions: ['UpdateItem', 'Query', 'Scan'],
  },
  { model: 'QuestionUpvote', env: 'QUESTION_UPVOTE_TABLE_NAME', actions: ['Query'] },
  { model: 'Comment', env: 'COMMENT_TABLE_NAME', actions: ['Query'] },
  { model: 'Article', env: 'ARTICLE_TABLE_NAME', actions: ['UpdateItem', 'Query', 'Scan'] },
  { model: 'AuditLog', env: 'AUDIT_LOG_TABLE_NAME', actions: ['PutItem'] },
])

grantTables(backend.listArticlesByTag, [
  { model: 'ArticleTag', env: 'ARTICLE_TAG_TABLE_NAME', actions: ['Query'] },
  { model: 'Article', env: 'ARTICLE_TABLE_NAME', actions: ['BatchGetItem'] },
])

grantTables(backend.searchContent, [
  { model: 'SearchDocument', env: 'SEARCH_DOCUMENT_TABLE_NAME', actions: ['BatchGetItem'] },
  { model: 'SearchToken', env: 'SEARCH_TOKEN_TABLE_NAME', actions: ['Query'] },
])

for (const fn of [
  backend.newsletterSubscribe,
  backend.newsletterVerify,
  backend.newsletterUnsubscribe,
]) {
  grantTables(fn, [
    {
      model: 'NewsletterSubscription',
      env: 'NEWSLETTER_TABLE_NAME',
      actions: ['GetItem', 'PutItem', 'UpdateItem'],
    },
  ])
}

/* ===========================================================================
 * 6. Rate limiting + the IP-hashing salt
 * ======================================================================== */
const RATE_LIMITED_FUNCTIONS = [
  backend.castVote,
  backend.toggleQuestionUpvote,
  backend.submitComment,
  backend.submitQuestion,
  backend.submitReport,
  backend.searchContent,
  backend.newsletterSubscribe,
  backend.newsletterVerify,
  backend.moderateContent,
  backend.publishArticle,
]

for (const fn of RATE_LIMITED_FUNCTIONS) {
  fn.addEnvironment('RATE_LIMIT_TABLE_NAME', rateLimitTable.tableName)
  // Raw IPs are never stored. This salt is what makes the stored HMAC
  // non-reversible — a bare hash of an IP is brute-forceable in seconds.
  // Set with: npx ampx sandbox secret set RATE_LIMIT_IP_SALT
  fn.addEnvironment('RATE_LIMIT_IP_SALT', secret('RATE_LIMIT_IP_SALT'))
  rateLimitTable.grantReadWriteData(fn.resources.lambda)
}

/* ===========================================================================
 * 7. SES
 *
 * The domain identity, Easy DKIM and custom MAIL FROM are created ONCE,
 * MANUALLY, OUTSIDE Amplify. They are account-scoped singletons: every branch
 * backend would otherwise fight over the same identity, and tearing down a
 * sandbox would delete production's. We only reference it by ARN here.
 * See docs/deployment.md.
 * ======================================================================== */
const SES_DOMAIN = process.env.SES_DOMAIN ?? 'rajchowk.in'
const SES_FROM_ADDRESS = process.env.SES_FROM_ADDRESS ?? `news@${SES_DOMAIN}`
const SES_CONFIGURATION_SET = process.env.SES_CONFIGURATION_SET ?? 'rajchowk-transactional'
const SITE_URL = isProduction ? `https://${SES_DOMAIN}` : 'http://localhost:3000'

for (const fn of [backend.newsletterSubscribe, backend.newsletterVerify]) {
  fn.addEnvironment('SITE_URL', SITE_URL)
  fn.addEnvironment('NEWSLETTER_FROM_ADDRESS', SES_FROM_ADDRESS)
  fn.addEnvironment('SES_CONFIGURATION_SET', SES_CONFIGURATION_SET)
}

for (const fn of [
  backend.newsletterSubscribe,
  backend.newsletterVerify,
  backend.newsletterUnsubscribe,
]) {
  fn.addEnvironment('NEWSLETTER_TOKEN_SECRET', secret('NEWSLETTER_TOKEN_SECRET'))
}

backend.newsletterSubscribe.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    sid: 'SendNewsletterEmail',
    actions: ['ses:SendEmail'],
    resources: [
      `arn:aws:ses:${region}:${account}:identity/${SES_DOMAIN}`,
      `arn:aws:ses:${region}:${account}:configuration-set/${SES_CONFIGURATION_SET}`,
    ],
    // Pins the envelope sender, so a compromised function cannot spoof another
    // address on the verified domain.
    conditions: { StringEquals: { 'ses:FromAddress': SES_FROM_ADDRESS } },
  }),
)

/* ===========================================================================
 * 8. Reserved concurrency — a bounded blast radius
 *
 * Production only, AND opt-in. Lambda rejects any reservation that would drop
 * the account's unreserved pool below 100, so the 226 reserved below needs an
 * account concurrency limit of at least 326. A fresh account is capped far
 * lower — this one was at 10 — and CloudFormation then fails the whole stack
 * with "decreases account's UnreservedConcurrentExecution below its minimum
 * value". That is a deploy-time hard failure, not a warning.
 *
 * So this stays off until the quota is actually raised. Once the Lambda
 * "Concurrent executions" quota (L-B99A9384) is >= 326, set
 * ENABLE_RESERVED_CONCURRENCY=1 in the branch environment variables and
 * redeploy. Check the current limit with:
 *   aws lambda get-account-settings --query AccountLimit.ConcurrentExecutions
 *
 * While it is off, reconcileCounters loses its serial guarantee (see below).
 * ======================================================================== */
if (isProduction && process.env.ENABLE_RESERVED_CONCURRENCY === '1') {
  const CONCURRENCY: Array<
    [
      { resources: { cfnResources: { cfnFunction: { reservedConcurrentExecutions?: number } } } },
      number,
    ]
  > = [
    [backend.castVote, 50],
    [backend.toggleQuestionUpvote, 50],
    [backend.submitComment, 25],
    [backend.submitQuestion, 10],
    [backend.submitReport, 10],
    [backend.searchContent, 50],
    [backend.moderateContent, 10],
    [backend.publishArticle, 5],
    [backend.newsletterSubscribe, 5],
    [backend.newsletterVerify, 5],
    [backend.newsletterUnsubscribe, 5],
    // Strictly serial: two concurrent reconciliation passes would race on
    // the same counters.
    [backend.reconcileCounters, 1],
  ]

  for (const [fn, limit] of CONCURRENCY) {
    fn.resources.cfnResources.cfnFunction.reservedConcurrentExecutions = limit
  }
}

/* ===========================================================================
 * 9. Observability
 *
 * AWS_APP_ID exists ONLY in the Amplify build container, so everything here
 * is guarded twice — an unguarded reference breaks `ampx sandbox`.
 * ======================================================================== */
if (isProduction && process.env.AWS_APP_ID) {
  const observability = backend.createStack('RajChowkObservability')
  const alarmTopic = new sns.Topic(observability, 'AlarmTopic', {
    displayName: 'Raj Chowk production alarms',
  })
  const alarmAction = new cloudwatchActions.SnsAction(alarmTopic)

  const alarm = (
    id: string,
    metric: cloudwatch.IMetric,
    threshold: number,
    evaluationPeriods = 2,
  ): void => {
    const created = new cloudwatch.Alarm(observability, id, {
      metric,
      threshold,
      evaluationPeriods,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    created.addAlarmAction(alarmAction)
  }

  const apiDimensions = { GraphQLAPIId: backend.data.resources.graphqlApi.apiId }

  alarm(
    'AppSync5XX',
    new cloudwatch.Metric({
      namespace: 'AWS/AppSync',
      metricName: '5XXError',
      dimensionsMap: apiDimensions,
      statistic: 'Sum',
      period: Duration.minutes(5),
    }),
    10,
  )

  // A 4XX spike means auth failures or an enumeration attempt, not a bug.
  alarm(
    'AppSync4XX',
    new cloudwatch.Metric({
      namespace: 'AWS/AppSync',
      metricName: '4XXError',
      dimensionsMap: apiDimensions,
      statistic: 'Sum',
      period: Duration.minutes(5),
    }),
    200,
  )

  alarm(
    'AppSyncLatencyP99',
    new cloudwatch.Metric({
      namespace: 'AWS/AppSync',
      metricName: 'Latency',
      dimensionsMap: apiDimensions,
      statistic: 'p99',
      period: Duration.minutes(5),
    }),
    3000,
  )

  const WATCHED_FUNCTIONS: Record<string, { resources: { lambda: { functionName: string } } }> = {
    CastVote: backend.castVote,
    SubmitComment: backend.submitComment,
    ModerateContent: backend.moderateContent,
    PublishArticle: backend.publishArticle,
    NewsletterSubscribe: backend.newsletterSubscribe,
    ReconcileCounters: backend.reconcileCounters,
  }

  for (const [name, fn] of Object.entries(WATCHED_FUNCTIONS)) {
    const dimensionsMap = { FunctionName: fn.resources.lambda.functionName }
    alarm(
      `${name}Errors`,
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap,
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      5,
    )
    alarm(
      `${name}Throttles`,
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Throttles',
        dimensionsMap,
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      1,
    )
  }

  for (const model of ['Article', 'Vote', 'PollOption', 'Comment']) {
    const table = tables[model]
    if (!table) continue
    alarm(
      `${model}Throttled`,
      new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ThrottledRequests',
        dimensionsMap: { TableName: table.tableName },
        statistic: 'Sum',
        period: Duration.minutes(5),
      }),
      1,
    )
  }

  // Deliverability. Crossing 5% bounce or 0.1% complaint gets SES suspended,
  // so these alarm well below the thresholds AWS actually enforces.
  alarm(
    'SESBounceRate',
    new cloudwatch.Metric({
      namespace: 'AWS/SES',
      metricName: 'Reputation.BounceRate',
      statistic: 'Average',
      period: Duration.hours(1),
    }),
    0.03,
    1,
  )
  alarm(
    'SESComplaintRate',
    new cloudwatch.Metric({
      namespace: 'AWS/SES',
      metricName: 'Reputation.ComplaintRate',
      statistic: 'Average',
      period: Duration.hours(1),
    }),
    0.001,
    1,
  )

  // Emitted by reconcile-counters via EMF. Persistent drift means a write path
  // is broken; it should alarm, not be silently repaired every night.
  alarm(
    'CounterDrift',
    new cloudwatch.Metric({
      namespace: 'RajChowk',
      metricName: 'CounterDrift',
      statistic: 'Sum',
      period: Duration.hours(24),
    }),
    0,
    1,
  )
}

/* ===========================================================================
 * 10. Custom outputs consumed by the Next.js app
 * ======================================================================== */
backend.addOutput({
  custom: {
    environment: isProduction ? 'production' : (branch ?? 'sandbox'),
    siteUrl: SITE_URL,
    defaultLanguage: 'HI',
    supportedLanguages: ['HI', 'EN'],
  },
})

export { backend }
