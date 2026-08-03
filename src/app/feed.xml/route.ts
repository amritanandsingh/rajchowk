import { listPublishedArticles } from '@/lib/amplify/queries'
import { absoluteUrl, env } from '@/lib/env'
import { getDictionary } from '@/lib/i18n'

/**
 * RSS 2.0 feed.
 *
 * `force-static` + `revalidate` is what opts a GET Route Handler into caching —
 * handlers are NOT cached by default in Next 15. Amplify Hosting has no
 * on-demand ISR, so this TTL is the only freshness mechanism available.
 */
export const dynamic = 'force-static'
export const revalidate = 300

const ITEM_COUNT = 30
/** Long enough to be useful in a reader, short enough not to replace the site. */
const DESCRIPTION_LIMIT = 300

/**
 * Escape text for XML.
 *
 * CDATA is deliberately avoided: a title containing "]]>" would break out of
 * it, and Hindi headlines routinely carry punctuation that makes that kind of
 * bug easy to miss. Escaping all five predefined entities is unambiguous.
 */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET(): Promise<Response> {
  const dict = getDictionary('hi')
  const { items } = await listPublishedArticles({ limit: ITEM_COUNT })

  const entries = items
    .map((article) => {
      const path = article.contentType === 'OPINION' ? '/opinion' : '/news'
      const url = absoluteUrl(`${path}/${article.slug}`)
      const published = article.publishedAt
        ? new Date(article.publishedAt).toUTCString()
        : new Date().toUTCString()

      return [
        '    <item>',
        `      <title>${xmlEscape(article.title)}</title>`,
        `      <link>${xmlEscape(url)}</link>`,
        `      <guid isPermaLink="true">${xmlEscape(url)}</guid>`,
        `      <pubDate>${published}</pubDate>`,
        // Summary only. Full text in RSS cannibalises the pageviews that fund
        // a small newsroom, which is a real trade-off rather than an oversight.
        `      <description>${xmlEscape((article.excerpt ?? '').slice(0, DESCRIPTION_LIMIT))}</description>`,
        article.authorDisplayName
          ? `      <dc:creator>${xmlEscape(article.authorDisplayName)}</dc:creator>`
          : '',
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '  <channel>',
    `    <title>${xmlEscape(env.NEXT_PUBLIC_SITE_NAME)}</title>`,
    `    <link>${xmlEscape(env.NEXT_PUBLIC_SITE_URL)}</link>`,
    `    <description>${xmlEscape(dict.tagline)}</description>`,
    '    <language>hi</language>',
    `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
    `    <atom:link href="${xmlEscape(absoluteUrl('/feed.xml'))}" rel="self" type="application/rss+xml"/>`,
    entries,
    '  </channel>',
    '</rss>',
  ].join('\n')

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
    },
  })
}
