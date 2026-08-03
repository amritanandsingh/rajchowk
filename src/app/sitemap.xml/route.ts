import { listCategories, listPromises, listPublishedArticles } from '@/lib/amplify/queries'
import { absoluteUrl } from '@/lib/env'

export const dynamic = 'force-static'
export const revalidate = 3600

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function GET(): Promise<Response> {
  const [articles, opinions, promises, categories] = await Promise.all([
    listPublishedArticles({ limit: 24 }),
    listPublishedArticles({ contentType: 'OPINION', limit: 24 }),
    listPromises({ limit: 24 }),
    listCategories(),
  ])
  const staticPaths = [
    '/',
    '/latest',
    '/opinion',
    '/janmat',
    '/ask',
    '/promises',
    '/live',
    '/videos',
    '/about',
    '/editorial-policy',
    '/corrections-policy',
    '/contact',
  ]
  const urls = [
    ...staticPaths.map((path) => ({ path, lastmod: undefined as string | undefined })),
    ...articles.items
      .filter((article) => article.contentType !== 'OPINION')
      .map((article) => ({
        path: `/news/${article.slug}`,
        lastmod: article.publishedAt ?? undefined,
      })),
    ...opinions.items.map((article) => ({
      path: `/opinion/${article.slug}`,
      lastmod: article.publishedAt ?? undefined,
    })),
    ...promises.items.map((promise) => ({
      path: `/promises/${promise.slug}`,
      lastmod: promise.lastVerifiedAt ?? undefined,
    })),
    ...categories
      .filter((category) => Boolean(category.slug))
      .map((category) => ({
        path: `/category/${category.slug}`,
        lastmod: undefined as string | undefined,
      })),
  ]
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(
      ({ path, lastmod }) =>
        `  <url><loc>${xmlEscape(absoluteUrl(path))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`,
    ),
    '</urlset>',
  ].join('\n')
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
