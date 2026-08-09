import type { MetadataRoute } from 'next'

import { absoluteUrl } from '@/lib/env'

/**
 * Note what `disallow` does and does not do: it asks well-behaved crawlers not
 * to FETCH /admin, but it does not deindex, and the file itself advertises the
 * path to anyone who reads it. The control that actually holds is the
 * `X-Robots-Tag: noindex, nofollow` response header on /admin/* in
 * next.config.ts — and behind both of them, the Cognito check in middleware.ts
 * and the `allow.group('ADMIN')` rules on the API.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: '/admin' }],
    sitemap: absoluteUrl('/sitemap.xml'),
  }
}
