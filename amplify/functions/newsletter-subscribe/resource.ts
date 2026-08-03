import { defineFunction } from '@aws-amplify/backend'

/**
 * Double opt-in newsletter subscription.
 *
 * Every code path returns an identical response, so the endpoint cannot be
 * used to test whether an address is already subscribed.
 *
 * `resourceGroupName: 'data'` is REQUIRED and load-bearing. This function is
 * both a custom-operation handler (so the data stack depends on it) and a
 * consumer of data table names via `addEnvironment` in backend.ts (so it
 * depends on the data stack). Without co-locating it in the data stack,
 * CloudFormation fails with a circular dependency between nested stacks.
 * Removing this line will break `ampx sandbox` — it is not decoration.
 */
export const newsletterSubscribe = defineFunction({
  name: 'newsletter-subscribe',
  entry: './handler.ts',
  // The documented default is a stale Node 18; Lambda has deprecated that
  // runtime and Amplify Hosting no longer supports it. Always pin explicitly.
  runtime: 22,
  timeoutSeconds: 20,
  memoryMB: 512,
  resourceGroupName: 'data',
  environment: {
    POWERTOOLS_SERVICE_NAME: 'newsletter-subscribe',
    POWERTOOLS_LOG_LEVEL: 'INFO',
    NEWSLETTER_TOKEN_TTL_HOURS: '24',
  },
})
