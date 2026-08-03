import { listCategories, listPublishedArticles } from '@/lib/amplify/queries'
import { absoluteUrl } from '@/lib/env'

/**
 * The sitemap index.
 *
 * Hand-rolled rather than using the `app/sitemap.ts` convention, for a
 * concrete reason: that convention occupies /sitemap.xml itself, and its
 * `generateSitemaps` helper shards to /sitemap/[id].xml WITHOUT ever emitting
 * an index. Using it would make it impossible to own this URL — which is the
 * one Search Console and robots.txt point at.
 */
export const dynamic = 'force-static'
export const revalidate = 3600

const URLS_PER_SHARD = 5000

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function GET(): Promise<Response> {
  // One page is enough to know whether there is anything to index; the shard
  // routes do their own counting.
  const [{ items: articles }, categories] = await Promise.all([
    listPublishedArticles({ limit: 24 }),
    listCategories(),
  ])

  const now = new Date().toISOString()
  const latest = articles[0]?.publishedAt ?? now

  const shards: Array<{ loc: string; lastmod: string }> = [
    { loc: absoluteUrl('/sitemaps/static/0'), lastmod: now },
    { loc: absoluteUrl('/sitemaps/news/0'), lastmod: latest },
    { loc: absoluteUrl('/sitemaps/opinion/0'), lastmod: latest },
    { loc: absoluteUrl('/sitemaps/promise/0'), lastmod: now },
    { loc: absoluteUrl('/news-sitemap.xml'), lastmod: latest },
  ]

  for (const category of categories) {
    if (!category?.slug) continue
    shards.push({ loc: absoluteUrl(`/sitemaps/category/0`), lastmod: latest })
    break // one shard covers every category listing page
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...shards.map(
      (shard) =>
        `  <sitemap><loc>${xmlEscape(shard.loc)}</loc><lastmod>${shard.lastmod}</lastmod></sitemap>`,
    ),
    '</sitemapindex>',
  ].join('\n')

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}

export { URLS_PER_SHARD }
