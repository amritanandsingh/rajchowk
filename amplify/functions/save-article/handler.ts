import { randomUUID } from 'node:crypto'
import { Logger } from '@aws-lambda-powertools/logger'
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

import { parseArticleInput } from '../../../src/lib/domain/article'
import { statusOf, statusKeyFor } from '../../../src/lib/domain/article-status'
import { deriveSlug, withSuffix } from '../../../src/lib/domain/slug'
import type { Schema } from '../../data/resource'
import { amplifyItem, ddb, isConditionalCheckFailed, tableName } from '../shared/ddb'
import { callerFrom, isAdmin } from '../shared/identity'
import { CODE, fail, ok } from '../shared/result'

const logger = new Logger({ serviceName: 'save-article' })

type Result = Schema['saveArticle']['returnType']

/**
 * Create or update an article's editor-authored content.
 *
 * This is the ONLY path that can write an Article row's content, because
 * amplify/data/resource.ts deletes the generated create/update/delete
 * mutations from the schema entirely. "The backend independently verifies
 * authorization before allowing article creation" is therefore not a check
 * that could be skipped — there is no unchecked path to skip it on.
 *
 * WHAT THIS HANDLER DOES NOT DO: it never touches `status`, `feedKey` or
 * `publishedAt` on an existing article. Publishing is a separate mutation with
 * its own transition rules (set-article-status). Keeping them apart is what
 * stops "save my typo fix" from silently republishing something an admin had
 * just pulled down.
 *
 * Id is caller-supplied and IS the idempotency key — see the create branch.
 */
export const handler: Schema['saveArticle']['functionHandler'] = async (event) => {
  const caller = callerFrom(event.identity)

  // Two independent guards, in this order. AppSync has already enforced
  // `allow.group('ADMIN')` on the field, so neither should ever fire; they are
  // the second of two checks, and the one that catches a mutation added to the
  // schema without its authorization rule.
  if (!caller) return fail(CODE.UNAUTHENTICATED) as Result
  if (!isAdmin(caller)) {
    // Logged because an authenticated non-admin reaching a write mutation is
    // worth knowing about. The sub is an opaque Cognito id, not PII.
    logger.warn('non-admin reached saveArticle', { actorSub: caller.sub })
    return fail(CODE.FORBIDDEN) as Result
  }

  const parsed = parseArticleInput({
    title: String(event.arguments.title ?? ''),
    summary: String(event.arguments.summary ?? ''),
    content: String(event.arguments.content ?? ''),
    slug: event.arguments.slug ?? null,
  })

  if (!parsed.ok) {
    // The per-field detail is not returned: the browser ran the same
    // `parseArticleInput` before submitting, so it already has it. Anything
    // that fails here and not there is a non-browser caller, which gets the
    // code alone.
    logger.info('validation rejected', { fields: parsed.errors.map((e) => e.field) })
    return fail(CODE.INVALID_INPUT) as Result
  }

  const { title, summary, content } = parsed.value
  const ARTICLE_TABLE = tableName('ARTICLE_TABLE_NAME')

  // Absent id means a non-browser caller; the browser always sends one.
  const articleId = String(event.arguments.id ?? '') || randomUUID()
  const now = new Date().toISOString()

  logger.appendKeys({ actorSub: caller.sub, articleId })

  try {
    const existing = (
      await ddb.send(new GetCommand({ TableName: ARTICLE_TABLE, Key: { id: articleId } }))
    ).Item

    /* ===================================================================
     * UPDATE — the article exists.
     *
     * Only content fields move. Status, feedKey, publishedAt and authorship
     * are all left exactly as they were, which is why an edit to a published
     * article stays published and keeps its original publication date.
     * =================================================================== */
    if (existing) {
      // The slug is NOT recomputed from the title on update. A slug is a
      // permanent public URL: silently changing it because someone fixed a
      // typo in the headline would break every inbound link and every
      // citation, with no redirect to catch them. Changing it requires
      // explicitly typing a new one.
      const requestedSlug = parsed.value.slug
      const currentSlug = String(existing.slug ?? '')
      const slug =
        requestedSlug && requestedSlug !== currentSlug
          ? await resolveUniqueSlug(ARTICLE_TABLE, requestedSlug, articleId)
          : currentSlug

      await ddb.send(
        new UpdateCommand({
          TableName: ARTICLE_TABLE,
          Key: { id: articleId },
          UpdateExpression:
            'SET title = :title, summary = :summary, content = :content, ' +
            'slug = :slug, updatedAt = :now',
          // Guards against the row being deleted between the Get above and
          // this write. Without it, an UpdateItem would happily resurrect it
          // as a partial row with no status and no author.
          ConditionExpression: 'attribute_exists(id)',
          ExpressionAttributeValues: {
            ':title': title,
            ':summary': summary,
            ':content': content,
            ':slug': slug,
            ':now': now,
          },
        }),
      )

      const status = statusOf(existing.status)
      logger.info('article updated', { status })
      return ok({ id: articleId, slug, status }) as Result
    }

    /* ===================================================================
     * CREATE — idempotent by construction.
     *
     * The browser generates one UUIDv4 per form mount and sends it as `id`,
     * so a double-clicked submit sends the SAME id twice. The second Put
     * fails `attribute_not_exists(id)` and is caught below as DUPLICATE,
     * which the UI treats as success. That is the whole "prevent duplicate
     * article creation caused by repeated clicks" requirement, enforced at
     * the database rather than by hoping a disabled button was fast enough.
     * =================================================================== */
    const slug = await resolveUniqueSlug(
      ARTICLE_TABLE,
      deriveSlug({ explicitSlug: parsed.value.slug, title, articleId }),
      articleId,
    )

    await ddb.send(
      new PutCommand({
        TableName: ARTICLE_TABLE,
        Item: amplifyItem('Article', {
          id: articleId,
          title,
          summary,
          content,
          slug,
          // A new article is always a draft. `feedKey` is deliberately ABSENT
          // rather than null — an attribute set to null still exists in the
          // index, which would put a draft into the sparse public feed index.
          status: 'DRAFT',
          statusKey: statusKeyFor('DRAFT'),
          // Byline from the verified claim. A client-supplied author would be
          // trivial impersonation.
          authorName: caller.displayName,
          authorSub: caller.sub,
          createdAt: now,
          updatedAt: now,
        }),
        ConditionExpression: 'attribute_not_exists(id)',
      }),
    )

    logger.info('article created', { slug })
    return ok({ id: articleId, slug, status: 'DRAFT' }) as Result
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      // The idempotent-retry path. Re-read so the caller gets the real slug of
      // the article that already exists rather than the one this invocation
      // would have chosen — they can differ if the first write took a
      // collision suffix.
      const settled = (
        await ddb.send(new GetCommand({ TableName: ARTICLE_TABLE, Key: { id: articleId } }))
      ).Item

      if (settled) {
        logger.info('duplicate submit collapsed')
        return ok({
          id: articleId,
          slug: String(settled.slug ?? ''),
          status: statusOf(settled.status),
          code: CODE.DUPLICATE,
        }) as Result
      }
      // The condition failed but the row is gone: it was deleted between the
      // write and this read. Genuinely a conflict, not a duplicate.
      return fail(CODE.CONFLICT) as Result
    }

    // Message only, never the full error object: an SDK error carries request
    // metadata and sometimes fragments of the item, and this line goes to
    // CloudWatch. Nothing about it reaches the browser.
    logger.error('save failed', { reason: error instanceof Error ? error.message : 'unknown' })
    return fail(CODE.INTERNAL) as Result
  }
}

/** How many suffixed slugs to try before giving up and using the id. */
const MAX_SLUG_ATTEMPTS = 5

/**
 * Find a slug not already taken by a DIFFERENT article.
 *
 * Queries `articlesBySlug` rather than scanning. The `selfId` comparison is
 * what lets an update keep its own slug — without it, saving an article twice
 * would see its own row as a collision and append "-2" on every save.
 *
 * This is a best-effort uniqueness check, not a lock: two articles created in
 * the same instant with the same headline could both pass. The consequence is
 * two rows sharing a slug, where the article page returns whichever the index
 * yields first. A conditional write on a slug-keyed table would close it, and
 * would cost a second table and a transaction for a race that needs two
 * editors typing the same headline within milliseconds. Documented rather than
 * built.
 */
async function resolveUniqueSlug(table: string, desired: string, selfId: string): Promise<string> {
  for (let attempt = 0; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? desired : withSuffix(desired, attempt + 1)

    const result = await ddb.send(
      new QueryCommand({
        TableName: table,
        IndexName: 'articlesBySlug',
        KeyConditionExpression: 'slug = :slug',
        ExpressionAttributeValues: { ':slug': candidate },
        // Only the id is needed to answer "is this taken by someone else".
        ProjectionExpression: 'id',
        Limit: 2,
      }),
    )

    const clash = (result.Items ?? []).some((item) => String(item.id) !== selfId)
    if (!clash) return candidate
  }

  // Every suffix was taken, which in practice means something is wrong.
  // Falling back to the id guarantees a unique, valid, permanent URL rather
  // than failing the save and losing the editor's work.
  return `${desired.slice(0, 60).replace(/-+$/g, '')}-${selfId.replace(/-/g, '').slice(0, 8)}`
}
