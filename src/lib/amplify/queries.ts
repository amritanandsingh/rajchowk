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

/**
 * Cache lifetimes, named for the surface that needs them.
 *
 * Next lowers a route's effective `revalidate` to the SMALLEST value it finds
 * anywhere in that route, including inside `unstable_cache`. Every wrapper in
 * this file hard-coded 60, which silently overrode the longer TTLs the XML
 * routes declare for themselves: /sitemap.xml asks for 3600 and got 60 — sixty
 * times the intended work, four parallel AppSync calls each time — while
 * /feed.xml and /news-sitemap.xml asked for 300 and also got 60. The build
 * output in .next/prerender-manifest.json showed 60 for all of them.
 *
 * On Amplify Hosting there is no on-demand ISR, so a TTL is the only freshness
 * lever there is, and spending it on a sitemap nobody reads sixty times an hour
 * is pure cost.
 */
export const TTL = {
  /** Reader-facing pages: a story must appear within a minute of publishing. */
  page: 60,
  /** Syndication and slow-changing pages. Feed readers poll on their own schedule. */
  slow: 300,
  /** Sitemaps. Crawlers re-fetch on their own cadence; freshness is cheap here. */
  sitemap: 3600,
} as const

/**
 * Build one cached variant of a loader per TTL, each with its own cache entry.
 *
 * The TTL is part of the cache key deliberately. A single shared entry cannot
 * serve both a 60-second page and a 3600-second sitemap — whichever TTL is
 * lower wins for everyone, which is precisely the bug described above. Paying
 * for a second entry is what buys the homepage its one-minute freshness while
 * letting the sitemap actually honour the hour it asks for.
 */
function cachedPerTtl<A extends unknown[], R>(key: string, loader: (...args: A) => Promise<R>) {
  return (ttl: number) => unstable_cache(loader, [key, String(ttl)], { revalidate: ttl })
}

const publishedArticlesFor = cachedPerTtl(
  'public-list-published-articles',
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
)

export const listPublishedArticles = publishedArticlesFor(TTL.page)
/** For /feed.xml and /news-sitemap.xml, which declare `revalidate = 300`. */
export const listPublishedArticlesSlow = publishedArticlesFor(TTL.slow)
/** For /sitemap.xml, which declares `revalidate = 3600`. */
export const listPublishedArticlesHourly = publishedArticlesFor(TTL.sitemap)

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

const promisesFor = cachedPerTtl(
  'public-list-promises',
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
)

export const listPromises = promisesFor(TTL.page)
/** For /promises and /promises/[slug], which declare `revalidate = 300`. */
export const listPromisesSlow = promisesFor(TTL.slow)
/** For /sitemap.xml, which declares `revalidate = 3600`. */
export const listPromisesHourly = promisesFor(TTL.sitemap)

const promiseBySlugFor = cachedPerTtl(
  'public-promise-by-slug',
  async (slug: string): Promise<PublicPromise | null> => {
    const result = await publicServerClient().queries.getPublicPromise({ slug }, PUBLIC_AUTH)
    return unwrap('getPublicPromise', result)
  },
)

/** For /promises/[slug], which declares `revalidate = 300`. */
export const getPromise = promiseBySlugFor(TTL.slow)

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
const categoriesFor = cachedPerTtl('public-list-categories', async () => {
  const client = publicServerClient()
  const result = await client.models.Category.list({
    filter: { isActive: { eq: true } },
    limit: 50,
    ...PUBLIC_AUTH,
  })
  return unwrap('listCategories', result) ?? []
})

export const listCategories = categoriesFor(TTL.page)
/** For /sitemap.xml, which declares `revalidate = 3600`. */
export const listCategoriesHourly = categoriesFor(TTL.sitemap)

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
