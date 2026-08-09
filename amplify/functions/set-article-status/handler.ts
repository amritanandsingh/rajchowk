import { Logger } from '@aws-lambda-powertools/logger'
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

import {
  checkTransition,
  feedKeyFor,
  statusKeyFor,
  statusOf,
} from '../../../src/lib/domain/article-status'
import type { Schema } from '../../data/resource'
import { ddb, isConditionalCheckFailed, tableName } from '../shared/ddb'
import { callerFrom, isAdmin } from '../shared/identity'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger({ serviceName: 'set-article-status' })

type Result = Schema['setArticleStatus']['returnType']

/**
 * Publish or unpublish an article.
 *
 * This handler is the reason `status` can be trusted. The field is
 * Lambda-owned — `.to(['read'])` in amplify/data/resource.ts means no GraphQL
 * mutation can write it — and this function, holding scoped table IAM, is the
 * only code that ever does. That is what makes it safe for the public feed
 * resolver to gate on.
 *
 * The single write below moves four attributes at once (`status`, `feedKey`,
 * `statusKey`, `publishedAt`) and that atomicity is the point: any interleaving
 * that could leave `status = PUBLISHED` without a matching `feedKey`, or the
 * reverse, would produce an article that is published but invisible, or
 * unpublished but still in the feed.
 */
export const handler: Schema['setArticleStatus']['functionHandler'] = async (event) => {
  const caller = callerFrom(event.identity)
  if (!caller) return fail(CODE.UNAUTHENTICATED) as Result
  if (!isAdmin(caller)) {
    logger.warn('non-admin reached setArticleStatus', { actorSub: caller.sub })
    return fail(CODE.FORBIDDEN) as Result
  }

  const articleId = String(event.arguments.articleId ?? '')
  const action = String(event.arguments.action ?? '')

  logger.appendKeys({ actorSub: caller.sub, articleId, action })

  if (!articleId) return fail(CODE.INVALID_INPUT) as Result

  const ARTICLE_TABLE = tableName('ARTICLE_TABLE_NAME')

  try {
    const article = (
      await ddb.send(new GetCommand({ TableName: ARTICLE_TABLE, Key: { id: articleId } }))
    ).Item

    if (!article) return fail(CODE.NOT_FOUND) as Result

    const currentStatus = statusOf(article.status)

    /**
     * Whether that DRAFT was READ or INFERRED.
     *
     * A row created by save-article always has an explicit status, but a row
     * that predates a schema change might not. The two cases need different
     * DynamoDB conditions below: `#status = :expected` never matches a missing
     * attribute, so guarding an inferred DRAFT that way would make publishing
     * it impossible — the write would fail forever with a conflict nobody
     * could explain.
     */
    const statusWasAbsent = article.status === undefined || article.status === null

    const transition = checkTransition(currentStatus, action)
    if (!transition.allowed) {
      logger.warn('transition refused', { reason: transition.reason, from: currentStatus })
      return fail(
        transition.reason === 'UNKNOWN_ACTION' ? CODE.INVALID_INPUT : CODE.CONFLICT,
      ) as Result
    }

    const nextStatus = transition.to
    const now = new Date().toISOString()
    const nextFeedKey = feedKeyFor(nextStatus)

    // Preserve the original publication time across an unpublish/republish
    // cycle. Resetting it would reorder the feed and rewrite history — an
    // article corrected a week after publication should keep its date.
    const publishedAt =
      nextStatus === 'PUBLISHED'
        ? typeof article.publishedAt === 'string' && article.publishedAt
          ? article.publishedAt
          : now
        : article.publishedAt

    const setClauses = ['#status = :next', 'statusKey = :statusKey', 'updatedAt = :now']
    const removeClauses: string[] = []
    const values: Record<string, unknown> = {
      ':next': nextStatus,
      ':statusKey': statusKeyFor(nextStatus),
      ':now': now,
    }

    if (nextFeedKey === null) {
      // REMOVE, not "set to null". The public feed index is SPARSE: an
      // attribute set to null still exists, so the item would stay in
      // articlesByFeedKeyAndPublishedAt and an unpublished article would keep
      // appearing in the feed, held back only by the redundant status filter.
      removeClauses.push('feedKey')
    } else {
      setClauses.push('feedKey = :feedKey')
      values[':feedKey'] = nextFeedKey
    }

    if (publishedAt) {
      setClauses.push('publishedAt = :publishedAt')
      values[':publishedAt'] = publishedAt
    }

    /**
     * Guarded on the CURRENT status, so two admins acting at once cannot both
     * win. The loser's ConditionExpression fails and they get CONFLICT rather
     * than silently overwriting a decision they never saw.
     *
     * The two branches exist because of `statusWasAbsent` above — comparing an
     * attribute that does not exist never matches, so an inferred DRAFT is
     * guarded on its absence instead.
     */
    const condition = statusWasAbsent
      ? 'attribute_exists(id) AND attribute_not_exists(#status)'
      : 'attribute_exists(id) AND #status = :expected'
    if (!statusWasAbsent) values[':expected'] = currentStatus

    await ddb.send(
      new UpdateCommand({
        TableName: ARTICLE_TABLE,
        Key: { id: articleId },
        UpdateExpression:
          `SET ${setClauses.join(', ')}` +
          (removeClauses.length > 0 ? ` REMOVE ${removeClauses.join(', ')}` : ''),
        ConditionExpression: condition,
        // `status` is a DynamoDB reserved word and cannot appear unaliased.
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: values,
      }),
    )

    logger.info('status changed', { from: currentStatus, to: nextStatus })
    return ok({ id: articleId, slug: String(article.slug ?? ''), status: nextStatus }) as Result
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      // Someone else moved it between the read and the write.
      logger.warn('lost a concurrent status change')
      return fail(CODE.CONFLICT) as Result
    }
    logger.error('status change failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    })
    return fail(CODE.INTERNAL) as Result
  }
}
