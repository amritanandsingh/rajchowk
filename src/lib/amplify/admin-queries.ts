import 'server-only'

import type { Schema } from '@/../amplify/data/resource'
import type { ArticleStatus } from '@/lib/domain/article-status'
import { userServerClient } from './config'

/**
 * Server-side admin reads.
 *
 * Deliberately NOT cached. Everything here is read through the signed-in
 * admin's own cookies, so a shared cache entry would be a cross-account leak
 * waiting to happen — and an editor who just published something needs to see
 * that, not a 60-second-old list. /admin is dynamic for exactly this reason.
 */

/** Doubly unwrapped — see the note on `ArticleCard` in ./queries.ts. */
export type AdminArticleCard = NonNullable<
  NonNullable<Schema['listArticlesForAdmin']['returnType']>['items'][number]
>

export type AdminArticleDetail = {
  id: string
  title: string
  slug: string
  summary: string
  content: string
  status: ArticleStatus
}

export type AdminListResult =
  { ok: true; items: AdminArticleCard[]; nextToken: string | null } | { ok: false }

/**
 * One page of articles in a given state.
 *
 * Returns a discriminated result rather than an empty array on failure. The
 * distinction matters to the page: "no drafts yet" is an empty state with a
 * "write one" call to action, and "the API refused us" is an error state with
 * a retry. Collapsing both into `[]` is how an outage comes to look like an
 * empty newsroom.
 */
export async function listArticlesForAdmin(
  status: ArticleStatus,
  options: { limit?: number; nextToken?: string } = {},
): Promise<AdminListResult> {
  const client = userServerClient()

  const result = await client.queries.listArticlesForAdmin({
    status,
    limit: options.limit ?? 25,
    nextToken: options.nextToken ?? null,
  })

  if (result.errors?.length || !result.data) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'AppSync operation failed: listArticlesForAdmin',
        status,
        errors: (result.errors ?? []).map((error) => ({
          message: error.message,
          errorType: error.errorType,
        })),
      }),
    )
    return { ok: false }
  }

  return {
    ok: true,
    items: (result.data.items ?? []).filter((item): item is AdminArticleCard => item !== null),
    nextToken: result.data.nextToken ?? null,
  }
}

/**
 * One article, for the edit form.
 *
 * Reads the MODEL rather than a custom query, because this is the one admin
 * read that needs `content` — the full Markdown body, which every list
 * projection deliberately excludes. `Article` grants ADMIN `read` and nothing
 * else, so this is the intended use of that rule.
 *
 * The explicit selection set is not an optimisation: without it Amplify
 * requests every scalar including `authorSub`, which has no business reaching
 * a browser.
 */
export async function getArticleForEdit(id: string): Promise<AdminArticleDetail | null> {
  const client = userServerClient()

  const result = await client.models.Article.get(
    { id },
    { selectionSet: ['id', 'title', 'slug', 'summary', 'content', 'status'] },
  )

  if (result.errors?.length) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'AppSync operation failed: Article.get',
        errors: result.errors.map((error) => ({
          message: error.message,
          errorType: error.errorType,
        })),
      }),
    )
    return null
  }

  const article = result.data
  if (!article) return null

  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    summary: article.summary,
    content: article.content,
    // Absent status means DRAFT — the same fail-closed reading the handlers
    // and resolvers use. See statusOf() in src/lib/domain/article-status.ts.
    status: article.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT',
  }
}
