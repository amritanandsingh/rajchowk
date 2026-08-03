import { DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import { ddb } from './tables'
import { region } from './outputs'

/**
 * Resetting the rate limiter between tests.
 *
 * Every test in a file acts as the same MEMBER, so the vote budget (10 per
 * 60 s) is exhausted after a handful of tests and everything afterwards returns
 * RATE_LIMITED. That is the limiter doing its job — the suite is genuinely
 * hammering one account — so the fix is to reset the counters between tests
 * rather than to raise the limits and stop testing the real configuration.
 *
 * The counters live at `${scope}#${subject}#${windowStart}`, which is fully
 * deterministic, so this deletes exactly the rows involved. `rate-limit.test.ts`
 * deliberately does NOT reset, because tripping the limiter is its whole point.
 */

/**
 * Every scope declared in RATE_LIMITS.
 *
 * Kept as a literal list rather than derived, so adding a budget without
 * updating this shows up as a rate-limited test rather than silently reducing
 * coverage.
 */
const SCOPES = [
  'vote:burst',
  'vote:hour',
  'upvote:burst',
  'upvote:hour',
  'comment:burst',
  'comment:day',
  'comment:ip',
  'question:burst',
  'question:day',
  'report:burst',
  'report:day',
  'newsletter:hour',
  'newsletter:day',
  'search:burst',
] as const

/** All window lengths used by those budgets. */
const WINDOWS = [60, 300, 600, 3600, 86400] as const

const raw = new DynamoDBClient({ region: region() })
let rateLimitTable: string | undefined

/**
 * The rate-limit table is a plain CDK TableV2, not an Amplify model, so it does
 * NOT follow the `<Model>-<apiId>-<env>` naming that tableFor() relies on.
 */
async function resolveRateLimitTable(): Promise<string> {
  if (rateLimitTable) return rateLimitTable

  const names: string[] = []
  let start: string | undefined
  do {
    const page = await raw.send(
      new ListTablesCommand(start ? { ExclusiveStartTableName: start } : {}),
    )
    names.push(...(page.TableNames ?? []))
    start = page.LastEvaluatedTableName
  } while (start)

  const match = names.find((name) => name.includes('RateLimitTable'))
  if (!match) throw new Error('Could not find the rate-limit table — is the sandbox current?')

  rateLimitTable = match
  return match
}

/**
 * Delete every rate-limit counter for the given subjects.
 *
 * Covers the current AND previous window for each length, since a test can
 * straddle a boundary.
 */
export async function resetRateLimits(...subjects: string[]): Promise<void> {
  const table = await resolveRateLimitTable()
  const nowSec = Math.floor(Date.now() / 1000)

  const deletes: Array<Promise<unknown>> = []

  for (const subject of subjects) {
    for (const scope of SCOPES) {
      for (const window of WINDOWS) {
        const current = Math.floor(nowSec / window) * window
        for (const windowStart of [current, current - window]) {
          deletes.push(
            ddb
              .send(new DeleteCommand({ TableName: table, Key: { id: `${scope}#${subject}#${windowStart}` } }))
              // A missing row is the normal case; DeleteItem is idempotent.
              .catch(() => undefined),
          )
        }
      }
    }
  }

  await Promise.all(deletes)
}

/** Convenience: reset for a Cognito sub, which the handlers key as `u_<sub>`. */
export async function resetRateLimitsForUser(...subs: string[]): Promise<void> {
  await resetRateLimits(...subs.map((sub) => `u_${sub}`))
}
