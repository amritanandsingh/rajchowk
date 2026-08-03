import { listPublishedArticles } from '@/lib/amplify/queries'
import { absoluteUrl, env } from '@/lib/env'

export const dynamic = 'force-static'
export const revalidate = 300

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function GET(): Promise<Response> {
  const { items } = await listPublishedArticles({ limit: 24 })
  const cutoff = Date.now() - 48 * 60 * 60 * 1000
  const recent = items.filter(
    (article) => article.publishedAt && new Date(article.publishedAt).getTime() >= cutoff,
  )
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">',
    ...recent.map((article) => {
      const path = article.contentType === 'OPINION' ? '/opinion' : '/news'
      return `  <url><loc>${xmlEscape(absoluteUrl(`${path}/${article.slug}`))}</loc><news:news><news:publication><news:name>${xmlEscape(env.NEXT_PUBLIC_SITE_NAME)}</news:name><news:language>${article.language === 'EN' ? 'en' : 'hi'}</news:language></news:publication><news:publication_date>${article.publishedAt}</news:publication_date><news:title>${xmlEscape(article.title)}</news:title></news:news></url>`
    }),
    '</urlset>',
  ].join('\n')
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
    },
  })
}
