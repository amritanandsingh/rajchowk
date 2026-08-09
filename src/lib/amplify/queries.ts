import 'server-only'

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
 * THERE IS NO `unstable_cache` HERE ANY MORE. Do not add one back.
 *
 * These loaders were wrapped in `unstable_cache` with a 60s TTL, on the
 * reasoning that Amplify Hosting has no on-demand ISR so a TTL is the only
 * freshness lever. On a single server that reasoning is fine. On Amplify it
 * produced a **correctness bug in production**, measured on 2026-08-09:
 *
 *     AppSync queried directly : article present  20/20
 *     The live homepage        : article present   2/20
 *
 * An article that was genuinely published was invisible to ~90% of visitors,
 * indefinitely — not for 60 seconds.
 *
 * WHY. Amplify serves this page from Lambda (the response carries
 * `cache-control: no-store`, so the HTML is not CDN-cached and every request
 * reaches compute). Next's data cache is filesystem-backed under `.next/cache`,
 * which on Lambda is **per-instance and seeded from the build artifact**. The
 * build ran while the table was empty, so every instance started life holding a
 * cached empty result, and instances that never successfully revalidated kept
 * serving it. Which instance you hit decided whether you saw the article — hence
 * the flapping rather than a clean 60-second delay.
 *
 * So the TTL was not buying freshness, it was buying a second, incoherent copy
 * of the truth. Reading straight through costs one GSI Query per render — a
 * `Query` on a sparse index with an INCLUDE projection, a few RCU — which is
 * the right trade when the alternative is a publishing platform that does not
 * reliably show published work. The specification's priority order puts
 * correctness above both performance and cost, and this is exactly that case.
 *
 * Freshness is now governed by ONE layer: whatever caching the route itself
 * declares (`export const revalidate` in the page). One cache, not two
 * disagreeing ones.
 */

/** One page of the public feed, read live. */
export async function listPublishedArticles(
  options: { limit?: number; nextToken?: string } = {},
): Promise<Page<ArticleCard>> {
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
}

/**
 * Alias kept for the sitemap and `generateStaticParams`.
 *
 * It used to be a longer-TTL cache variant. It is now the same live read: those
 * callers run at build time or on an hourly route, so they were never the
 * reason the cache existed, and giving them a separate identity again would
 * re-introduce two sources of truth.
 */
export const listPublishedArticlesHourly = listPublishedArticles

/**
 * One published article by slug, read live.
 *
 * Uncached for the same reason as the feed above — and it matters more here,
 * because a cached miss is worse than a cached list: an article that was
 * published a moment ago would 404 for every visitor unlucky enough to land on
 * an instance holding the negative result.
 */
export async function getPublishedArticle(slug: string): Promise<PublicArticle | null> {
  const client = publicServerClient()
  const result = await client.queries.getPublishedArticleBySlug({ slug }, PUBLIC_AUTH)

  /**
   * A draft and a genuinely missing article both arrive here as a NotFound
   * error — the resolver returns the same thing for both on purpose, so an
   * unpublished headline cannot be confirmed by probing. `unwrap` logs it and
   * returns null, and the page turns null into a 404.
   *
   * That means a real backend outage also renders as 404 rather than as an
   * error page. The trade is deliberate: the alternative is distinguishing them
   * in the response, which re-creates the enumeration oracle. The CloudWatch log
   * line is where an outage is diagnosed.
   */
  return unwrap('getPublishedArticleBySlug', result)
}

/** Alias for callers that used to want the longer TTL. See the note above. */
export const getPublishedArticleHourly = getPublishedArticle
