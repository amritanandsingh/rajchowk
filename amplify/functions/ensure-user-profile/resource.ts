import { defineFunction } from '@aws-amplify/backend'

/**
 * Creates a UserProfile on first authenticated call, keyed on the verified
 * Cognito sub.
 *
 * Deliberately NOT a post-confirmation trigger: that would make the auth
 * stack depend on the data stack and deadlock the deployment, and it would
 * also miss federated and admin-created users, who never fire
 * post-confirmation at all.
 *
 * `resourceGroupName: 'data'` is REQUIRED and load-bearing. This function is
 * both a custom-operation handler (so the data stack depends on it) and a
 * consumer of data table names via `addEnvironment` in backend.ts (so it
 * depends on the data stack). Without co-locating it in the data stack,
 * CloudFormation fails with a circular dependency between nested stacks.
 * Removing this line will break `ampx sandbox` — it is not decoration.
 */
export const ensureUserProfile = defineFunction({
  name: 'ensure-user-profile',
  entry: './handler.ts',
  // The documented default is a stale Node 18; Lambda has deprecated that
  // runtime and Amplify Hosting no longer supports it. Always pin explicitly.
  runtime: 22,
  timeoutSeconds: 10,
  memoryMB: 512,
  resourceGroupName: 'data',
  environment: {
    POWERTOOLS_SERVICE_NAME: 'ensure-user-profile',
    POWERTOOLS_LOG_LEVEL: 'INFO',
  },
})
