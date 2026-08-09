import { randomUUID } from 'node:crypto'
import { Logger } from '@aws-lambda-powertools/logger'
import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { Schema } from '../../data/resource'
import { amplifyItem, cancelledAt, ddb, isTransactionCancelled, tableName } from '../shared/ddb'
import { hashIp, sha256Hex } from '../shared/hash'
import { callerFrom } from '../shared/identity'
import { enforceRateLimit, ipSubject, RATE_LIMITS } from '../shared/rate-limit'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger()

type Result = Schema['submitComment']['returnType']

const MIN_LENGTH = 3
const MAX_LENGTH = 2000
/** Two levels only: a top-level comment and one reply to it. */
const MAX_DEPTH = 1
const MAX_URLS = 2
/** Reject an identical comment from the same author within this window. */
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000

const URL_PATTERN = /https?:\/\/\S+/gi

/**
 * Normalise plain-text comment content.
 *
 * Comments are stored as PLAIN TEXT. No markdown, no HTML, ever. The render
 * path emits a text node, so the entire UGC XSS surface is removed by
 * construction rather than by sanitising. This function only tidies
 * whitespace and enforces limits — it is not a security boundary, and must
 * not be mistaken for one.
 */
function normaliseContent(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') // control chars, keeping \t and \n
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .trim()
}

export const handler: Schema['submitComment']['functionHandler'] = async (event) => {
  const caller = callerFrom(event.identity)
  if (!caller) return fail(CODE.UNAUTHENTICATED) as Result

  const articleId = event.arguments.articleId
  const parentCommentId = event.arguments.parentCommentId ?? null
  const content = normaliseContent(event.arguments.content ?? '')

  logger.appendKeys({ articleId, userSub: caller.sub })

  if (content.length < MIN_LENGTH || content.length > MAX_LENGTH) {
    return fail(CODE.INVALID_INPUT) as Result
  }
  if ((content.match(URL_PATTERN) ?? []).length > MAX_URLS) {
    logger.info('comment rejected: too many links')
    return fail(CODE.INVALID_INPUT) as Result
  }

  const ipSalt = process.env.RATE_LIMIT_IP_SALT
  const ipHash = caller.sourceIp && ipSalt ? hashIp(caller.sourceIp, ipSalt) : undefined

  // Limit on the user AND the IP: a comment-spam ring runs many accounts from
  // a single host, so a per-user limit alone does not stop it.
  const limit = await enforceRateLimit(
    RATE_LIMITS.comment(`u_${caller.sub}`, ipSubject(caller.sourceIp)),
  )
  if (!limit.allowed) return fail(CODE.RATE_LIMITED) as Result

  const ARTICLE_TABLE = tableName('ARTICLE_TABLE_NAME')
  const COMMENT_TABLE = tableName('COMMENT_TABLE_NAME')
  const PROFILE_TABLE = tableName('USER_PROFILE_TABLE_NAME')

  const [articleResult, profileResult] = await Promise.all([
    ddb.send(
      new GetCommand({
        TableName: ARTICLE_TABLE,
        Key: { id: articleId },
        ProjectionExpression: '#status, allowComments',
        ExpressionAttributeNames: { '#status': 'status' },
      }),
    ),
    ddb.send(
      new GetCommand({
        TableName: PROFILE_TABLE,
        Key: { id: caller.sub },
        ProjectionExpression: 'displayName, isSuspended, suspendedUntil',
      }),
    ),
  ])

  const article = articleResult.Item
  const profile = profileResult.Item
  const now = new Date().toISOString()

  // Commenting on an unpublished article would confirm that it exists.
  if (!article || article.status !== 'PUBLISHED') return fail(CODE.NOT_FOUND) as Result
  if (article.allowComments === false) return fail(CODE.COMMENTS_CLOSED) as Result

  if (!profile) return fail(CODE.FORBIDDEN) as Result
  if (profile.isSuspended === true) {
    const until = typeof profile.suspendedUntil === 'string' ? profile.suspendedUntil : null
    if (!until || until > now) return fail(CODE.SUSPENDED) as Result
  }

  // ---- Depth: two levels maximum. ----------------------------------------
  let depth = 0
  if (parentCommentId) {
    const parent = (
      await ddb.send(
        new GetCommand({
          TableName: COMMENT_TABLE,
          Key: { id: parentCommentId },
          ProjectionExpression: 'articleId, depth, #status',
          ExpressionAttributeNames: { '#status': 'status' },
        }),
      )
    ).Item

    if (!parent) return fail(CODE.NOT_FOUND) as Result
    // Replying to a pending or hidden comment would reveal that it exists.
    if (parent.status !== 'APPROVED') return fail(CODE.NOT_FOUND) as Result
    // IDOR: the parent must belong to the article named in the request.
    if (parent.articleId !== articleId) return fail(CODE.INVALID_INPUT) as Result

    depth = Number(parent.depth ?? 0) + 1
    if (depth > MAX_DEPTH) return fail(CODE.DEPTH_EXCEEDED) as Result
  }

  // ---- Duplicate detection. ----------------------------------------------
  const contentHash = sha256Hex(`${articleId}#${caller.sub}#${content}`)
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString()
  const recent = await ddb.send(
    new QueryCommand({
      TableName: COMMENT_TABLE,
      IndexName: 'commentsByAuthorAndCreatedAt',
      KeyConditionExpression: 'authorProfileId = :author AND createdAt >= :since',
      FilterExpression: 'contentHash = :hash',
      ExpressionAttributeValues: { ':author': caller.sub, ':since': since, ':hash': contentHash },
      Limit: 25,
      Select: 'COUNT',
    }),
  )
  if ((recent.Count ?? 0) > 0) {
    logger.info('duplicate comment rejected')
    return fail(CODE.DUPLICATE) as Result
  }

  // ---- Write. Everything enters moderation as PENDING. -------------------
  // Note there is no threadKey: the public resolver Queries a sparse GSI on
  // that attribute, so a PENDING comment is ABSENT from the index rather than
  // filtered out of it. Approval is what adds the key.
  const commentId = randomUUID()

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: COMMENT_TABLE,
              Item: amplifyItem(
                'Comment',
                {
                  id: commentId,
                  articleId,
                  parentCommentId: parentCommentId ?? undefined,
                  authorProfileId: caller.sub,
                  authorDisplayName: String(profile.displayName ?? 'सदस्य'),
                  content,
                  depth,
                  status: 'PENDING',
                  reportCount: 0,
                  contentHash,
                  ipHash,
                },
                now,
              ),
              ConditionExpression: 'attribute_not_exists(#id)',
              ExpressionAttributeNames: { '#id': 'id' },
            },
          },
          {
            Update: {
              TableName: PROFILE_TABLE,
              Key: { id: caller.sub },
              UpdateExpression:
                'SET commentCount = if_not_exists(commentCount, :zero) + :one, updatedAt = :now',
              ConditionExpression: 'attribute_exists(id)',
              ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':now': now },
            },
          },
        ],
      }),
    )
  } catch (error) {
    if (isTransactionCancelled(error) && cancelledAt(error, 0)) {
      return fail(CODE.DUPLICATE) as Result
    }
    logger.error('comment write failed', { error: error as Error })
    throw error
  }

  logger.info('comment queued for moderation', { commentId, depth })
  return ok({ id: commentId, status: 'PENDING' }) as Result
}
