import 'server-only'

import { unstable_cache } from 'next/cache'

import type { Schema } from '@/../amplify/data/resource'
import { publicServerClient } from './config'

/**
 * The public data access layer.
 *
 * Every public read in the application goes through this module, and every
 * function here calls one of the APPSYNC_JS custom queries — never
 * `client.models.*`. That is not a style preference: the `Article` model
 * carries no API-key authorization at all, so a direct model read from a
 * public page would fail loudly, which is exactly the behaviour we want if
 * someone tries.
 *
 * Each function is wrapped in Next's data cache. Amplify's GraphQL transport
 * intentionally uses uncached fetches; containing those calls here is what
 * stops a background ISR refresh from silently promoting a static route to a
 * dynamic one.
 */

/**
 * One feed item.
 *
 * Doubly unwrapped on purpose. Amplify generates the items array as
 * `(PublicArticleCard | null)[]` — GraphQL list elements are nullable unless
 * the SDL says otherwise — so the inner `NonNullable` is what stops every
 * consumer from having to null-check a field the resolver always populates.
 * The runtime filter in `listPublishedArticles` below is what makes that
 * honest rather than a lie to the type checker.
 */
export type ArticleCard = NonNullable<
  NonNullable<Schema['listPublishedArticles']['returnType']>['items'][number]
>

export type PublicArticle = NonNullable<Schema['getPublishedArticleBySlug']['returnType']>

export type Page<T> = { items: T[]; nextToken: string | null }

/** Hard ceiling on any page size, enforced here as well as in the resolver.
 *  Two independent clamps because this one is a typo away from being wrong and
 *  the resolver's is the one that actually protects DynamoDB. */
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
 * `{ data: null, errors: [...] }`. Code that only checks `data` renders an
 * empty page while the API is failing, which is indistinguishable from a site
 * that has published nothing. Every call goes through here so that failure is
 * at least logged.
 *
 * Errors are logged server-side and surfaced to the caller as null. The PAGE
 * decides what that means — 404 for a missing article, an error state for a
 * failed feed — because this layer cannot tell the difference.
 */
function unwrap<T>(
  operation: string,
  result: { data: T | null | undefined; errors?: Array<{ message: string; errorType?: string }> },
): T | null {
  if (result.errors?.length) {
    // Structured, single-line JSON so CloudWatch Logs Insights can query it.
    // Nothing user-supplied and nothing secret is interpolated.
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
 * anywhere in that route, INCLUDING inside `unstable_cache`. So a single
 * hard-coded 60 here would silently override the longer TTL /sitemap.xml asks
 * for, and the sitemap would be regenerated sixty times an hour for nobody.
 * The TTL is therefore part of the cache key — see `cachedPerTtl`.
 *
 * On Amplify Hosting there is no on-demand ISR, so a TTL is the only freshness
 * lever that exists. `page: 60` is what makes "publish an article and it
 * appears on the feed" true within a minute.
 */
export const TTL = {
  /** Reader-facing pages. */
  page: 60,
  /** Sitemaps. Crawlers re-fetch on their own cadence; freshness is cheap. */
  sitemap: 3600,
} as const

/**
 * Build one cached variant of a loader per TTL, each with its own cache entry.
 *
 * Paying for a second cache entry is what buys the homepage its one-minute
 * freshness while letting the sitemap actually honour the hour it asks for.
 */
function cachedPerTtl<A extends unknown[], R>(key: string, loader: (...args: A) => Promise<R>) {
  return (ttl: number) => unstable_cache(loader, [key, String(ttl)], { revalidate: ttl })
}

const publishedArticlesFor = cachedPerTtl(
  'public-list-published-articles',
  async (options: { limit?: number; nextToken?: string } = {}): Promise<Page<ArticleCard>> => {
    const client = publicServerClient()
    const result = await client.queries.listPublishedArticles(
      {
        limit: clampLimit(options.limit, 12),
        nextToken: options.nextToken ?? null,
      },
      PUBLIC_AUTH,
    )

    const data = unwrap('listPublishedArticles', result)
    if (!data) return emptyPage<ArticleCard>()
    return {
      // The resolver guarantees a non-null array, but the generated type is
      // nullable and a null here would crash the page rather than empty it.
      items: (data.items ?? []).filter((item): item is ArticleCard => item !== null),
      nextToken: data.nextToken ?? null,
    }
  },
)

/** The homepage feed. */
export const listPublishedArticles = publishedArticlesFor(TTL.page)
/** For /sitemap.xml, which declares `revalidate = 3600`. */
export const listPublishedArticlesHourly = publishedArticlesFor(TTL.sitemap)

const publishedArticleFor = cachedPerTtl(
  'public-get-published-article',
  async (slug: string): Promise<PublicArticle | null> => {
    const client = publicServerClient()
    const result = await client.queries.getPublishedArticleBySlug({ slug }, PUBLIC_AUTH)

    /**
     * A draft and a genuinely missing article both arrive here as a NotFound
     * error — the resolver returns the same thing for both on purpose, so an
     * unpublished headline cannot be confirmed by probing. `unwrap` logs it and
     * returns null, and the page turns null into a 404.
     *
     * That means a real backend outage also renders as 404 rather than as an
     * error page. The trade is deliberate: the alternative is distinguishing
     * them in the response, which re-creates the enumeration oracle. The
     * CloudWatch log line is where an outage is diagnosed.
     */
    return unwrap('getPublishedArticleBySlug', result)
  },
)

export const getPublishedArticle = publishedArticleFor(TTL.page)
export const getPublishedArticleHourly = publishedArticleFor(TTL.sitemap)
