import { randomUUID } from 'node:crypto'
import { PutCommand } from '@aws-sdk/lib-dynamodb'
import { amplifyItem, ddb, tableName } from './ddb'
import type { Caller } from './identity'

/**
 * Append-only audit trail for privileged operations.
 *
 * Two design rules:
 *
 *  1. Audit writes are BEST EFFORT and never fail the user-facing operation.
 *     An audit outage must not block moderation or publishing; a moderator
 *     who cannot act because a log write failed is a worse outcome than a
 *     missing log line. The failure is logged and alarms via the Lambda error
 *     metric filter.
 *
 *  2. Never log content bodies. `beforeJson`/`afterJson` carry field names and
 *     status transitions, not comment text or article prose — an audit table
 *     is not an appropriate place to duplicate user content, and it would put
 *     PII somewhere with a different retention policy.
 */

export type AuditEntry = {
  action: string
  caller: Caller
  targetType?: string
  targetId?: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  reason?: string
  ipHash?: string
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const at = new Date().toISOString()
    await ddb.send(
      new PutCommand({
        TableName: tableName('AUDIT_LOG_TABLE_NAME'),
        Item: amplifyItem(
          'AuditLog',
          {
            id: randomUUID(),
            action: entry.action,
            actorSub: entry.caller.sub,
            actorUsername: entry.caller.username,
            actorGroups: entry.caller.groups,
            targetType: entry.targetType,
            targetId: entry.targetId,
            beforeJson: entry.before ? JSON.stringify(entry.before) : undefined,
            afterJson: entry.after ? JSON.stringify(entry.after) : undefined,
            reason: entry.reason,
            sourceIpHash: entry.ipHash,
            at,
          },
          at,
        ),
      }),
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'audit write failed (swallowed)',
        action: entry.action,
        targetId: entry.targetId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  }
}
