import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

/**
 * Shared DynamoDB document client.
 *
 * Declared at module scope so the client and its connection pool survive warm
 * invocations — recreating it per request adds tens of milliseconds and a TLS
 * handshake to every call.
 */
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
})

/**
 * Attributes that Amplify's AppSync resolvers write onto every item and that
 * reads through GraphQL depend on.
 *
 * `__typename` is the one that bites: a raw-SDK PutItem that omits it stores
 * perfectly happily, and then AppSync cannot resolve the item's type, so
 * `client.models.X.get()` returns a broken or null row. Every raw-SDK write in
 * this codebase MUST go through `amplifyItem` or `amplifySetExpression`.
 *
 * Gen 2 does not enable conflict resolution, so `_version`/`_lastChangedAt`/
 * `_deleted` should NOT be present. That is asserted against the real deployed
 * table by tests/integration/item-shape.test.ts rather than assumed here.
 */
export type AmplifyMeta = {
  __typename: string
  createdAt: string
  updatedAt: string
}

/** Wrap a raw item with the attributes Amplify's read path requires. */
export function amplifyItem<T extends Record<string, unknown>>(
  typename: string,
  item: T,
  now: string = new Date().toISOString(),
): T & AmplifyMeta {
  return { ...item, __typename: typename, createdAt: now, updatedAt: now }
}

/** Table names, read from the environment wired up in backend.ts. */
export function tableName(envVar: string): string {
  const value = process.env[envVar]
  if (!value) throw new Error(`${envVar} is not set — check the grant in amplify/backend.ts`)
  return value
}

/**
 * True when a DynamoDB error is a failed conditional write.
 *
 * The idempotency of every vote, upvote and subscription in this system turns
 * on recognising this correctly.
 */
export function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException'
}

export function isTransactionCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'TransactionCanceledException'
}

/**
 * Positional cancellation reasons from a failed TransactWriteItems.
 *
 * `CancellationReasons[i]` lines up with `TransactItems[i]`, which is how a
 * handler tells "already voted" (item 0 failed) from "poll closed"
 * (item 2 failed).
 */
export function cancellationCodes(error: unknown): string[] {
  if (!isTransactionCancelled(error)) return []
  const reasons = (error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons
  return (reasons ?? []).map((reason) => reason?.Code ?? 'None')
}

export function cancelledAt(error: unknown, index: number): boolean {
  return cancellationCodes(error)[index] === 'ConditionalCheckFailed'
}
