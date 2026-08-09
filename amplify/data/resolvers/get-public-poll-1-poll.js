import { util } from '@aws-appsync/utils'

/**
 * Public poll, stage 1: fetch and gate on status.
 *
 * APPSYNC_JS: uploaded verbatim, so no imports beyond '@aws-appsync/utils',
 * no async/await, no try/catch, no throw (use util.error), no new Date().
 */

const PUBLIC_STATUSES = ['OPEN', 'CLOSED']

export function request(ctx) {
  const pollId = ctx.args ? ctx.args.pollId : null
  if (!pollId) util.error('pollId is required', 'BadRequest')
  return { operation: 'GetItem', key: util.dynamodb.toMapValues({ id: pollId }) }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)

  const poll = ctx.result
  // A DRAFT or ARCHIVED poll is indistinguishable from a missing one.
  if (!poll || PUBLIC_STATUSES.indexOf(poll.status) < 0) {
    util.error('Poll not found', 'NotFound')
  }

  ctx.stash.poll = {
    id: poll.id,
    question: poll.question,
    description: poll.description,
    language: poll.language,
    status: poll.status,
    articleId: poll.articleId,
    totalVotes: poll.totalVotes || 0,
    allowVoteChange: poll.allowVoteChange === true,
    showResultsBeforeVoting: poll.showResultsBeforeVoting === true,
    requestExplanation: poll.requestExplanation === true,
    opensAt: poll.opensAt,
    closesAt: poll.closesAt,
    options: [],
  }

  return ctx.stash.poll
}
