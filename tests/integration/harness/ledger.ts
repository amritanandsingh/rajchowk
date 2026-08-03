import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { deleteRow } from './tables'

/**
 * The cleanup ledger.
 *
 * Every row a test creates is recorded here and deleted on teardown. Raw
 * DynamoDB deletes are used rather than GraphQL because several models —
 * Vote, QuestionUpvote, AuditLog, NewsletterSubscription — have
 * `disableOperations(['mutations'])` and simply cannot be deleted through the
 * API at all.
 *
 * The ledger is also appended to disk, so a run that crashes hard can still be
 * swept afterwards with `npm run test:integration:clean`. Without that, a
 * killed run leaves orphaned rows and the next run's assertions inherit them.
 */

export type LedgerEntry = { model: string; key: Record<string, unknown> }

const LEDGER_PATH = resolve(process.cwd(), 'node_modules/.cache/rajchowk-integration-ledger.jsonl')

const entries: LedgerEntry[] = []

/** Record a row for deletion. Safe to call more than once for the same row. */
export function track(model: string, key: Record<string, unknown>): void {
  entries.push({ model, key })
  try {
    mkdirSync(dirname(LEDGER_PATH), { recursive: true })
    appendFileSync(LEDGER_PATH, `${JSON.stringify({ model, key })}\n`, 'utf8')
  } catch {
    // A ledger-file failure must not fail a test; the in-memory list still
    // drives teardown for this process.
  }
}

export function trackedCount(): number {
  return entries.length
}

/**
 * Delete everything recorded, newest first.
 *
 * Reverse order matters: a child row (a comment) is deleted before the parent
 * (its article), so a partially-deleted graph never looks like live data to a
 * subsequent run.
 */
export async function sweep(
  list: LedgerEntry[] = entries,
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0
  let failed = 0

  for (const entry of [...list].reverse()) {
    try {
      await deleteRow(entry.model, entry.key)
      deleted += 1
    } catch (error) {
      failed += 1
      console.warn(
        `cleanup: could not delete ${entry.model} ${JSON.stringify(entry.key)}: ${(error as Error).message}`,
      )
    }
  }

  entries.length = 0
  return { deleted, failed }
}

/** Read a ledger left behind by a crashed run. */
export function readPersistedLedger(): LedgerEntry[] {
  if (!existsSync(LEDGER_PATH)) return []
  return readFileSync(LEDGER_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as LedgerEntry]
      } catch {
        return []
      }
    })
}

export function clearPersistedLedger(): void {
  try {
    writeFileSync(LEDGER_PATH, '', 'utf8')
  } catch {
    // Nothing to do — the file is a convenience, not a requirement.
  }
}
