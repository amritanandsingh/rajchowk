/**
 * Produce a secret-free `amplify_outputs.json` so the repo can be linted,
 * typechecked, unit-tested, built and e2e-tested with NO AWS account at all.
 *
 * Why this exists
 * ---------------
 * `amplify_outputs.json` is a static default-import in src/lib/media.ts,
 * src/lib/amplify/config.ts and src/lib/amplify/browser-client.ts, and it is
 * gitignored (correctly — it carries the User Pool ID, Identity Pool ID,
 * AppSync URL and the public API key). Webpack therefore cannot resolve those
 * modules on a fresh clone, and `next build` dies with
 *
 *   Module not found: Can't resolve '@/../amplify_outputs.json'
 *
 * before it compiles a single page. That is the single reason this repo had no
 * CI: every quality gate in amplify.yml runs AFTER `ampx pipeline-deploy` has
 * already mutated AWS, because there was no way to run them anywhere else.
 *
 * What makes the stub usable
 * --------------------------
 * `data.model_introspection` is not optional padding. Amplify's runtime
 * `generateClient()` builds `client.queries.*` / `client.models.*` from it, so
 * omitting it makes every call in src/lib/amplify/queries.ts `undefined` and
 * the build fails with a TypeError instead of a network error. The blob is
 * ~97 KB of pure GraphQL schema shape derived from amplify/data/resource.ts —
 * model names, field types, enum members. It contains no endpoint, no key, no
 * account ID (asserted below), so it is safe to commit.
 *
 * Endpoints point at 127.0.0.1:1, which refuses instantly with no DNS lookup.
 * Public pages must therefore survive an unreachable backend — `unwrap()` in
 * src/lib/amplify/queries.ts already logs and returns null on failure, so they
 * prerender as empty rather than throwing. A build that breaks here is a real
 * regression in error handling, not a problem with this stub.
 *
 * Usage
 * -----
 *   tsx scripts/write-ci-outputs.ts            # write the stub (CI)
 *   tsx scripts/write-ci-outputs.ts --force    # overwrite an existing file
 *   tsx scripts/write-ci-outputs.ts --sync     # refresh the fixture from a real sandbox
 *   tsx scripts/write-ci-outputs.ts --check    # fail if the fixture has drifted
 *
 * Run `--sync` whenever amplify/data/resource.ts or amplify/auth/resource.ts
 * changes, otherwise CI builds against a stale schema shape. `--check` is wired
 * into `npm run verify` so the drift is caught locally rather than in a PR.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'

const OUTPUTS_PATH = resolve(process.cwd(), 'amplify_outputs.json')
const FIXTURE_PATH = resolve(process.cwd(), 'tests/fixtures/ci-amplify-outputs.json')

/**
 * Placeholders. Every one is syntactically valid for the consumer that parses
 * it — Amplify derives the region from the pool ID, so a malformed one throws
 * inside `Amplify.configure` at module load and the failure looks nothing like
 * its cause.
 */
const CI = {
  region: 'ap-south-1',
  userPoolId: 'ap-south-1_CI0000000',
  userPoolClientId: 'ci000000000000000000000000',
  identityPoolId: 'ap-south-1:00000000-0000-4000-8000-000000000000',
  graphqlUrl: 'http://127.0.0.1:1/graphql',
  apiKey: 'da2-ci0000000000000000000000',
  bucket: 'ci-placeholder-media-bucket',
  environment: 'ci',
  siteUrl: 'http://localhost:3000',
} as const

/**
 * Anything matching these must never reach the committed fixture. Checked
 * against the serialized result rather than field-by-field, so a new key added
 * to amplify_outputs.json by a future Amplify release cannot smuggle a real
 * identifier through a sanitizer that does not know about it yet.
 */
const SECRET_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['AppSync API key', /da2-(?!ci0)[a-z0-9]{20,}/i],
  ['AppSync endpoint', /appsync-(api|realtime)/i],
  ['Cognito user pool ID', /[a-z]{2}-[a-z]+-\d_(?!CI000)[A-Za-z0-9]{9,}/],
  ['Cognito identity pool ID', /[a-z]{2}-[a-z]+-\d:(?!00000000-0000-4000)[0-9a-f-]{36}/i],
  ['deployed S3 bucket', /amplify-[a-z0-9]+-[a-z0-9]+-/i],
  // The all-zero placeholder inside the fake identity pool ID is not an account.
  ['AWS account ID', /\b(?!0{12}\b)\d{12}\b/],
  ['ARN', /arn:aws/i],
]

/**
 * Global AWS service endpoints. These are the same string for every customer,
 * carry no account or resource identifier, and legitimately appear in a real
 * outputs file — `cognito-identity.amazonaws.com` shows up under `storage`.
 * Anything else ending in amazonaws.com is account-specific by construction and
 * is treated as a leak.
 */
const GENERIC_AWS_HOSTS: ReadonlySet<string> = new Set([
  'cognito-identity.amazonaws.com',
  'cognito-idp.amazonaws.com',
  's3.amazonaws.com',
])

type Json = { [key: string]: unknown }

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8')) as Json
}

function asObject(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {}
}

/** Replace every real identifier with its CI placeholder, in place on a clone. */
function sanitize(real: Json): Json {
  const out = structuredClone(real)

  const auth = asObject(out.auth)
  if (Object.keys(auth).length > 0) {
    auth.user_pool_id = CI.userPoolId
    auth.user_pool_client_id = CI.userPoolClientId
    auth.identity_pool_id = CI.identityPoolId
    auth.aws_region = CI.region
    out.auth = auth
  }

  const data = asObject(out.data)
  if (Object.keys(data).length > 0) {
    data.url = CI.graphqlUrl
    data.api_key = CI.apiKey
    data.aws_region = CI.region
    out.data = data
  }

  const storage = asObject(out.storage)
  if (Object.keys(storage).length > 0) {
    storage.bucket_name = CI.bucket
    storage.aws_region = CI.region
    if (Array.isArray(storage.buckets)) {
      storage.buckets = storage.buckets.map((entry) => ({
        ...asObject(entry),
        bucket_name: CI.bucket,
        aws_region: CI.region,
      }))
    }
    out.storage = storage
  }

  out.custom = {
    ...asObject(out.custom),
    environment: CI.environment,
    siteUrl: CI.siteUrl,
  }

  return out
}

/** Refuse to emit anything that still looks like a real deployment. */
function assertNoSecrets(candidate: Json): void {
  const serialized = JSON.stringify(candidate)
  const leaks = SECRET_PATTERNS.filter(([, pattern]) => pattern.test(serialized)).map(
    ([label, pattern]) => `  ${label}: ${serialized.match(pattern)?.[0] ?? '(match)'}`,
  )

  const foreignHosts = [
    ...new Set(serialized.match(/[a-z0-9._-]+\.amazonaws\.com/gi) ?? []),
  ].filter((host) => !GENERIC_AWS_HOSTS.has(host.toLowerCase()))
  leaks.push(...foreignHosts.map((host) => `  account-specific AWS host: ${host}`))

  if (leaks.length > 0) {
    throw new Error(
      `Refusing to write — the sanitized outputs still contain real identifiers:\n${leaks.join('\n')}\n\n` +
        'A new key in amplify_outputs.json probably needs handling in sanitize().',
    )
  }
}

function introspectionOf(outputs: Json): unknown {
  return asObject(outputs.data).model_introspection
}

function syncFixture(): void {
  if (!existsSync(OUTPUTS_PATH)) {
    throw new Error(
      '--sync needs a real amplify_outputs.json to derive the shape from.\n' +
        'Deploy a sandbox first:  npx ampx sandbox --once',
    )
  }

  const sanitized = sanitize(readJson(OUTPUTS_PATH))
  assertNoSecrets(sanitized)

  mkdirSync(dirname(FIXTURE_PATH), { recursive: true })
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8')

  const models = Object.keys(asObject(asObject(introspectionOf(sanitized)).models)).length
  console.log(`Wrote ${FIXTURE_PATH}`)
  console.log(`  ${models} models in model_introspection, no secrets detected.`)
}

function checkFixture(): void {
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(`Fixture missing: ${FIXTURE_PATH}\nGenerate it with: npm run ci:outputs:sync`)
  }

  // Always re-assert the committed fixture is clean, even with no sandbox to
  // compare against — that check is cheap and it is the one that matters.
  const fixture = readJson(FIXTURE_PATH)
  assertNoSecrets(fixture)

  if (!existsSync(OUTPUTS_PATH)) {
    console.log('No local amplify_outputs.json — fixture is clean, drift not checked.')
    return
  }

  const live = JSON.stringify(introspectionOf(readJson(OUTPUTS_PATH)))
  const stub = JSON.stringify(introspectionOf(fixture))

  if (live !== stub) {
    throw new Error(
      'CI outputs fixture has drifted from the deployed schema.\n' +
        'amplify/data/resource.ts changed without regenerating the fixture, so CI\n' +
        'would build against a stale GraphQL shape.\n\n' +
        'Fix:  npm run ci:outputs:sync   (then commit tests/fixtures/ci-amplify-outputs.json)',
    )
  }

  console.log('CI outputs fixture matches the deployed schema.')
}

function writeStub(force: boolean): void {
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(`Fixture missing: ${FIXTURE_PATH}\nGenerate it with: npm run ci:outputs:sync`)
  }

  if (existsSync(OUTPUTS_PATH) && !force) {
    // Clobbering a developer's real sandbox config would be silent and
    // extremely annoying to diagnose, so this is opt-in.
    console.log(
      'amplify_outputs.json already exists — leaving it alone. Use --force to replace it.',
    )
    return
  }

  const fixture = readJson(FIXTURE_PATH)
  assertNoSecrets(fixture)
  writeFileSync(OUTPUTS_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
  console.log(`Wrote placeholder amplify_outputs.json (environment="${CI.environment}").`)
  console.log('Backend calls will fail fast against 127.0.0.1:1 — this is expected.')
}

function main(): void {
  const args = new Set(process.argv.slice(2))

  try {
    if (args.has('--sync')) syncFixture()
    else if (args.has('--check')) checkFixture()
    else writeStub(args.has('--force'))
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

main()
