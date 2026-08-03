import 'server-only'

import { cache } from 'react'
import type { Schema } from '@/../amplify/data/resource'
import { publicServerClient } from './config'

/**
 * The public data access layer.
 *
 * Every public read in the application goes through this module, and every
 * function here calls one of the APPSYNC_JS custom queries — never
 * `client.models.*`. That is not a style preference: the models carry no guest
 * authorization at all, so a direct model read from a public page would fail,
 * loudly, which is exactly the behaviour we want if someone tries.
 *
 * Each function is wrapped in React `cache()` so `generateMetadata` and the
 * page component that follows it share a single AppSync request per render.
 */

export type ArticleCard = NonNullable<
  Schema['listPublishedArticles']['returnType']
>['items'][number]

export type PublicArticle = NonNullable<Schema['getPublishedArticleBySlug']['returnType']>
export type PublicPoll = NonNullable<Schema['getPublicPoll']['returnType']>
export type PublicComment = NonNullable<
  Schema['listApprovedComments']['returnType']
>['items'][number]
export type PublicQuestion = NonNullable<
  Schema['listApprovedQuestions']['returnType']
>['items'][number]
export type PublicLiveEvent = NonNullable<
  Schema['listPublicLiveEvents']['returnType']
>['items'][number]

export type Page<T> = { items: T[]; nextToken: string | null }

/** Hard ceiling on any page size, enforced here as well as in each resolver. */
const MAX_PAGE = 24

function clampLimit(limit: number | undefined, fallback: number): number {
  if (!limit || limit < 1) return fallback
  return Math.min(limit, MAX_PAGE)
}

/**
 * Unwrap an AppSync response.
 *
 * The Amplify v6 client does NOT throw on a GraphQL error — it returns
 * `{ data: null, errors: [...] }`. Code that only checks `data` silently
 * renders an empty page when the API is failing, so every call goes through
 * here. Errors are logged server-side and surfaced to the caller as null; the
 * page decides whether that is a 404 or an error boundary.
 */
function unwrap<T>(
  operation: string,
  result: { data: T | null | undefined; errors?: Array<{ message: string; errorType?: string }> },
): T | null {
  if (result.errors?.length) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: `AppSync operation failed: ${operation}`,
        errors: result.errors.map((error) => ({
          message: error.message,
          errorType: error.errorType,
        })),
      }),
    )
    return null
  }
  return result.data ?? null
}

const emptyPage = <T>(): Page<T> => ({ items: [], nextToken: null })

export const listPublishedArticles = cache(
  async (
    options: {
      language?: string
      contentType?: string
      limit?: number
      nextToken?: string
    } = {},
  ): Promise<Page<ArticleCard>> => {
    const client = publicServerClient()
    const result = await client.queries.listPublishedArticles({
      language: options.language ?? 'HI',
      contentType: options.contentType ?? null,
      limit: clampLimit(options.limit, 12),
      nextToken: options.nextToken ?? null,
    })

    const data = unwrap('listPublishedArticles', result)
    if (!data) return emptyPage<ArticleCard>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
)

export const listArticlesByCategory = cache(
  async (
    categoryId: string,
    options: { language?: string; limit?: number; nextToken?: string } = {},
  ): Promise<Page<ArticleCard>> => {
    const client = publicServerClient()
    const result = await client.queries.listPublishedArticlesByCategory({
      categoryId,
      language: options.language ?? 'HI',
      limit: clampLimit(options.limit, 12),
      nextToken: options.nextToken ?? null,
    })

    const data = unwrap('listPublishedArticlesByCategory', result)
    if (!data) return emptyPage<ArticleCard>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
)

export const listArticlesByTag = cache(
  async (
    tagId: string,
    options: { language?: string; limit?: number; nextToken?: string } = {},
  ): Promise<Page<ArticleCard>> => {
    const client = publicServerClient()
    const result = await client.queries.listPublishedArticlesByTag({
      tagId,
      language: options.language ?? 'HI',
      limit: clampLimit(options.limit, 12),
      nextToken: options.nextToken ?? null,
    })

    const data = unwrap('listPublishedArticlesByTag', result)
    if (!data) return emptyPage<ArticleCard>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
)

/**
 * A single published article by slug.
 *
 * Returns null for a draft, an unpublished article, or a slug that does not
 * exist — the resolver makes those three cases indistinguishable on purpose,
 * so a 404 leaks nothing about what is in the pipeline.
 */
export const getArticleBySlug = cache(async (slug: string): Promise<PublicArticle | null> => {
  const client = publicServerClient()
  const result = await client.queries.getPublishedArticleBySlug({ slug })
  return unwrap('getPublishedArticleBySlug', result)
})

export const getPoll = cache(async (pollId: string): Promise<PublicPoll | null> => {
  const client = publicServerClient()
  const result = await client.queries.getPublicPoll({ pollId })
  return unwrap('getPublicPoll', result)
})

export const listApprovedComments = cache(
  async (
    articleId: string,
    options: { limit?: number; nextToken?: string } = {},
  ): Promise<Page<PublicComment>> => {
    const client = publicServerClient()
    const result = await client.queries.listApprovedComments({
      articleId,
      limit: clampLimit(options.limit, 20),
      nextToken: options.nextToken ?? null,
    })

    const data = unwrap('listApprovedComments', result)
    if (!data) return emptyPage<PublicComment>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
)

export const listApprovedQuestions = cache(
  async (
    options: { scope?: string; limit?: number; nextToken?: string } = {},
  ): Promise<Page<PublicQuestion>> => {
    const client = publicServerClient()
    const result = await client.queries.listApprovedQuestions({
      scope: options.scope ?? 'GLOBAL',
      limit: clampLimit(options.limit, 20),
      nextToken: options.nextToken ?? null,
    })

    const data = unwrap('listApprovedQuestions', result)
    if (!data) return emptyPage<PublicQuestion>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
)

export const listLiveEvents = cache(
  async (
    options: { language?: string; limit?: number; nextToken?: string } = {},
  ): Promise<Page<PublicLiveEvent>> => {
    const client = publicServerClient()
    const result = await client.queries.listPublicLiveEvents({
      language: options.language ?? 'HI',
      limit: clampLimit(options.limit, 10),
      nextToken: options.nextToken ?? null,
    })

    const data = unwrap('listPublicLiveEvents', result)
    if (!data) return emptyPage<PublicLiveEvent>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
)

/**
 * Public site settings: the breaking-news strip and featured content.
 *
 * The resolver hard-codes the PUBLIC visibility partition, so an INTERNAL
 * setting — moderation thresholds, banned-word lists — cannot be reached here
 * even by guessing its key.
 */
export const getSiteSettings = cache(async (): Promise<Record<string, unknown>> => {
  const client = publicServerClient()
  const result = await client.queries.getPublicSiteSettings()
  const data = unwrap('getPublicSiteSettings', result)
  if (!data) return {}

  const settings: Record<string, unknown> = {}
  for (const entry of data) {
    if (entry?.settingKey) settings[entry.settingKey] = entry.valueJson
  }
  return settings
})

/**
 * Categories and tags are ordinary model reads: they carry no draft state and
 * no PII, so they are the one model class with a direct guest read rule.
 */
export const listCategories = cache(async () => {
  const client = publicServerClient()
  const result = await client.models.Category.list({
    filter: { isActive: { eq: true } },
    limit: 50,
  })
  return unwrap('listCategories', result) ?? []
})

export const getCategoryBySlug = cache(async (slug: string) => {
  const client = publicServerClient()
  const result = await client.models.Category.categoryBySlug({ slug }, { limit: 1 })
  const data = unwrap('categoryBySlug', result)
  return data?.[0] ?? null
})

export const getTagBySlug = cache(async (slug: string) => {
  const client = publicServerClient()
  const result = await client.models.Tag.tagBySlug({ slug }, { limit: 1 })
  const data = unwrap('tagBySlug', result)
  return data?.[0] ?? null
})

/**
 * Where a renamed slug now points.
 *
 * Redirect rows exist only for published articles, so a direct model read is
 * safe here and saves a resolver on the 404 path.
 */
export const getSlugRedirect = cache(async (fromSlug: string): Promise<string | null> => {
  const client = publicServerClient()
  const result = await client.models.ArticleRedirect.get({ fromSlug })
  const data = unwrap('getSlugRedirect', result)
  return data?.toSlug ?? null
})
