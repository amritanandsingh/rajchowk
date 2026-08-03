import { defineFunction } from '@aws-amplify/backend'

/**
 * The publishing state machine: status transitions, slug redirects, revision
 * snapshots, feed keys and the search index, in one place.
 *
 * `resourceGroupName: 'data'` is REQUIRED and load-bearing. This function is
 * both a custom-operation handler (so the data stack depends on it) and a
 * consumer of data table names via `addEnvironment` in backend.ts (so it
 * depends on the data stack). Without co-locating it in the data stack,
 * CloudFormation fails with a circular dependency between nested stacks.
 * Removing this line will break `ampx sandbox` — it is not decoration.
 */
export const publishArticle = defineFunction({
  name: 'publish-article',
  entry: './handler.ts',
  // The documented default is a stale Node 18; Lambda has deprecated that
  // runtime and Amplify Hosting no longer supports it. Always pin explicitly.
  runtime: 22,
  timeoutSeconds: 30,
  memoryMB: 1024,
  resourceGroupName: 'data',
  environment: {
    POWERTOOLS_SERVICE_NAME: 'publish-article',
    POWERTOOLS_LOG_LEVEL: 'INFO',
  },
})
