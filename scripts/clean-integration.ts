/**
 * Sweep the wreckage of a crashed integration run.
 *
 * `tests/integration/harness/ledger.ts` has always told the reader that an
 * interrupted run "can still be swept afterwards with
 * `npm run test:integration:clean`" — but that script did not exist. This is it.
 *
 * A normal run cleans up after itself in global-setup's teardown. This matters
 * when the process is killed (Ctrl-C, a CI timeout, an OOM), because the
 * leftovers are not inert: the next run's assertions inherit orphaned rows, and
 * `verify-backend.ts` additionally leaks a permanent `verify-admin@…` ADMIN on
 * every single invocation, which is a standing privileged account in the pool.
 *
 * Two things are swept:
 *   1. Every row in the on-disk ledger at
 *      node_modules/.cache/rajchowk-integration-ledger.jsonl
 *   2. Every Cognito user in the test email domain — the `it-<runId>-<role>@`
 *      users from the integration harness and the `verify-admin@` from
 *      verify-backend.
 *
 * Refuses to run against production, using the same `assertNotProduction()`
 * guard the integration suite relies on.
 *
 * Usage
 * -----
 *   npm run test:integration:clean            # sweep
 *   npm run test:integration:clean -- --dry-run
 */
import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import {
  clearPersistedLedger,
  readPersistedLedger,
  sweep,
} from '../tests/integration/harness/ledger'
import { assertNotProduction, region, userPoolId } from '../tests/integration/harness/outputs'

const EMAIL_DOMAIN = process.env.E2E_EMAIL_DOMAIN ?? 'e2e.rajchowk.test'

async function sweepLedger(dryRun: boolean): Promise<void> {
  const entries = readPersistedLedger()

  if (entries.length === 0) {
    console.log('Ledger: empty — nothing to sweep.')
    return
  }

  const byModel = new Map<string, number>()
  for (const entry of entries) byModel.set(entry.model, (byModel.get(entry.model) ?? 0) + 1)
  const summary = [...byModel].map(([model, count]) => `${model}×${count}`).join(', ')
  console.log(`Ledger: ${entries.length} row(s) — ${summary}`)

  if (dryRun) return

  const { deleted, failed } = await sweep(entries)
  console.log(`  deleted ${deleted}, failed ${failed}`)
  // Only clear once the deletes have been attempted, so a crash mid-sweep
  // leaves the ledger intact and the next run can retry.
  if (failed === 0) clearPersistedLedger()
}

async function sweepUsers(dryRun: boolean): Promise<void> {
  const cognito = new CognitoIdentityProviderClient({ region: region() })
  const stale: string[] = []
  let paginationToken: string | undefined

  do {
    const page = await cognito.send(
      new ListUsersCommand({
        UserPoolId: userPoolId(),
        Limit: 60,
        ...(paginationToken ? { PaginationToken: paginationToken } : {}),
      }),
    )

    for (const user of page.Users ?? []) {
      const email = user.Attributes?.find((a) => a.Name === 'email')?.Value ?? user.Username ?? ''
      // Match on the domain, not a username prefix: it covers both the
      // it-<runId>-<role>@ harness users and verify-backend's verify-admin@,
      // and it can never touch a real account.
      if (email.endsWith(`@${EMAIL_DOMAIN}`) && user.Username) stale.push(user.Username)
    }

    paginationToken = page.PaginationToken
  } while (paginationToken)

  if (stale.length === 0) {
    console.log(`Cognito: no users in @${EMAIL_DOMAIN}.`)
    return
  }

  console.log(`Cognito: ${stale.length} test user(s) in @${EMAIL_DOMAIN}`)
  for (const username of stale) console.log(`  ${username}`)

  if (dryRun) return

  let deleted = 0
  for (const username of stale) {
    try {
      await cognito.send(
        new AdminDeleteUserCommand({ UserPoolId: userPoolId(), Username: username }),
      )
      deleted += 1
    } catch (error) {
      console.warn(`  could not delete ${username}: ${(error as Error).message}`)
    }
  }
  console.log(`  deleted ${deleted}/${stale.length}`)
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  // Same guard the integration suite uses. Deleting "test-looking" users out of
  // a production pool would be unrecoverable.
  assertNotProduction()

  console.log(`Pool ${userPoolId()} in ${region()}${dryRun ? '  (dry run)' : ''}\n`)
  await sweepLedger(dryRun)
  await sweepUsers(dryRun)

  if (dryRun) console.log('\nDry run — nothing was deleted.')
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
