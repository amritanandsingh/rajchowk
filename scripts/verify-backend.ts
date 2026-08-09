/**
 * Phase 2 verification harness.
 *
 * Runs the checks that CANNOT be made by typechecking, linting or reading
 * documentation — every one of them is a claim about how the deployed backend
 * actually behaves, and each has already been wrong once during this build.
 *
 *   1. Item shape        — does a client-created row carry __typename /
 *                          createdAt / updatedAt, and is _version ABSENT?
 *                          Every raw-SDK write depends on this answer.
 *   2. Field write lock  — can an ADMIN set Article.status through GraphQL?
 *                          It MUST be refused. This is the assumption the
 *                          entire public-feed gating rests on.
 *   3. Duplicate create  — the VERBATIM errorType for a conditional-check
 *                          failure, so no handler branches on a guessed string.
 *   4. Public read       — does the API key reach the content queries?
 *   5. Draft harvesting  — is a filtered model read as the public principal
 *                          refused outright?
 *
 * Usage: npx tsx scripts/verify-backend.ts
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { Amplify } from 'aws-amplify'
import { generateClient } from 'aws-amplify/data'
import { signIn, signOut } from 'aws-amplify/auth'
import type { Schema } from '../amplify/data/resource'

const outputs = JSON.parse(readFileSync('amplify_outputs.json', 'utf8'))
const REGION: string = outputs.auth.aws_region
const USER_POOL_ID: string = outputs.auth.user_pool_id

const ADMIN_EMAIL = 'verify-admin@e2e.rajchowk.test'
const ADMIN_PASSWORD = 'VerifyAdmin!2026-Rc'

Amplify.configure(outputs)

const cognito = new CognitoIdentityProviderClient({ region: REGION })
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))

let pass = 0
let fail = 0

function report(ok: boolean, name: string, detail = ''): void {
  if (ok) {
    pass += 1
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    fail += 1
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Create a pre-confirmed ADMIN. Idempotent, so the script can be re-run. */
async function ensureAdminUser(): Promise<void> {
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: ADMIN_EMAIL,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: ADMIN_EMAIL },
          { Name: 'email_verified', Value: 'true' },
        ],
      }),
    )
  } catch (error) {
    if ((error as Error).name !== 'UsernameExistsException') throw error
  }

  // Permanent password, so there is no FORCE_CHANGE_PASSWORD challenge.
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: ADMIN_EMAIL,
      Password: ADMIN_PASSWORD,
      Permanent: true,
    }),
  )

  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: ADMIN_EMAIL,
      GroupName: 'ADMIN',
    }),
  )
}

/**
 * Find a model's physical table name.
 *
 * Amplify names tables `<Model>-<apiId>-<envName>`, and the apiId is NOT the
 * AppSync endpoint subdomain, so it cannot be derived from outputs.data.url.
 */
async function resolveTable(model: string): Promise<string> {
  const { DynamoDBClient: RawClient, ListTablesCommand } = await import('@aws-sdk/client-dynamodb')
  const raw = new RawClient({ region: REGION })
  const listed = await raw.send(new ListTablesCommand({}))
  const match = (listed.TableNames ?? []).find((name) => name.startsWith(`${model}-`))
  if (!match) throw new Error(`No DynamoDB table found for model ${model}`)
  return match
}

async function main(): Promise<void> {
  console.log('\nRaj Chowk — backend verification\n')

  // ---------------------------------------------------------------- 4 & 5
  // Public principal first, before any sign-in pollutes the client.
  console.log('Public (API key) access')
  const publicClient = generateClient<Schema>({ authMode: 'apiKey' })

  const feed = await publicClient.queries.listPublishedArticles({ language: 'HI', limit: 5 })
  report(
    !feed.errors,
    'API key can call listPublishedArticles',
    feed.errors
      ? JSON.stringify(feed.errors.map((e) => e.message))
      : `items=${feed.data?.items?.length ?? 0}`,
  )

  // The attack the whole authorization design exists to prevent.
  const draftHarvest = await publicClient.models.Article.list({
    filter: { status: { eq: 'DRAFT' } },
    limit: 5,
  })
  report(
    !!draftHarvest.errors?.length && !draftHarvest.data?.length,
    'API key CANNOT list Articles (draft harvesting refused)',
    draftHarvest.errors?.[0]?.errorType ?? 'no error returned — THIS IS A LEAK',
  )

  // ------------------------------------------------------------------ setup
  console.log('\nAdmin session')
  await ensureAdminUser()
  try {
    await signOut()
  } catch {
    /* no session yet */
  }
  await signIn({ username: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  report(true, 'signed in as ADMIN')

  const admin = generateClient<Schema>({ authMode: 'userPool' })

  // ---------------------------------------------------------------------- 1
  console.log('\nItem shape (governs every raw-SDK write)')
  const slug = `verify-${randomUUID().slice(0, 8)}`
  const created = await admin.models.Category.create({
    slug,
    nameHi: 'सत्यापन',
    nameEn: 'Verification',
    displayOrder: 999,
    isActive: false,
  })

  if (created.errors?.length) {
    report(
      false,
      'ADMIN can create a Category',
      JSON.stringify(created.errors.map((e) => e.message)),
    )
  } else {
    report(true, 'ADMIN can create a Category', `id=${created.data?.id}`)

    // The AppSync SUBDOMAIN is not the API id used in table names — they are
    // different identifiers. Resolve the real table by prefix instead of
    // deriving it from the endpoint.
    const tableName = await resolveTable('Category')
    // ConsistentRead on the primary key. A Scan here is eventually consistent
    // and came back empty immediately after the create, which looked like a
    // missing __typename rather than a stale read.
    const fetched = await ddb.send(
      new GetCommand({
        TableName: tableName,
        Key: { id: created.data!.id },
        ConsistentRead: true,
      }),
    )
    const row = fetched.Item
    const attributes = row ? Object.keys(row).sort() : []
    console.log(`        attributes: ${attributes.join(', ')}`)

    report(attributes.includes('__typename'), '__typename present (required by every GraphQL read)')
    report(attributes.includes('createdAt'), 'createdAt present')
    report(attributes.includes('updatedAt'), 'updatedAt present')
    report(
      !attributes.includes('_version') && !attributes.includes('_lastChangedAt'),
      '_version / _lastChangedAt ABSENT (conflict resolution off, as assumed)',
      attributes.filter((a) => a.startsWith('_') && a !== '__typename').join(',') || 'none',
    )
  }

  // ---------------------------------------------------------------------- 3
  console.log('\nConditional write (the mechanism vote/upvote idempotency uses)')
  // NOTE: the Amplify client REFUSES an explicit `id` on create
  // ("Unauthorized on [id]"), so a duplicate-create test through the client
  // never reaches a conditional check. The handlers do not use the client for
  // this — they use a raw-SDK conditional Put with a deterministic id, which
  // is what is verified here.
  const voteTable = await resolveTable('Vote')
  const deterministicId = `verify-poll#verify-user-${randomUUID().slice(0, 8)}`
  const now = new Date().toISOString()
  const voteItem = {
    id: deterministicId,
    __typename: 'Vote',
    createdAt: now,
    updatedAt: now,
    pollId: 'verify-poll',
    pollOptionId: 'verify-option',
    userSub: 'verify-user',
    castAt: now,
    changeCount: 0,
  }

  await ddb.send(
    new PutCommand({
      TableName: voteTable,
      Item: voteItem,
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  )
  report(true, 'first conditional Put succeeds')

  let conditionalErrorName = '(none)'
  try {
    await ddb.send(
      new PutCommand({
        TableName: voteTable,
        Item: voteItem,
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    )
    report(
      false,
      'duplicate conditional Put is refused',
      'it SUCCEEDED — one-vote-per-user is broken',
    )
  } catch (error) {
    conditionalErrorName = (error as Error).name
    report(
      conditionalErrorName === 'ConditionalCheckFailedException',
      'duplicate conditional Put is refused',
      conditionalErrorName,
    )
  }
  console.log(`        error name: ${conditionalErrorName}`)

  // "Individual users' votes must never be publicly readable" is satisfied by
  // removing the operations entirely rather than by an auth rule, so the
  // generated client should not even HAVE a Vote query. Verify that literally.
  const voteModel = (admin.models as Record<string, Record<string, unknown>>).Vote
  report(
    typeof voteModel?.get !== 'function' && typeof voteModel?.list !== 'function',
    'Vote exposes NO GraphQL read operation (there is no query to call)',
    voteModel
      ? `methods: ${Object.keys(voteModel).join(',') || 'none'}`
      : 'model absent from client',
  )

  const upvoteModel = (admin.models as Record<string, Record<string, unknown>>).QuestionUpvote
  report(
    typeof upvoteModel?.get !== 'function' && typeof upvoteModel?.list !== 'function',
    'QuestionUpvote exposes NO GraphQL read operation',
    upvoteModel
      ? `methods: ${Object.keys(upvoteModel).join(',') || 'none'}`
      : 'model absent from client',
  )

  // ---------------------------------------------------------------------- 2
  console.log('\nField-level write lock (the highest-risk assumption)')
  const article = await admin.models.Article.create({
    slug: `verify-article-${randomUUID().slice(0, 8)}`,
    language: 'HI',
    contentType: 'NEWS',
    title: 'सत्यापन लेख',
    excerpt: 'सत्यापन',
    bodyMarkdown: 'सत्यापन सामग्री',
    categoryId: created.data?.id ?? randomUUID(),
    authorProfileId: randomUUID(),
    authorDisplayName: 'सत्यापन',
  })

  if (article.errors?.length) {
    report(
      false,
      'ADMIN can create an Article',
      JSON.stringify(article.errors.map((e) => e.message)),
    )
  } else {
    report(
      true,
      'ADMIN can create an Article (status is unset, i.e. locked)',
      `status=${String(article.data?.status)}`,
    )

    // MUST be refused: status is field-level read-only, so only a Lambda
    // holding scoped table IAM may set it. If this succeeds, the public feed
    // gating is worthless and the design must fall back to disableOperations.
    const escalate = await admin.models.Article.update({
      id: article.data!.id,
      status: 'PUBLISHED',
    } as never)

    report(
      !!escalate.errors?.length || escalate.data?.status !== 'PUBLISHED',
      'ADMIN CANNOT set Article.status through GraphQL',
      escalate.errors?.[0]?.errorType ?? `status is now ${String(escalate.data?.status)}`,
    )

    const escalateFeed = await admin.models.Article.update({
      id: article.data!.id,
      feedKey: 'PUBLISHED#HI',
    } as never)
    report(
      !!escalateFeed.errors?.length || escalateFeed.data?.feedKey !== 'PUBLISHED#HI',
      'ADMIN CANNOT set Article.feedKey through GraphQL',
      escalateFeed.errors?.[0]?.errorType ?? `feedKey is now ${String(escalateFeed.data?.feedKey)}`,
    )
  }

  await signOut()

  console.log(`\n${pass} passed, ${fail} failed\n`)
  if (fail > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('\nverification harness crashed:', error)
  process.exitCode = 1
})
