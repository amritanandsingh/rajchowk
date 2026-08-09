import type { Metadata } from 'next'

import { ArticleList } from '@/components/editorial/article-list'
import { Container } from '@/components/ui/container'
import { listPublishedArticles } from '@/lib/amplify/queries'
import { getDictionary } from '@/lib/i18n/hi'

/**
 * The public feed. No account, no sign-in, no Cognito.
 *
 * ISR with a 60-second TTL. Amplify Hosting does not support on-demand ISR, so
 * a TTL is the only freshness mechanism available — this is what makes
 * "publish an article and it appears on the feed" true within a minute, and it
 * is why the number is 60 rather than something more relaxed.
 *
 * The page is a Server Component and imports nothing from
 * src/lib/amplify/browser-client.ts, so no Amplify JavaScript reaches the
 * reader at all. The feed is HTML.
 */
export const revalidate = 60

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

export default async function HomePage() {
  const dict = getDictionary()
  const { items } = await listPublishedArticles({ limit: 12 })

  /**
   * Distinguish "nothing published" from "the query failed".
   *
   * `listPublishedArticles` returns an empty page for both — it logs the
   * failure server-side and degrades rather than throwing, so the page still
   * renders. But an empty feed and a broken backend need different copy, and
   * the only signal available here is that a successful empty read is
   * indistinguishable from a failed one.
   *
   * So: treat empty as empty. The honest alternative — surfacing the failure —
   * would mean `queries.ts` returning a discriminated result, which it does
   * for the admin list (`admin-queries.ts`) precisely because there an editor
   * can act on the difference. A reader cannot. They get the empty state, and
   * the CloudWatch log line is where the outage is diagnosed.
   */
  return (
    <Container>
      <h1 className="sr-only">
        {dict.siteName} — {dict.tagline}
      </h1>

      <h2 className="mb-6 font-display text-sm font-bold tracking-wide text-fg-muted uppercase">
        {dict.feed.heading}
      </h2>

      <ArticleList articles={items} featureFirst />
    </Container>
  )
}
