import 'server-only'

import { unstable_cache } from 'next/cache'
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
 * Each function is wrapped in Next's data cache. Amplify's GraphQL transport
 * intentionally uses uncached fetches; containing those calls here prevents a
 * background ISR refresh from changing a route from static to dynamic.
 */

export type ArticleCard = NonNullable<
  Schema['listPublishedArticles']['returnType']
>['items'][number]

export type PublicArticle = NonNullable<Schema['getPublishedArticleBySlug']['returnType']>
export type PublicPoll = NonNullable<Schema['getPublicPoll']['returnType']>
export type PublicPollCard = NonNullable<Schema['listPublicPolls']['returnType']>['items'][number]
export type PublicPromise = NonNullable<Schema['getPublicPromise']['returnType']>
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
const PUBLIC_AUTH = { authMode: 'apiKey' as const }

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

export const listPublishedArticles = unstable_cache(
  async (
    options: {
      language?: string
      contentType?: string
      limit?: number
      nextToken?: string
    } = {},
  ): Promise<Page<ArticleCard>> => {
    const client = publicServerClient()
    const result = await client.queries.listPublishedArticles(
      {
        language: options.language ?? 'HI',
        contentType: options.contentType ?? null,
        limit: clampLimit(options.limit, 12),
        nextToken: options.nextToken ?? null,
      },
      PUBLIC_AUTH,
    )

    const data = unwrap('listPublishedArticles', result)
    if (!data) return emptyPage<ArticleCard>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
  ['public-list-published-articles'],
  { revalidate: 60 },
)

export const listArticlesByCategory = unstable_cache(
  async (
    categoryId: string,
    options: { language?: string; limit?: number; nextToken?: string } = {},
  ): Promise<Page<ArticleCard>> => {
    const client = publicServerClient()
    const result = await client.queries.listPublishedArticlesByCategory(
      {
        categoryId,
        language: options.language ?? 'HI',
        limit: clampLimit(options.limit, 12),
        nextToken: options.nextToken ?? null,
      },
      PUBLIC_AUTH,
    )

    const data = unwrap('listPublishedArticlesByCategory', result)
    if (!data) return emptyPage<ArticleCard>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
  ['public-list-articles-by-category'],
  { revalidate: 60 },
)

export const listArticlesByTag = unstable_cache(
  async (
    tagId: string,
    options: { language?: string; limit?: number; nextToken?: string } = {},
  ): Promise<Page<ArticleCard>> => {
    const client = publicServerClient()
    const result = await client.queries.listPublishedArticlesByTag(
      {
        tagId,
        language: options.language ?? 'HI',
        limit: clampLimit(options.limit, 12),
        nextToken: options.nextToken ?? null,
      },
      PUBLIC_AUTH,
    )

    const data = unwrap('listPublishedArticlesByTag', result)
    if (!data) return emptyPage<ArticleCard>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
  ['public-list-articles-by-tag'],
  { revalidate: 60 },
)

/**
 * A single published article by slug.
 *
 * Returns null for a draft, an unpublished article, or a slug that does not
 * exist — the resolver makes those three cases indistinguishable on purpose,
 * so a 404 leaks nothing about what is in the pipeline.
 */
export const getArticleBySlug = unstable_cache(
  async (slug: string): Promise<PublicArticle | null> => {
    const client = publicServerClient()
    const result = await client.queries.getPublishedArticleBySlug({ slug }, PUBLIC_AUTH)
    return unwrap('getPublishedArticleBySlug', result)
  },
  ['public-article-by-slug'],
  { revalidate: 60 },
)

export const getPoll = unstable_cache(
  async (pollId: string): Promise<PublicPoll | null> => {
    const client = publicServerClient()
    const result = await client.queries.getPublicPoll({ pollId }, PUBLIC_AUTH)
    return unwrap('getPublicPoll', result)
  },
  ['public-poll-by-id'],
  { revalidate: 60 },
)

export const listPolls = unstable_cache(
  async (
    options: { status?: string; limit?: number; nextToken?: string } = {},
  ): Promise<Page<PublicPollCard>> => {
    const result = await publicServerClient().queries.listPublicPolls(
      {
        status: options.status ?? 'OPEN',
        limit: clampLimit(options.limit, 12),
        nextToken: options.nextToken ?? null,
      },
      PUBLIC_AUTH,
    )
    const data = unwrap('listPublicPolls', result)
    if (!data) return emptyPage<PublicPollCard>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
  ['public-list-polls'],
  { revalidate: 60 },
)

export const listPromises = unstable_cache(
  async (
    options: { language?: string; limit?: number; nextToken?: string } = {},
  ): Promise<Page<PublicPromise>> => {
    const result = await publicServerClient().queries.listPublicPromises(
      {
        language: options.language ?? 'HI',
        limit: clampLimit(options.limit, 12),
        nextToken: options.nextToken ?? null,
      },
      PUBLIC_AUTH,
    )
    const data = unwrap('listPublicPromises', result)
    if (!data) return emptyPage<PublicPromise>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
  ['public-list-promises'],
  { revalidate: 60 },
)

export const getPromise = unstable_cache(
  async (slug: string): Promise<PublicPromise | null> => {
    const result = await publicServerClient().queries.getPublicPromise({ slug }, PUBLIC_AUTH)
    return unwrap('getPublicPromise', result)
  },
  ['public-promise-by-slug'],
  { revalidate: 60 },
)

export const listApprovedComments = unstable_cache(
  async (
    articleId: string,
    options: { limit?: number; nextToken?: string } = {},
  ): Promise<Page<PublicComment>> => {
    const client = publicServerClient()
    const result = await client.queries.listApprovedComments(
      {
        articleId,
        limit: clampLimit(options.limit, 20),
        nextToken: options.nextToken ?? null,
      },
      PUBLIC_AUTH,
    )

    const data = unwrap('listApprovedComments', result)
    if (!data) return emptyPage<PublicComment>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
  ['public-list-approved-comments'],
  { revalidate: 60 },
)

export const listApprovedQuestions = unstable_cache(
  async (
    options: { scope?: string; limit?: number; nextToken?: string } = {},
  ): Promise<Page<PublicQuestion>> => {
    const client = publicServerClient()
    const result = await client.queries.listApprovedQuestions(
      {
        scope: options.scope ?? 'GLOBAL',
        limit: clampLimit(options.limit, 20),
        nextToken: options.nextToken ?? null,
      },
      PUBLIC_AUTH,
    )

    const data = unwrap('listApprovedQuestions', result)
    if (!data) return emptyPage<PublicQuestion>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
  ['public-list-approved-questions'],
  { revalidate: 60 },
)

export const listLiveEvents = unstable_cache(
  async (
    options: { language?: string; limit?: number; nextToken?: string } = {},
  ): Promise<Page<PublicLiveEvent>> => {
    const client = publicServerClient()
    const result = await client.queries.listPublicLiveEvents(
      {
        language: options.language ?? 'HI',
        limit: clampLimit(options.limit, 10),
        nextToken: options.nextToken ?? null,
      },
      PUBLIC_AUTH,
    )

    const data = unwrap('listPublicLiveEvents', result)
    if (!data) return emptyPage<PublicLiveEvent>()
    return { items: data.items ?? [], nextToken: data.nextToken ?? null }
  },
  ['public-list-live-events'],
  { revalidate: 60 },
)

/**
 * Public site settings: the breaking-news strip and featured content.
 *
 * The resolver hard-codes the PUBLIC visibility partition, so an INTERNAL
 * setting — moderation thresholds, banned-word lists — cannot be reached here
 * even by guessing its key.
 */
export const getSiteSettings = unstable_cache(
  async (): Promise<Record<string, unknown>> => {
    const client = publicServerClient()
    const result = await client.queries.getPublicSiteSettings(PUBLIC_AUTH)
    const data = unwrap('getPublicSiteSettings', result)
    if (!data) return {}

    const settings: Record<string, unknown> = {}
    for (const entry of data) {
      if (entry?.settingKey) settings[entry.settingKey] = entry.valueJson
    }
    return settings
  },
  ['public-site-settings'],
  { revalidate: 60 },
)

/**
 * Categories and tags are ordinary model reads: they carry no draft state and
 * no PII, so they are the one model class with a direct guest read rule.
 */
export const listCategories = unstable_cache(
  async () => {
    const client = publicServerClient()
    const result = await client.models.Category.list({
      filter: { isActive: { eq: true } },
      limit: 50,
      ...PUBLIC_AUTH,
    })
    return unwrap('listCategories', result) ?? []
  },
  ['public-list-categories'],
  { revalidate: 60 },
)

export const getCategoryBySlug = unstable_cache(
  async (slug: string) => {
    const client = publicServerClient()
    const result = await client.models.Category.categoryBySlug(
      { slug },
      { limit: 1, ...PUBLIC_AUTH },
    )
    const data = unwrap('categoryBySlug', result)
    return data?.[0] ?? null
  },
  ['public-category-by-slug'],
  { revalidate: 60 },
)

export const getTagBySlug = unstable_cache(
  async (slug: string) => {
    const client = publicServerClient()
    const result = await client.models.Tag.tagBySlug({ slug }, { limit: 1, ...PUBLIC_AUTH })
    const data = unwrap('tagBySlug', result)
    return data?.[0] ?? null
  },
  ['public-tag-by-slug'],
  { revalidate: 60 },
)

/**
 * Where a renamed slug now points.
 *
 * Redirect rows exist only for published articles, so a direct model read is
 * safe here and saves a resolver on the 404 path.
 */
export const getSlugRedirect = unstable_cache(
  async (fromSlug: string): Promise<string | null> => {
    const client = publicServerClient()
    const result = await client.models.ArticleRedirect.get({ fromSlug }, PUBLIC_AUTH)
    const data = unwrap('getSlugRedirect', result)
    return data?.toSlug ?? null
  },
  ['public-slug-redirect'],
  { revalidate: 60 },
)
