/**
 * The DynamoDB document client, shared by both write handlers.
 *
 * Module-scoped on purpose: the client is created once per Lambda container
 * and reused across invocations, so warm calls pay no connection or credential
 * cost. Constructing it inside the handler is the classic way to make a
 * function slower than it needs to be.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

const base = new DynamoDBClient({
  // Bounded, and low. A write handler behind a synchronous GraphQL mutation
  // has an editor waiting on it; three SDK retries on a 3-second timeout would
  // hold the request open past the point anyone is still watching. Failing
  // fast and letting the UI offer a retry is the better trade.
  maxAttempts: 3,
  requestHandler: { requestTimeout: 3_000 },
})

export const ddb = DynamoDBDocumentClient.from(base, {
  marshallOptions: {
    // Amplify writes optional fields as absent, not as null. Matching that
    // keeps items consistent with rows the GraphQL layer created and keeps
    // sparse-index semantics working — an attribute set to null still EXISTS
    // in the index, which would defeat the point of removing feedKey.
    removeUndefinedValues: true,
    convertClassInstanceToMap: false,
  },
  unmarshallOptions: { wrapNumbers: false },
})

/**
 * Read a table name from the environment, or fail loudly at first use.
 *
 * The name is injected by `grantTables()` in amplify/backend.ts. If that
 * wiring is ever removed, an undefined table name would otherwise reach the
 * SDK and surface as a confusing `ResourceNotFoundException` naming the string
 * "undefined". This turns a deployment mistake into a message that says which
 * variable is missing.
 */
export function tableName(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing environment variable ${key}. Check grantTables() in amplify/backend.ts`,
    )
  }
  return value
}

/**
 * Is this the "your ConditionExpression did not hold" error?
 *
 * Both write handlers depend on distinguishing it from a real failure:
 *   - save-article uses `attribute_not_exists(id)` for idempotency, so this
 *     means "already created", which is a SUCCESS path.
 *   - set-article-status guards on the current status, so this means "another
 *     admin got there first", which is a CONFLICT.
 * Neither is an internal error, and treating them as one would show an editor
 * a scary message for something entirely ordinary.
 */
export function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'ConditionalCheckFailedException'
  )
}

/**
 * Fields Amplify's own resolvers put on every row.
 *
 * A row written by a raw SDK PutItem that lacks `__typename` is invisible to
 * Amplify's GraphQL layer — `Article.get()` returns it with a null type and
 * the client discards it. Since the admin edit form reads through
 * `client.models.Article.get()`, omitting this makes articles that exist in
 * DynamoDB unreadable through the API that created them.
 */
export function amplifyItem<T extends Record<string, unknown>>(
  typename: string,
  item: T,
): T & { __typename: string } {
  return { ...item, __typename: typename }
}
