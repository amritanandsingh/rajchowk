import { Logger } from '@aws-lambda-powertools/logger'
import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Schema } from '../../data/resource'
import { writeAudit } from '../shared/audit'
import {
  cancelledAt,
  ddb,
  isConditionalCheckFailed,
  isTransactionCancelled,
  tableName,
} from '../shared/ddb'
import { hashIp } from '../shared/hash'
import { callerFrom, isModerator } from '../shared/identity'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger()

type Result = Schema['moderateContent']['returnType']

/**
 * Comment moderation transitions.
 *
 * `threadKey` is the mechanism, not a flag. The public resolver Queries the
 * sparse `commentsByThreadKeyAndCreatedAt` GSI, so REMOVING the attribute
 * takes the row out of the index entirely — a hidden comment is absent from
 * the index, not filtered out of it. That is materially stronger than a filter
 * expression, which one forgotten `.filter()` away becomes a leak.
 */
const COMMENT_TRANSITIONS: Record<
  string,
  { from: string[]; to: string; delta: -1 | 0 | 1; setThreadKey: boolean }
> = {
  APPROVE: {
    from: ['PENDING', 'REJECTED', 'HIDDEN'],
    to: 'APPROVED',
    delta: 1,
    setThreadKey: true,
  },
  REJECT: { from: ['PENDING', 'APPROVED'], to: 'REJECTED', delta: -1, setThreadKey: false },
  HIDE: { from: ['APPROVED'], to: 'HIDDEN', delta: -1, setThreadKey: false },
  UNHIDE: { from: ['HIDDEN'], to: 'APPROVED', delta: 1, setThreadKey: true },
  DELETE: {
    from: ['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN'],
    to: 'DELETED',
    delta: -1,
    setThreadKey: false,
  },
}

const QUESTION_TRANSITIONS: Record<string, { from: string[]; to: string; setQueueKey: boolean }> = {
  APPROVE: { from: ['PENDING_REVIEW', 'REJECTED'], to: 'APPROVED', setQueueKey: true },
  REJECT: { from: ['PENDING_REVIEW', 'APPROVED', 'PLANNED'], to: 'REJECTED', setQueueKey: false },
  HIDE: { from: ['APPROVED', 'PLANNED', 'ANSWERED'], to: 'ARCHIVED', setQueueKey: false },
  UNHIDE: { from: ['ARCHIVED', 'REJECTED'], to: 'APPROVED', setQueueKey: true },
  DELETE: {
    from: ['PENDING_REVIEW', 'APPROVED', 'PLANNED', 'ANSWERED', 'ARCHIVED', 'REJECTED'],
    to: 'ARCHIVED',
    setQueueKey: false,
  },
}

export const handler: Schema['moderateContent']['functionHandler'] = async (event) => {
  const caller = callerFrom(event.identity)

  // Defence in depth. The @auth directive on this mutation already restricts
  // it to the moderator groups; this second check makes the Lambda safe if it
  // is ever re-wired to another operation or invoked directly.
  if (!caller) return fail(CODE.UNAUTHENTICATED) as Result
  if (!isModerator(caller)) {
    logger.warn('non-moderator reached moderateContent', { groups: caller.groups })
    return fail(CODE.FORBIDDEN) as Result
  }

  const targetType = String(event.arguments.targetType ?? '')
  const targetId = String(event.arguments.targetId ?? '')
  const action = String(event.arguments.action ?? '')
  const reason = event.arguments.reason?.trim().slice(0, 500) || undefined

  logger.appendKeys({ actorSub: caller.sub, targetType, targetId, action })

  const ipSalt = process.env.RATE_LIMIT_IP_SALT
  const ipHash = caller.sourceIp && ipSalt ? hashIp(caller.sourceIp, ipSalt) : undefined
  const now = new Date().toISOString()

  if (targetType === 'COMMENT') {
    return moderateComment({ caller, targetId, action, reason, ipHash, now })
  }
  if (targetType === 'QUESTION') {
    return moderateQuestion({ caller, targetId, action, reason, ipHash, now })
  }
  if (targetType === 'REPORT' && action === 'DISMISS_REPORT') {
    return dismissReport({ caller, targetId, reason, ipHash, now })
  }

  return fail(CODE.INVALID_INPUT) as Result
}

type Args = {
  caller: NonNullable<ReturnType<typeof callerFrom>>
  targetId: string
  action: string
  reason: string | undefined
  ipHash: string | undefined
  now: string
}

async function moderateComment(args: Args): Promise<Result> {
  const transition = COMMENT_TRANSITIONS[args.action]
  if (!transition) return fail(CODE.INVALID_INPUT) as Result

  const COMMENT_TABLE = tableName('COMMENT_TABLE_NAME')
  const ARTICLE_TABLE = tableName('ARTICLE_TABLE_NAME')

  const comment = (
    await ddb.send(
      new GetCommand({
        TableName: COMMENT_TABLE,
        Key: { id: args.targetId },
        ProjectionExpression: '#status, articleId',
        ExpressionAttributeNames: { '#status': 'status' },
      }),
    )
  ).Item

  if (!comment) return fail(CODE.NOT_FOUND) as Result

  // Absent status means the row predates moderation: treat as PENDING.
  const previousStatus = comment.status ? String(comment.status) : 'PENDING'
  if (!transition.from.includes(previousStatus)) return fail(CODE.CONFLICT) as Result

  const articleId = String(comment.articleId)
  const wasVisible = previousStatus === 'APPROVED'
  const willBeVisible = transition.to === 'APPROVED'
  // Only move the article counter when visibility actually changes.
  const delta = willBeVisible === wasVisible ? 0 : willBeVisible ? 1 : -1

  const setThreadKey = transition.setThreadKey ? ', threadKey = :threadKey' : ' REMOVE threadKey'

  const items: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']> =
    [
      {
        Update: {
          TableName: COMMENT_TABLE,
          Key: { id: args.targetId },
          UpdateExpression:
            'SET #status = :next, moderatedBySub = :actor, moderatedAt = :now, updatedAt = :now' +
            (args.reason === undefined ? '' : ', moderationNote = :reason') +
            (args.action === 'DELETE' ? ', content = :blank' : '') +
            setThreadKey,
          // The condition makes the transition atomic: two moderators acting at
          // the same instant cannot both succeed.
          ConditionExpression: '#status = :previous',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':next': transition.to,
            ':previous': previousStatus,
            ':actor': args.caller.sub,
            ':now': args.now,
            ...(transition.setThreadKey ? { ':threadKey': `${articleId}#APPROVED` } : {}),
            ...(args.reason === undefined ? {} : { ':reason': args.reason }),
            ...(args.action === 'DELETE' ? { ':blank': '' } : {}),
          },
        },
      },
    ]

  if (delta !== 0) {
    items.push({
      Update: {
        TableName: ARTICLE_TABLE,
        Key: { id: articleId },
        UpdateExpression:
          delta > 0
            ? 'SET commentCount = if_not_exists(commentCount, :zero) + :one, updatedAt = :now'
            : 'SET commentCount = if_not_exists(commentCount, :zero) - :one, updatedAt = :now',
        ConditionExpression:
          delta > 0 ? 'attribute_exists(id)' : 'attribute_exists(id) AND commentCount > :zero',
        ExpressionAttributeValues: { ':zero': 0, ':one': 1, ':now': args.now },
      },
    })
  }

  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: items }))
  } catch (error) {
    if (isTransactionCancelled(error) && cancelledAt(error, 0)) {
      // Someone else moved it first.
      return fail(CODE.CONFLICT) as Result
    }
    if (isTransactionCancelled(error) && cancelledAt(error, 1)) {
      logger.warn('comment counter guard tripped; status not changed')
      return fail(CODE.CONFLICT) as Result
    }
    logger.error('comment moderation failed', { error: error as Error })
    throw error
  }

  await writeAudit({
    action: `COMMENT_${args.action === 'UNHIDE' ? 'APPROVE' : args.action}`,
    caller: args.caller,
    targetType: 'COMMENT',
    targetId: args.targetId,
    before: { status: previousStatus },
    after: { status: transition.to },
    ...(args.reason === undefined ? {} : { reason: args.reason }),
    ...(args.ipHash === undefined ? {} : { ipHash: args.ipHash }),
  })

  logger.info('comment moderated', { from: previousStatus, to: transition.to })
  return ok({ targetId: args.targetId, newStatus: transition.to }) as Result
}

async function moderateQuestion(args: Args): Promise<Result> {
  const transition = QUESTION_TRANSITIONS[args.action]
  if (!transition) return fail(CODE.INVALID_INPUT) as Result

  const QUESTION_TABLE = tableName('AUDIENCE_QUESTION_TABLE_NAME')

  const question = (
    await ddb.send(
      new GetCommand({
        TableName: QUESTION_TABLE,
        Key: { id: args.targetId },
        ProjectionExpression: '#status, liveEventId, articleId',
        ExpressionAttributeNames: { '#status': 'status' },
      }),
    )
  ).Item

  if (!question) return fail(CODE.NOT_FOUND) as Result

  const previousStatus = question.status ? String(question.status) : 'PENDING_REVIEW'
  if (!transition.from.includes(previousStatus)) return fail(CODE.CONFLICT) as Result

  // Questions are grouped into queues: one per live event, one global board.
  const scope = question.liveEventId ? `EVENT#${question.liveEventId}` : 'GLOBAL'

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: QUESTION_TABLE,
        Key: { id: args.targetId },
        UpdateExpression:
          'SET #status = :next, updatedAt = :now' +
          (args.reason === undefined ? '' : ', moderationNote = :reason') +
          (transition.setQueueKey ? ', queueKey = :queueKey' : ' REMOVE queueKey'),
        ConditionExpression: '#status = :previous',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':next': transition.to,
          ':previous': previousStatus,
          ':now': args.now,
          ...(transition.setQueueKey ? { ':queueKey': `${scope}#APPROVED` } : {}),
          ...(args.reason === undefined ? {} : { ':reason': args.reason }),
        },
      }),
    )
  } catch (error) {
    if (isConditionalCheckFailed(error)) return fail(CODE.CONFLICT) as Result
    logger.error('question moderation failed', { error: error as Error })
    throw error
  }

  await writeAudit({
    action: transition.to === 'APPROVED' ? 'QUESTION_APPROVE' : 'QUESTION_REJECT',
    caller: args.caller,
    targetType: 'QUESTION',
    targetId: args.targetId,
    before: { status: previousStatus },
    after: { status: transition.to },
    ...(args.reason === undefined ? {} : { reason: args.reason }),
    ...(args.ipHash === undefined ? {} : { ipHash: args.ipHash }),
  })

  logger.info('question moderated', { from: previousStatus, to: transition.to })
  return ok({ targetId: args.targetId, newStatus: transition.to }) as Result
}

async function dismissReport(args: Omit<Args, 'action'>): Promise<Result> {
  const REPORT_TABLE = tableName('CONTENT_REPORT_TABLE_NAME')

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: REPORT_TABLE,
        Key: { id: args.targetId },
        UpdateExpression:
          'SET #status = :next, reviewedBySub = :actor, reviewedAt = :now, updatedAt = :now' +
          (args.reason === undefined ? '' : ', resolutionNote = :reason'),
        ConditionExpression: '#status IN (:open, :underReview)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':next': 'DISMISSED',
          ':actor': args.caller.sub,
          ':now': args.now,
          ':open': 'OPEN',
          ':underReview': 'UNDER_REVIEW',
          ...(args.reason === undefined ? {} : { ':reason': args.reason }),
        },
      }),
    )
  } catch (error) {
    if (isConditionalCheckFailed(error)) return fail(CODE.CONFLICT) as Result
    throw error
  }

  await writeAudit({
    action: 'REPORT_ACTIONED',
    caller: args.caller,
    targetType: 'REPORT',
    targetId: args.targetId,
    after: { status: 'DISMISSED' },
    ...(args.reason === undefined ? {} : { reason: args.reason }),
    ...(args.ipHash === undefined ? {} : { ipHash: args.ipHash }),
  })

  return ok({ targetId: args.targetId, newStatus: 'DISMISSED' }) as Result
}
