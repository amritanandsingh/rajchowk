import { listPublishedArticlesHourly } from '@/lib/amplify/queries'
import { absoluteUrl } from '@/lib/env'

/**
 * The sitemap.
 *
 * An explicit route handler rather than Next's `sitemap.ts` convention,
 * because that convention has no way to express the hourly cache this needs —
 * and the loader it calls is a distinct `unstable_cache` entry keyed on the
 * TTL for exactly that reason. Next lowers a route's effective revalidate to
 * the smallest value it finds anywhere inside it, so sharing the homepage's
 * 60-second loader would regenerate the sitemap sixty times an hour for
 * crawlers that fetch it daily.
 */
export const revalidate = 3600

/** Only PUBLISHED articles are reachable here: the underlying resolver queries
 *  the sparse feed index, so a draft has no entry to leak. */
export async function GET(): Promise<Response> {
  const { items } = await listPublishedArticlesHourly({ limit: 24 })

  const urls = [
    { loc: absoluteUrl('/'), lastmod: items[0]?.publishedAt ?? null, priority: '1.0' },
    ...items.map((article) => ({
      loc: absoluteUrl(`/article/${article.slug}`),
      lastmod: article.publishedAt ?? null,
      priority: '0.8',
    })),
  ]

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) =>
      `  <url>\n    <loc>${escapeXml(url.loc)}</loc>` +
      (url.lastmod ? `\n    <lastmod>${escapeXml(url.lastmod)}</lastmod>` : '') +
      `\n    <priority>${url.priority}</priority>\n  </url>`,
  )
  .join('\n')}
</urlset>
`

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
    },
  })
}

/**
 * Escape for XML text content.
 *
 * Slugs are constrained to `[a-z0-9-]` so in practice nothing here needs
 * escaping — but "in practice nothing needs escaping" is how injection bugs
 * are written. A future change to slug derivation should not be able to
 * produce malformed XML.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
