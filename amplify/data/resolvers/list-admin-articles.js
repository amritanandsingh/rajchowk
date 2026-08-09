import { util } from '@aws-appsync/utils'

/**
 * The admin article list — drafts and published, newest-edited first.
 *
 * APPSYNC_JS: uploaded verbatim, so no imports beyond '@aws-appsync/utils',
 * no async/await, no try/catch, no throw (use util.error), no new Date().
 *
 * WHY THIS EXISTS AT ALL. Amplify's generated `Article.list()` is a table
 * Scan: it reads every row and every attribute — including `content`, the
 * whole Markdown body of every article — then discards most of it. At any real
 * article count that is slow, expensive, and subject to the 1 MB page cap that
 * silently truncates the list. This is a Query on a sorted index with a
 * projection that excludes `content` entirely.
 *
 * AUTHORIZATION is the `allow.group('ADMIN')` rule on the query field in
 * amplify/data/resource.ts, evaluated by AppSync against the verified
 * `cognito:groups` claim before this code runs. There is no identity check
 * here because there is nothing useful this resolver could add: it cannot see
 * a token, and a JS resolver cannot be reached by a principal the field rule
 * did not already admit.
 */

const MAX_LIMIT = 50
const DEFAULT_LIMIT = 25
const ALLOWED_STATUSES = ['DRAFT', 'PUBLISHED']

export function request(ctx) {
  const args = ctx.args || {}

  let limit = args.limit === null || args.limit === undefined ? DEFAULT_LIMIT : args.limit
  if (limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT

  // An allow-list, not a passthrough: `statusKey` is a partition key, and an
  // unvalidated argument reaching one is how a caller reaches a partition
  // nobody intended. Anything unrecognised is rejected rather than defaulted,
  // because silently listing DRAFTs when the caller asked for something else
  // is the kind of surprise that ends up in a screenshot.
  const status = args.status
  if (ALLOWED_STATUSES.indexOf(status) < 0) {
    util.error('status must be DRAFT or PUBLISHED', 'BadRequest')
  }

  return {
    operation: 'Query',
    index: 'articlesByStatusKeyAndUpdatedAt',
    query: {
      expression: '#pk = :pk',
      expressionNames: { '#pk': 'statusKey' },
      expressionValues: util.dynamodb.toMapValues({ ':pk': status }),
    },
    // Most-recently-edited first: an editor's working set is what they touched
    // last, not what they created first.
    scanIndexForward: false,
    limit: limit,
    nextToken: args.nextToken,
    consistentRead: false,
  }
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type)

  const result = ctx.result || {}
  const items = result.items || []
  const out = []

  for (const item of items) {
    out.push({
      id: item.id,
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      // A row whose status attribute is somehow absent is a DRAFT. That is the
      // safe reading everywhere in this codebase: absent status never means
      // public. See the same inference in the set-article-status handler.
      status: item.status || 'DRAFT',
      authorName: item.authorName,
      publishedAt: item.publishedAt,
      updatedAt: item.updatedAt,
    })
  }

  return { items: out, nextToken: result.nextToken || null }
}
