/**
 * Produce a secret-free `amplify_outputs.json` so the repository can be
 * linted, typechecked, unit-tested and production-built with NO AWS account.
 *
 * WHY THIS EXISTS
 * ---------------
 * `amplify_outputs.json` is a static default-import in
 * src/lib/amplify/config.ts and src/lib/amplify/browser-client.ts, and it is
 * gitignored — correctly, because it carries the User Pool ID, Identity Pool
 * ID, AppSync URL and the public API key. Webpack therefore cannot resolve
 * those modules on a fresh clone, and `next build` dies with
 *
 *   Module not found: Can't resolve '@/../amplify_outputs.json'
 *
 * before it compiles a single page. Without this script, every quality gate
 * could only run AFTER `ampx pipeline-deploy` had already mutated AWS — which
 * is the wrong order to discover that the build is broken.
 *
 * WHAT MAKES THE STUB USABLE
 * --------------------------
 * `data.model_introspection` is not optional padding. Amplify's runtime
 * `generateClient()` builds `client.queries.*` and `client.models.*` FROM it,
 * so omitting it makes every call in src/lib/amplify/queries.ts `undefined`
 * and the build fails with a TypeError rather than a network error.
 *
 * Endpoints point at 127.0.0.1:1, which refuses instantly with no DNS lookup.
 * Public pages must therefore survive an unreachable backend — `unwrap()` in
 * src/lib/amplify/queries.ts logs and returns null, so pages prerender as
 * empty rather than throwing. A build that breaks here is a real regression in
 * error handling, not a problem with this stub.
 *
 * USAGE
 * -----
 *   tsx scripts/write-ci-outputs.ts            # write the stub (CI)
 *   tsx scripts/write-ci-outputs.ts --force    # overwrite an existing file
 *   tsx scripts/write-ci-outputs.ts --sync     # regenerate the fixture from the schema
 *   tsx scripts/write-ci-outputs.ts --check    # fail if the fixture has drifted
 *
 * `--sync` NEEDS NO AWS ACCOUNT. It reads amplify/data/resource.ts directly,
 * runs the same schema transform Amplify runs at synth time, and feeds the
 * resulting SDL to the model generator. So the fixture is derivable from the
 * source rather than harvested from a deployment, and `--check` can compare
 * the committed fixture against what the current schema would produce. That is
 * what makes drift detectable: a fixture copied out of a sandbox can only be
 * checked for existence, not for correctness.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateModelsSync } from '@aws-amplify/graphql-generator'

const OUTPUTS_PATH = resolve(process.cwd(), 'amplify_outputs.json')
const FIXTURE_PATH = resolve(process.cwd(), 'tests/fixtures/ci-amplify-outputs.json')

const args = new Set(process.argv.slice(2))
const force = args.has('--force')
const sync = args.has('--sync')
const check = args.has('--check')

/**
 * A placeholder that is obviously a placeholder.
 *
 * Every identifier below is syntactically valid for its field — Amplify parses
 * this at import time and a malformed region or pool id fails the build with a
 * confusing message — but none of them resolve to anything. The region is real
 * because `Amplify.configure` validates its shape.
 */
const PLACEHOLDER = {
  version: '1.4',
  auth: {
    user_pool_id: 'ap-south-1_XXXXXXXXX',
    aws_region: 'ap-south-1',
    user_pool_client_id: 'xxxxxxxxxxxxxxxxxxxxxxxxxx',
    identity_pool_id: 'ap-south-1:00000000-0000-4000-8000-000000000000',
    mfa_methods: ['TOTP'],
    standard_required_attributes: ['email'],
    username_attributes: ['email'],
    user_verification_types: ['email'],
    mfa_configuration: 'OPTIONAL',
    password_policy: {
      min_length: 12,
      require_lowercase: true,
      require_uppercase: true,
      require_numbers: true,
      require_symbols: true,
    },
    unauthenticated_identities_enabled: false,
    groups: [{ ADMIN: { precedence: 0 } }],
  },
  data: {
    url: 'http://127.0.0.1:1/graphql',
    aws_region: 'ap-south-1',
    api_key: 'da2-000000000000000000000000',
    default_authorization_type: 'AMAZON_COGNITO_USER_POOLS',
    authorization_types: ['API_KEY'],
    model_introspection: null as unknown,
  },
  custom: { environment: 'ci', region: 'ap-south-1' },
} as const

/**
 * Fields that must never appear in the committed fixture.
 *
 * The account-id pattern excludes an all-zero run, because the placeholder
 * identity pool id legitimately ends in one and the assertion would otherwise
 * reject its own output. Excluding it is safe in a way that loosening the
 * digit count would not be: 000000000000 is not an AWS account.
 */
const FORBIDDEN_PATTERNS: Array<[string, RegExp]> = [
  ['a real AWS account id', /\b(?!0{12}\b)\d{12}\b/],
  ['a real AppSync endpoint', /https:\/\/[a-z0-9]+\.appsync-api\./],
  ['a real Cognito domain', /\.auth\.[a-z0-9-]+\.amazoncognito\.com/],
  ['a real Cognito user pool id', /ap-south-1_(?!X{9})[A-Za-z0-9]{9}/],
]

function assertSecretFree(json: string): void {
  for (const [label, pattern] of FORBIDDEN_PATTERNS) {
    const match = pattern.exec(json)
    if (match) {
      throw new Error(
        `Refusing to write the CI fixture: it contains ${label} (${match[0]}). ` +
          'The fixture is committed to Git and must hold no real identifiers.',
      )
    }
  }
}

/**
 * Build the model introspection from the schema source, with no AWS involved.
 *
 * `schema.transform()` is the same call Amplify makes during synth; it turns
 * the `a.schema({...})` builder into AppSync SDL. `generateModelsSync` with
 * target 'introspection' is the same generator `ampx generate` runs against a
 * deployed API. Composing them locally gives byte-identical output to the
 * deployed path — the model introspection is a pure function of the schema, so
 * there is nothing a real deployment could add.
 *
 * Reaching through `data.props.schema` is the one fragile part: it is Amplify
 * internals, not public API. If a version bump breaks it, the failure is loud
 * (a TypeError here) rather than silent, and the fallback is to lift
 * `data.model_introspection` out of a real `amplify_outputs.json` by hand.
 */
async function buildIntrospection(): Promise<unknown> {
  const { data } = await import('../amplify/data/resource')

  // Double assertion through `unknown` because `props` is not on the public
  // ConstructFactory type. That is the honest signal here: this reaches into
  // Amplify internals, and a version bump could remove it. The failure would
  // be a loud TypeError in `npm run verify`, not silent wrong output.
  const sdl = (
    data as unknown as { props: { schema: { transform: () => { schema: string } } } }
  ).props.schema.transform().schema

  const generated = generateModelsSync({
    schema: sdl,
    target: 'introspection',
    // DataStore is not used — this app talks to AppSync directly — and leaving
    // it on emits sync-protocol fields (_version, _lastChangedAt, _deleted)
    // that our schema does not have.
    isDataStoreEnabled: false,
    // Amplify declares createdAt/updatedAt explicitly in this schema because
    // they are GSI sort keys, so the generator must not add its own.
    addTimestampFields: false,
    improvePluralization: true,
    respectPrimaryKeyAttributesOnConnectionField: true,
    generateModelsForLazyLoadAndCustomSelectionSet: true,
  })

  // The generator returns { '<filename>': '<contents>' }; there is exactly one
  // entry for the introspection target.
  const [contents] = Object.values(generated)
  if (!contents) throw new Error('The model generator produced no output for the schema.')
  return JSON.parse(contents)
}

/** Regenerate the committed fixture from the schema. */
async function syncFixture(): Promise<void> {
  const introspection = await buildIntrospection()
  const json = fixtureJson(introspection)
  assertSecretFree(json)
  writeFileSync(FIXTURE_PATH, json)
  console.log(`Regenerated the CI fixture from amplify/data/resource.ts -> ${FIXTURE_PATH}`)
}

function fixtureJson(introspection: unknown): string {
  const fixture = {
    ...PLACEHOLDER,
    data: { ...PLACEHOLDER.data, model_introspection: introspection },
  }
  return `${JSON.stringify(fixture, null, 2)}\n`
}

function readFixture(): string {
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(
      `Missing ${FIXTURE_PATH}. Deploy a sandbox and run \`npm run ci:outputs:sync\`, ` +
        'then commit the generated fixture.',
    )
  }
  return readFileSync(FIXTURE_PATH, 'utf8')
}

/**
 * Fail if the committed fixture no longer matches the schema.
 *
 * This is the check worth having, and it is only possible because the fixture
 * is DERIVED rather than harvested: adding a field to `Article` and forgetting
 * to re-sync now fails locally in `npm run verify`, instead of producing a CI
 * build whose `client.queries.*` shape silently disagrees with the deployed
 * API.
 */
async function checkFixture(): Promise<void> {
  const committed = readFixture()
  assertSecretFree(committed)

  const parsed = JSON.parse(committed) as { data?: { model_introspection?: unknown } }
  if (!parsed.data?.model_introspection) {
    throw new Error(
      'The CI fixture has no data.model_introspection. Amplify builds client.queries.* from it, ' +
        'so every call would be undefined at runtime. Run `npm run ci:outputs:sync`.',
    )
  }

  const expected = fixtureJson(await buildIntrospection())
  if (expected !== committed) {
    throw new Error(
      'The CI fixture is out of date with amplify/data/resource.ts.\n' +
        'Run `npm run ci:outputs:sync` and commit tests/fixtures/ci-amplify-outputs.json.',
    )
  }

  console.log('CI fixture matches the schema and is secret-free.')
}

function writeOutputs(): void {
  if (existsSync(OUTPUTS_PATH) && !force) {
    // Never clobber a developer's real sandbox outputs by accident — that
    // would silently point their `npm run dev` at 127.0.0.1:1.
    console.log('amplify_outputs.json already exists; leaving it alone (pass --force to replace).')
    return
  }

  const json = readFixture()
  assertSecretFree(json)
  writeFileSync(OUTPUTS_PATH, json)
  console.log(`Wrote placeholder amplify_outputs.json (${json.length} bytes).`)
}

async function main(): Promise<void> {
  if (sync) await syncFixture()
  else if (check) await checkFixture()
  else writeOutputs()
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
