/**
 * Assert the deployed backend's authorization actually behaves as the schema
 * claims, and print what redeployment idempotency should be judged on.
 *
 * WHY A SCRIPT AND NOT A UNIT TEST. Everything in `npm run verify` runs against
 * source. This runs against a DEPLOYED AppSync API, which is the only place
 * the `@auth` directives are real. The specific thing it proves is negative and
 * cannot be proven any other way: that the public API key CANNOT read the
 * Article model, so a draft is unreachable by an anonymous caller even though
 * the published feed is not.
 *
 * Usage:
 *   npm run verify:backend
 *
 * Needs a deployed sandbox or branch (`npm run sandbox:once`) and nothing else
 * — it makes no authenticated calls, so it needs no credentials at all.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Outputs = {
  auth?: { user_pool_id?: string; aws_region?: string }
  data?: { url?: string; api_key?: string; aws_region?: string }
}

const outputsPath = resolve(process.cwd(), 'amplify_outputs.json')
if (!existsSync(outputsPath)) {
  console.error('No amplify_outputs.json. Run `npm run sandbox:once` first.')
  process.exit(1)
}

const outputs = JSON.parse(readFileSync(outputsPath, 'utf8')) as Outputs
const endpoint = outputs.data?.url
const apiKey = outputs.data?.api_key

if (!endpoint || !apiKey) {
  console.error('amplify_outputs.json has no data.url / data.api_key.')
  process.exit(1)
}
if (endpoint.includes('127.0.0.1')) {
  console.error('amplify_outputs.json is the CI placeholder. Run `npm run sandbox:once` first.')
  process.exit(1)
}

/** Raw fetch rather than the Amplify client: this must exercise the wire
 *  protocol an attacker would, not a client that might filter for us. */
async function graphql(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(endpoint!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey! },
    body: JSON.stringify({ query, variables }),
    // Bounded: a hung request should fail the check, not hang CI.
    signal: AbortSignal.timeout(15_000),
  })
  return (await response.json()) as { data?: unknown; errors?: Array<{ message: string }> }
}

let failures = 0

function check(name: string, passed: boolean, detail = ''): void {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures++
}

async function main(): Promise<void> {
  console.log(`Endpoint: ${endpoint}`)
  console.log(`Pool:     ${outputs.auth?.user_pool_id} (${outputs.auth?.aws_region})`)
  console.log('')
  console.log('--- What an ANONYMOUS caller holding the public API key can do ---')

  /**
   * THE assertion. If `listArticles` ever answers for the API key, every draft
   * in the system is one `filter: { status: { eq: DRAFT } }` away from public.
   *
   * Both outcomes are a pass: an Unauthorized error, or the field not existing
   * in the schema at all. The second is the stronger one and is what the
   * current design produces — `Article` carries no publicApiKey rule, so
   * AppSync emits no directive and the field is unreachable.
   */
  const models = await graphql('query { listArticles { items { id title status } } }')
  const modelsRefused = Boolean(
    models.errors?.some((error) =>
      /unauthorized|not authorized|cannot query field|validationerror/i.test(error.message),
    ),
  )
  check(
    'CANNOT read the Article model directly',
    modelsRefused,
    modelsRefused ? '' : `got: ${JSON.stringify(models).slice(0, 200)}`,
  )

  const single = await graphql('query { getArticle(id: "any") { id title status } }')
  const singleRefused = Boolean(
    single.errors?.some((error) =>
      /unauthorized|not authorized|cannot query field|validationerror/i.test(error.message),
    ),
  )
  check('CANNOT read a single Article by id', singleRefused)

  const admin = await graphql(
    'query { listArticlesForAdmin(status: "DRAFT") { items { id title } } }',
  )
  const adminRefused = Boolean(admin.errors?.length)
  check('CANNOT reach the admin list query', adminRefused)

  const write = await graphql(
    'mutation { saveArticle(title: "x", summary: "y", content: "z") { ok } }',
  )
  const writeRefused = Boolean(write.errors?.length)
  check('CANNOT call saveArticle', writeRefused)

  const publish = await graphql(
    'mutation { setArticleStatus(articleId: "any", action: "PUBLISH") { ok } }',
  )
  check('CANNOT call setArticleStatus', Boolean(publish.errors?.length))

  // The positive control. Without it, a totally broken API would "pass" every
  // negative assertion above and look like excellent security.
  const feed = await graphql(
    'query { listPublishedArticles(limit: 1) { items { id slug title } nextToken } }',
  )
  const feedWorks = !feed.errors?.length && feed.data !== undefined
  check(
    'CAN read the published feed',
    feedWorks,
    feedWorks ? '' : JSON.stringify(feed.errors).slice(0, 200),
  )

  console.log('')
  console.log('--- Idempotency reference ---')
  console.log('Redeploy and re-run: BOTH of these must be unchanged.')
  console.log(`  AppSync API : ${endpoint}`)
  console.log(`  User pool   : ${outputs.auth?.user_pool_id}`)
  console.log('')
  console.log('A changed value means the deployment REPLACED infrastructure rather than')
  console.log('updating it, which is the failure this project is required to avoid.')

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll backend authorization checks passed.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
