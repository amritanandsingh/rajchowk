/**
 * Grant or revoke a staff role.
 *
 * Roles here are Cognito user-pool GROUPS, not a column on any table.
 * `amplify/auth/resource.ts` creates ADMIN/EDITOR/MODERATOR/MEMBER, and every
 * authorization decision — AppSync `allow.group(...)`, the `isAdmin`/`isStaff`
 * predicates in `amplify/functions/shared/identity.ts` — reads the
 * `cognito:groups` claim on the ID token.
 *
 * Membership is therefore granted out-of-band, holding AWS credentials, and
 * that is deliberate: every in-app path that could grant ADMIN is itself behind
 * `allow.group('ADMIN')`, so the first administrator cannot be bootstrapped from
 * inside the application. This script is that out-of-band path.
 *
 * It exists because the alternative is a hand-typed
 * `aws cognito-idp admin-add-user-to-group`, which happily targets the wrong
 * pool, does nothing at all for a misspelled group name, and never shows what
 * the user actually ended up with.
 *
 * Usage: npm run role:grant -- --email you@example.com --role ADMIN
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider'
// The canonical group names, imported from the module the Lambdas authorize
// with, so this script and the backend can never disagree about what ADMIN is.
import { GROUP, type GroupName } from '../amplify/functions/shared/identity'

const ROLES: GroupName[] = Object.values(GROUP)

const USAGE = `
Grant or revoke a Cognito group (a staff role).

  npm run role:grant -- --email <email> --role <${ROLES.join('|')}>
  npm run role:grant -- --email <email> --role <ROLE> --revoke
  npm run role:grant -- --email <email> --list

Options
  --email <email>       The account's sign-up email. May also be given positionally.
  --role <ROLE>         Group to grant. CASE-SENSITIVE: ${ROLES.join(', ')}.
  --revoke              Remove the group instead of adding it.
  --list                Print the account's current groups and exit. Makes no writes.
  --user-pool-id <id>   Target pool. Defaults to the one in amplify_outputs.json.
  --region <region>     AWS region. Defaults to the region in amplify_outputs.json.
  --yes                 Confirm a write to an explicitly targeted or production pool,
                        and override the last-administrator guard.
  --help                Print this.
`

/** An error the operator caused or can act on: message only, no stack trace. */
class CliError extends Error {
  showUsage: boolean
  constructor(message: string, showUsage = false) {
    super(message)
    this.name = 'CliError'
    this.showUsage = showUsage
  }
}

type Options = {
  email: string
  role: GroupName | undefined
  revoke: boolean
  list: boolean
  userPoolId: string | undefined
  region: string | undefined
  yes: boolean
  help: boolean
}

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('-')) {
    throw new CliError(`${flag} needs a value.`, true)
  }
  return value
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    email: '',
    role: undefined,
    revoke: false,
    list: false,
    userPoolId: undefined,
    region: undefined,
    yes: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) continue

    switch (arg) {
      case '--email':
        options.email = takeValue(argv, index, arg)
        index += 1
        break
      case '--role':
        options.role = resolveRole(takeValue(argv, index, arg))
        index += 1
        break
      case '--user-pool-id':
        options.userPoolId = takeValue(argv, index, arg)
        index += 1
        break
      case '--region':
        options.region = takeValue(argv, index, arg)
        index += 1
        break
      case '--revoke':
        options.revoke = true
        break
      case '--list':
        options.list = true
        break
      case '--yes':
      case '-y':
        options.yes = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        if (arg.startsWith('-')) throw new CliError(`unknown flag ${arg}`, true)
        if (options.email) throw new CliError(`unexpected argument "${arg}"`, true)
        options.email = arg
    }
  }

  if (options.help) return options
  if (!options.email) throw new CliError('--email is required.', true)
  if (!options.list && !options.role) {
    throw new CliError('--role is required (or pass --list to only read).', true)
  }

  return options
}

/**
 * Cognito group names are case-sensitive and `hasGroup` compares them exactly,
 * so `admin` matches nothing. AdminAddUserToGroup would fail on an unknown
 * group anyway, but failing here says WHY.
 */
function resolveRole(raw: string): GroupName {
  if ((ROLES as string[]).includes(raw)) return raw as GroupName

  const upper = raw.toUpperCase()
  if ((ROLES as string[]).includes(upper)) {
    throw new CliError(
      `"${raw}" is not a group name. Cognito groups are case-sensitive — use "${upper}".`,
    )
  }
  throw new CliError(`unknown role "${raw}". Expected one of: ${ROLES.join(', ')}.`)
}

type AmplifyOutputs = {
  auth?: { aws_region?: string; user_pool_id?: string }
  custom?: Record<string, unknown>
}

/**
 * `amplify_outputs.json` is gitignored and written by `ampx sandbox`, so a
 * fresh clone has no idea which pool to talk to. Say so plainly instead of
 * failing on an undefined UserPoolId three calls later.
 */
function readOutputs(): AmplifyOutputs {
  const path = resolve(process.cwd(), 'amplify_outputs.json')
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AmplifyOutputs
  } catch {
    throw new CliError(
      'amplify_outputs.json is missing or unreadable, so there is no pool to target.\n' +
        'Deploy a sandbox first:  npx ampx sandbox --once\n' +
        'Or name the pool directly:  --user-pool-id <id> --region <region>',
    )
  }
}

type Target = { userPoolId: string; region: string; environment: string; explicit: boolean }

function resolveTarget(options: Options): Target {
  const named = options.userPoolId ?? process.env.COGNITO_USER_POOL_ID

  if (named) {
    const region = options.region ?? process.env.AWS_REGION
    if (!region) {
      throw new CliError('a named pool needs a region too: pass --region, or set AWS_REGION.', true)
    }
    return { userPoolId: named, region, environment: 'named explicitly', explicit: true }
  }

  const outputs = readOutputs()
  const userPoolId = outputs.auth?.user_pool_id
  const region = options.region ?? outputs.auth?.aws_region
  if (!userPoolId || !region) {
    throw new CliError('amplify_outputs.json is present but has no auth block — redeploy.')
  }

  return {
    userPoolId,
    region,
    environment: String(outputs.custom?.environment ?? 'unknown'),
    explicit: false,
  }
}

type Identity = { username: string; sub: string; status: string }

async function describeUser(
  cognito: CognitoIdentityProviderClient,
  target: Target,
  email: string,
): Promise<Identity> {
  try {
    const response = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: target.userPoolId, Username: email }),
    )
    const sub = response.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value
    return {
      username: response.Username ?? email,
      sub: sub ?? '(no sub attribute)',
      status: response.UserStatus ?? 'UNKNOWN',
    }
  } catch (error) {
    if ((error as Error).name === 'UserNotFoundException') {
      throw new CliError(
        `no account "${email}" in ${target.userPoolId}.\n` +
          'Create it through the public sign-up flow first (/auth/sign-up), confirm the\n' +
          'emailed code, then run this again.',
      )
    }
    throw error
  }
}

type Membership = { name: string; precedence: number }

/** Sorted by precedence, because index 0 is the effective role. */
async function groupsFor(
  cognito: CognitoIdentityProviderClient,
  target: Target,
  username: string,
): Promise<Membership[]> {
  const response = await cognito.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: target.userPoolId,
      Username: username,
      Limit: 60,
    }),
  )
  return (response.Groups ?? [])
    .map((group) => ({
      name: group.GroupName ?? '(unnamed)',
      precedence: group.Precedence ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.precedence - right.precedence)
}

/**
 * Refuse to remove the only administrator.
 *
 * There is no in-band way back: granting ADMIN requires ADMIN, so an empty
 * ADMIN group can only be repaired by someone with AWS credentials. No
 * pagination loop is needed — a NextToken means there are more than 60
 * administrators, which is emphatically not "the last one".
 */
async function assertNotLastAdmin(
  cognito: CognitoIdentityProviderClient,
  target: Target,
  identity: Identity,
  email: string,
): Promise<void> {
  const response = await cognito.send(
    new ListUsersInGroupCommand({
      UserPoolId: target.userPoolId,
      GroupName: GROUP.ADMIN,
      Limit: 60,
    }),
  )
  if (response.NextToken) return

  const self = new Set([identity.username, identity.sub, email])
  const others = (response.Users ?? []).filter((user) => !self.has(user.Username ?? ''))
  if (others.length > 0) return

  throw new CliError(
    `${email} is the only member of ADMIN. Removing it locks every administrative\n` +
      'path in the application, and only an AWS credential holder could undo that.\n' +
      'Grant ADMIN to someone else first, or pass --yes if that is genuinely intended.',
  )
}

const format = (groups: Membership[]): string =>
  groups.length > 0 ? groups.map((group) => group.name).join(', ') : '(none)'

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }

  const target = resolveTarget(options)
  const cognito = new CognitoIdentityProviderClient({ region: target.region })

  console.log('')
  console.log(`  pool         ${target.userPoolId}  (${target.environment})`)
  console.log(`  region       ${target.region}`)

  const identity = await describeUser(cognito, target, options.email)
  console.log(`  account      ${options.email}  ${identity.status}`)
  console.log(`  sub          ${identity.sub}`)

  const before = await groupsFor(cognito, target, identity.username)
  console.log(`  groups       ${format(before)}`)
  console.log('')

  if (options.list) return

  const role = options.role
  if (!role) throw new CliError('--role is required.', true)

  // A pool named on the command line, or a production pool, is not the one the
  // operator gets to fat-finger.
  if ((target.explicit || target.environment === 'production') && !options.yes) {
    throw new CliError(
      `refusing to write to ${target.userPoolId} (${target.environment}) without --yes.\n` +
        'Re-run the same command with --yes once the pool above is the intended one.',
    )
  }

  // UNCONFIRMED means the post-confirmation trigger has not fired, so the
  // account is not even in MEMBER yet — and it cannot sign in to use the grant.
  if (identity.status !== 'CONFIRMED') {
    console.log(`  NOTE  status is ${identity.status}, not CONFIRMED.`)
    console.log('        The account cannot sign in until the emailed code is entered, and the')
    console.log('        post-confirmation trigger has not added it to MEMBER. Granting anyway.')
    console.log('')
  }

  const held = before.some((group) => group.name === role)

  if (options.revoke) {
    if (role === GROUP.ADMIN && !options.yes) {
      await assertNotLastAdmin(cognito, target, identity, options.email)
    }
    if (!held) {
      console.log(`  ✓  not a member of ${role} — nothing to revoke`)
    } else {
      await cognito.send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: target.userPoolId,
          Username: identity.username,
          GroupName: role,
        }),
      )
      console.log(`  ✓  removed from ${role}`)
    }
  } else if (held) {
    console.log(`  ✓  already a member of ${role} — nothing to do`)
  } else {
    await cognito.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: target.userPoolId,
        Username: identity.username,
        GroupName: role,
      }),
    )
    console.log(`  ✓  added to ${role}`)
  }

  const after = await groupsFor(cognito, target, identity.username)
  console.log(`  ✓  groups now: ${format(after)}`)
  if (after.length > 1) {
    console.log(`     effective role is ${after[0]?.name} — lowest precedence wins`)
  }

  console.log('')
  console.log('  Sign out and sign back in before checking /admin. The cached ID token still')
  console.log('  carries the OLD cognito:groups claim, so nothing appears to have changed until')
  console.log('  Cognito issues a new one.')
  console.log('')
}

main().catch((error: unknown) => {
  process.exitCode = 1
  if (error instanceof CliError) {
    console.error(`\n${error.message}\n`)
    if (error.showUsage) console.error(USAGE)
    return
  }
  console.error('\nrole:grant failed:', error)
})
