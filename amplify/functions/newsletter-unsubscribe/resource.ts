import { defineFunction } from '@aws-amplify/backend'

/**
 * One-click unsubscribe (RFC 8058).
 *
 * Stateless verification: the signature is recomputed rather than looked up,
 * which is what makes the POST fast enough for Gmail's bulk-sender rules.
 *
 * `resourceGroupName: 'data'` is REQUIRED and load-bearing. This function is
 * both a custom-operation handler (so the data stack depends on it) and a
 * consumer of data table names via `addEnvironment` in backend.ts (so it
 * depends on the data stack). Without co-locating it in the data stack,
 * CloudFormation fails with a circular dependency between nested stacks.
 * Removing this line will break `ampx sandbox` — it is not decoration.
 */
export const newsletterUnsubscribe = defineFunction({
  name: 'newsletter-unsubscribe',
  entry: './handler.ts',
  // The documented default is a stale Node 18; Lambda has deprecated that
  // runtime and Amplify Hosting no longer supports it. Always pin explicitly.
  runtime: 22,
  timeoutSeconds: 15,
  memoryMB: 512,
  resourceGroupName: 'data',
  environment: {
    POWERTOOLS_SERVICE_NAME: 'newsletter-unsubscribe',
    POWERTOOLS_LOG_LEVEL: 'INFO',
  },
})
