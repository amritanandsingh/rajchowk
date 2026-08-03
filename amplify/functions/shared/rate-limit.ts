import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { hashIp } from './hash'

/**
 * Fixed-window rate limiting on a plain DynamoDB table.
 *
 * Why a plain CDK table and not an Amplify model: this is written on EVERY
 * request including rejected ones, it needs a TTL, and it must never appear in
 * the GraphQL schema. Making it a model would add a `listRateLimits` field to
 * the API and force `__typename`/`createdAt`/`updatedAt` onto the hottest
 * write in the system.
 *
 * Why fixed window and not a token bucket: a token bucket needs
 * `tokens = min(cap, tokens + elapsed*rate) - 1`, which DynamoDB cannot
 * express atomically without a read-then-write race. A fixed window is one
 * conditional UpdateItem — 1 WCU, no read, no race. Two tiers (burst and
 * sustained) approximate a bucket closely enough, and the worst failure mode
 * (a caller getting up to 2x the limit across a window boundary) does not
 * matter at these thresholds.
 */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

export type RateLimitRule = {
  /** Namespaces the counter, e.g. 'vote:burst'. */
  scope: string
  /** Who is being limited, e.g. `u_<sub>` or `ip_<hash>`. */
  subject: string
  limit: number
  windowSeconds: number
}

export type RateLimitOutcome = {
  allowed: boolean
  retryAfterSeconds: number
  scope?: string
}

type RateLimitConfig = { tableName: string; ipSalt: string }

function config(): RateLimitConfig {
  const tableName = process.env.RATE_LIMIT_TABLE_NAME
  const ipSalt = process.env.RATE_LIMIT_IP_SALT
  if (!tableName) throw new Error('RATE_LIMIT_TABLE_NAME is not set')
  if (!ipSalt) throw new Error('RATE_LIMIT_IP_SALT is not set')
  return { tableName, ipSalt }
}

/** Rate-limit subject for a caller: the Cognito sub when signed in, otherwise
 *  a salted hash of the IP. Never a raw IP. */
export function subjectFor(
  identity: { sub?: string; sourceIp?: string[] } | null | undefined,
): string {
  if (identity?.sub) return `u_${identity.sub}`
  const ip = identity?.sourceIp?.[0]
  return ip ? `ip_${hashIp(ip, config().ipSalt)}` : 'anon_unknown'
}

export function ipSubject(ip: string | undefined): string {
  return ip ? `ip_${hashIp(ip, config().ipSalt)}` : 'anon_unknown'
}

async function consume(rule: RateLimitRule): Promise<RateLimitOutcome> {
  const { tableName } = config()
  const nowSec = Math.floor(Date.now() / 1000)
  const windowStart = Math.floor(nowSec / rule.windowSeconds) * rule.windowSeconds
  // Two windows of TTL grace so a row cannot expire mid-window.
  const expiresAt = windowStart + rule.windowSeconds * 2
  const id = `${rule.scope}#${rule.subject}#${windowStart}`

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { id },
        // `ADD` fails on an absent/NULL attribute; if_not_exists is the safe form.
        UpdateExpression:
          'SET #count = if_not_exists(#count, :zero) + :one, ' +
          'expiresAt = if_not_exists(expiresAt, :expires)',
        ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: {
          ':zero': 0,
          ':one': 1,
          ':limit': rule.limit,
          ':expires': expiresAt,
        },
      }),
    )
    return { allowed: true, retryAfterSeconds: 0 }
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return {
        allowed: false,
        retryAfterSeconds: windowStart + rule.windowSeconds - nowSec,
        scope: rule.scope,
      }
    }

    // FAIL OPEN, deliberately. A DynamoDB blip must not take down commenting
    // or voting for everyone. The CloudWatch alarm on this table's errors is
    // what catches a real outage; silently rejecting all traffic would not.
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'rate limit check failed, allowing request',
        scope: rule.scope,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return { allowed: true, retryAfterSeconds: 0 }
  }
}

/**
 * Evaluate rules in order, short-circuiting on the first rejection.
 * Put the tightest (burst) rule first so a burst is rejected without spending
 * a write on the sustained counter.
 */
export async function enforceRateLimit(rules: RateLimitRule[]): Promise<RateLimitOutcome> {
  for (const rule of rules) {
    const outcome = await consume(rule)
    if (!outcome.allowed) return outcome
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

/**
 * Budgets, in one place so they can be reviewed together.
 *
 * submitComment limits on the user AND the IP because a comment-spam ring
 * runs many accounts from one host.
 */
export const RATE_LIMITS = {
  vote: (subject: string): RateLimitRule[] => [
    { scope: 'vote:burst', subject, limit: 10, windowSeconds: 60 },
    { scope: 'vote:hour', subject, limit: 40, windowSeconds: 3600 },
  ],
  upvote: (subject: string): RateLimitRule[] => [
    { scope: 'upvote:burst', subject, limit: 20, windowSeconds: 60 },
    { scope: 'upvote:hour', subject, limit: 200, windowSeconds: 3600 },
  ],
  comment: (userSubject: string, ipSubj: string): RateLimitRule[] => [
    { scope: 'comment:burst', subject: userSubject, limit: 3, windowSeconds: 300 },
    { scope: 'comment:day', subject: userSubject, limit: 30, windowSeconds: 86400 },
    { scope: 'comment:ip', subject: ipSubj, limit: 20, windowSeconds: 3600 },
  ],
  question: (subject: string): RateLimitRule[] => [
    { scope: 'question:burst', subject, limit: 2, windowSeconds: 600 },
    { scope: 'question:day', subject, limit: 10, windowSeconds: 86400 },
  ],
  report: (subject: string): RateLimitRule[] => [
    { scope: 'report:burst', subject, limit: 5, windowSeconds: 600 },
    { scope: 'report:day', subject, limit: 30, windowSeconds: 86400 },
  ],
  newsletter: (subject: string): RateLimitRule[] => [
    { scope: 'newsletter:hour', subject, limit: 3, windowSeconds: 3600 },
    { scope: 'newsletter:day', subject, limit: 10, windowSeconds: 86400 },
  ],
  search: (subject: string): RateLimitRule[] => [
    { scope: 'search:burst', subject, limit: 30, windowSeconds: 60 },
  ],
} as const
