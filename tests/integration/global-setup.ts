import { randomUUID } from 'node:crypto'
import type { TestProject } from 'vitest/node'
import { assertNotProduction } from './harness/outputs'
import { clearPersistedLedger, readPersistedLedger, sweep } from './harness/ledger'
import { createUser, deleteUser, ROLES, type Role, type TestUser } from './harness/users'

/**
 * Integration-suite setup and teardown.
 *
 * Creates one pre-confirmed user per role, mints an ID token for each, and
 * hands them to test files through vitest's `provide()`. Teardown deletes every
 * row the tests created and then the users themselves.
 *
 * The returned teardown function is guaranteed to run even if a test throws,
 * which is what keeps the sandbox clean. `verify-backend.ts` predates this and
 * leaks a permanent admin user on every run; it should be migrated onto this.
 */

declare module 'vitest' {
  export interface ProvidedContext {
    runId: string
    testUsers: Record<Role, TestUser>
  }
}

export default async function setup({ provide }: TestProject) {
  // These tests create and delete real data, so refuse outright if the deployed
  // outputs claim to be production.
  assertNotProduction()

  // A per-run id keeps parallel runs (a developer and CI at once) from sharing
  // users, and makes orphans traceable to a run.
  const runId = randomUUID().slice(0, 8)
  const started = Date.now()

  console.log(`\n[integration] run ${runId}: creating ${ROLES.length} test users…`)

  const users = {} as Record<Role, TestUser>
  for (const role of ROLES) {
    users[role] = await createUser(role, runId)
  }

  provide('runId', runId)
  provide('testUsers', users)

  console.log(`[integration] users ready in ${Date.now() - started}ms\n`)

  return async () => {
    console.log('\n[integration] cleaning up…')

    // Sweep the PERSISTED ledger, not the in-memory one.
    //
    // Vitest runs globalSetup in a different module context from the test
    // files, so the `entries` array this process sees is always empty — the
    // tests populated their own instance. The on-disk JSONL is the only shared
    // record, which is also what makes a crashed run recoverable.
    const { deleted, failed } = await sweep(readPersistedLedger())
    console.log(`[integration] deleted ${deleted} row(s)${failed ? `, ${failed} failed` : ''}`)

    for (const role of ROLES) {
      await deleteUser(users[role].username)
    }
    console.log(`[integration] deleted ${ROLES.length} test user(s)`)

    clearPersistedLedger()
  }
}
