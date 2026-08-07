import { beforeAll, describe, expect, it, inject } from 'vitest'
import { clientFor, expectOk, expectRefused, type Client } from './harness/clients'
import { counterOf, makeArticle, makeCategory, publishArticle } from './harness/fixtures'
import { getRow } from './harness/tables'
import type { Role, TestUser } from './harness/users'

/**
 * Publishing an article — against the real table, because that is the only
 * place the bug this pins can exist.
 *
 * A newly created Article has NO `status` attribute: the field is Lambda-owned,
 * so the create mutation cannot write it. The publish function compensated in
 * JavaScript (`article.status ? ... : 'DRAFT'`) but then guarded the DynamoDB
 * write on that inferred value with a bare `#status = :current`. DynamoDB
 * evaluates a comparison against an absent attribute as FALSE, so the condition
 * could never match a first publish: every attempt raised
 * ConditionalCheckFailed, was reported as a lost race, and returned CONFLICT —
 * a message asking the editor to retry something that could never succeed. No
 * article had ever been published.
 *
 * No unit test can catch that. The defect is in DynamoDB's evaluation of an
 * absent attribute, so it only reproduces against a real table, through the
 * real Lambda, with a row created by the real GraphQL mutation. Hence this file.
 *
 * Every test builds its own category and article, so vitest's `retry: 1` cannot
 * make a counter assertion fail against state left by the first attempt.
 */

let users: Record<Role, TestUser>
let admin: Client
let editor: Client

beforeAll(() => {
  users = inject('testUsers')
  admin = clientFor(users.ADMIN)
  editor = clientFor(users.EDITOR)
})

async function draft() {
  const category = await makeCategory(admin)
  const article = await makeArticle(admin, {
    categoryId: category.id,
    authorProfileId: users.ADMIN.sub,
  })
  return { category, article }
}

describe('the state a new article starts in', () => {
  it('has no status attribute at all', async () => {
    // The premise the whole bug rested on. If a `.default()` is ever added to
    // Article.status, this fails and points at the reason the condition below
    // is written the way it is.
    const { article } = await draft()

    const row = await getRow<Record<string, unknown>>('Article', { id: article.id })
    expect(row).toBeTruthy()
    expect(row?.status ?? null).toBeNull()
    expect(row?.feedKey ?? null).toBeNull()
  })
})

describe('publishing', () => {
  it('publishes a first-time draft and sets every feed key', async () => {
    // The exact operation that failed in production.
    const { category, article } = await draft()

    await publishArticle(admin, article.id)

    const row = await getRow<Record<string, unknown>>('Article', { id: article.id })
    expect(row?.status).toBe('PUBLISHED')
    expect(row?.feedKey).toBe('PUBLISHED#HI')
    expect(row?.categoryFeedKey).toBe(`${category.id}#PUBLISHED#HI`)
    expect(typeof row?.publishedAt).toBe('string')
    // Derived on every transition, so a publish can never ship a stale body.
    expect(typeof row?.bodyPlain).toBe('string')
    expect(row?.revisionCount).toBe(1)
  })

  it('counts the article against its category', async () => {
    // /sitemap.xml gates a category on this, so a permanently-null counter
    // would keep every category out of the sitemap forever.
    const { category, article } = await draft()
    expect(await counterOf('Category', category.id, 'publishedArticleCount')).toBeUndefined()

    await publishArticle(admin, article.id)

    expect(await counterOf('Category', category.id, 'publishedArticleCount')).toBe(1)
  })

  it('refuses to publish an article that is already published', async () => {
    // Proves the fix did not turn the guard into "always allow". PUBLISHED is
    // not in PUBLISH's `from` list, so this is refused by the state machine
    // before the condition is even built.
    const { article } = await draft()
    await publishArticle(admin, article.id)

    const second = expectRefused(
      await admin.mutations.publishArticle({ articleId: article.id, action: 'PUBLISH' }),
      'publishArticle(PUBLISH again)',
    )

    expect(second.code).toBe('CONFLICT')
  })

  it('does not let an EDITOR publish', async () => {
    // "An editor prepares content, an administrator decides what goes live."
    // The @auth directive admits editors to this mutation because they
    // legitimately submit for review; this is the check that separates them.
    const { article } = await draft()

    const refused = expectRefused(
      await editor.mutations.publishArticle({ articleId: article.id, action: 'PUBLISH' }),
      'publishArticle as EDITOR',
    )

    expect(refused.code).toBe('FORBIDDEN')

    const row = await getRow<Record<string, unknown>>('Article', { id: article.id })
    expect(row?.status ?? null).toBeNull()
  })
})

describe('unpublishing', () => {
  it('removes the article from every feed and decrements the category', async () => {
    const { category, article } = await draft()
    await publishArticle(admin, article.id)

    expectOk(
      await admin.mutations.publishArticle({ articleId: article.id, action: 'UNPUBLISH' }),
      'publishArticle(UNPUBLISH)',
    )

    const row = await getRow<Record<string, unknown>>('Article', { id: article.id })
    expect(row?.status).toBe('UNPUBLISHED')
    // REMOVED, not falsified: the row leaves the sparse feed GSI entirely
    // rather than being filtered out of it.
    expect(row?.feedKey ?? null).toBeNull()
    expect(row?.categoryFeedKey ?? null).toBeNull()
    expect(typeof row?.unpublishedAt).toBe('string')

    expect(await counterOf('Category', category.id, 'publishedArticleCount')).toBe(0)
  })

  it('publishes again after an unpublish, preserving the original date', async () => {
    // The second transition runs against a row that HAS a status, so it
    // exercises the `#status = :current` branch of the condition rather than
    // the absent-attribute one.
    const { category, article } = await draft()
    await publishArticle(admin, article.id)
    const firstPublishedAt = (await getRow<Record<string, unknown>>('Article', { id: article.id }))
      ?.publishedAt

    expectOk(
      await admin.mutations.publishArticle({ articleId: article.id, action: 'UNPUBLISH' }),
      'publishArticle(UNPUBLISH)',
    )
    await publishArticle(admin, article.id)

    const row = await getRow<Record<string, unknown>>('Article', { id: article.id })
    expect(row?.status).toBe('PUBLISHED')
    expect(row?.publishedAt).toBe(firstPublishedAt)
    expect(await counterOf('Category', category.id, 'publishedArticleCount')).toBe(1)
  })
})
