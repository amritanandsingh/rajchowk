import { defineFunction } from '@aws-amplify/backend'

/**
 * Accepts a reader comment into the moderation queue.
 *
 * Comments are stored as PLAIN TEXT — never markdown, never HTML — which
 * removes the UGC XSS surface by construction rather than by filtering.
 *
 * `resourceGroupName: 'data'` is REQUIRED and load-bearing. This function is
 * both a custom-operation handler (so the data stack depends on it) and a
 * consumer of data table names via `addEnvironment` in backend.ts (so it
 * depends on the data stack). Without co-locating it in the data stack,
 * CloudFormation fails with a circular dependency between nested stacks.
 * Removing this line will break `ampx sandbox` — it is not decoration.
 */
export const submitComment = defineFunction({
  name: 'submit-comment',
  entry: './handler.ts',
  // The documented default is a stale Node 18; Lambda has deprecated that
  // runtime and Amplify Hosting no longer supports it. Always pin explicitly.
  runtime: 22,
  timeoutSeconds: 15,
  memoryMB: 512,
  resourceGroupName: 'data',
  environment: {
    POWERTOOLS_SERVICE_NAME: 'submit-comment',
    POWERTOOLS_LOG_LEVEL: 'INFO',
  },
})
