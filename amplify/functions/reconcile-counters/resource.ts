import { defineFunction } from '@aws-amplify/backend'

/**
 * Recomputes denormalised counters from the authoritative rows.
 *
 * Vote and upvote rows are the record of truth; counters are projections of
 * them. Runs nightly and on demand. Resumable, and never uses Scan.
 *
 * `resourceGroupName: 'data'` is REQUIRED and load-bearing. This function is
 * both a custom-operation handler (so the data stack depends on it) and a
 * consumer of data table names via `addEnvironment` in backend.ts (so it
 * depends on the data stack). Without co-locating it in the data stack,
 * CloudFormation fails with a circular dependency between nested stacks.
 * Removing this line will break `ampx sandbox` — it is not decoration.
 */
export const reconcileCounters = defineFunction({
  name: 'reconcile-counters',
  entry: './handler.ts',
  // The documented default is a stale Node 18; Lambda has deprecated that
  // runtime and Amplify Hosting no longer supports it. Always pin explicitly.
  runtime: 22,
  timeoutSeconds: 300,
  memoryMB: 1024,
  resourceGroupName: 'data',
  environment: {
    POWERTOOLS_SERVICE_NAME: 'reconcile-counters',
    POWERTOOLS_LOG_LEVEL: 'INFO',
    RECONCILE_MAX_ITEMS: '200',
  },
})
