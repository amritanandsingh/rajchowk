import type { MetadataRoute } from 'next'
import { absoluteUrl, env, isProduction } from '@/lib/env'

/**
 * robots.txt.
 *
 * Defence in depth, deliberately: this file, per-route `robots` metadata, AND
 * an `X-Robots-Tag` response header from next.config.ts all disallow the same
 * private routes. robots.txt on its own is the weakest of the three — it is a
 * request, it does not deindex anything already crawled, and it publishes a
 * list of the paths you would rather nobody looked at.
 */
export default function robots(): MetadataRoute.Robots {
  // A preview or staging branch must never be indexed. If it were, it would
  // compete with production for the same content and split its ranking.
  if (!isProduction) {
    return { rules: { userAgent: '*', disallow: '/' } }
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/admin/',
          '/account',
          '/account/',
          '/auth',
          '/auth/',
          '/preview/',
          '/api/',
          // Search result pages are thin and near-duplicate; the articles they
          // point at are indexed on their own URLs.
          '/search',
        ],
      },
    ],
    sitemap: [absoluteUrl('/sitemap.xml'), absoluteUrl('/news-sitemap.xml')],
    host: env.NEXT_PUBLIC_SITE_URL,
  }
}
