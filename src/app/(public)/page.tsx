import type { Metadata } from 'next'
import { Suspense } from 'react'

import { ArticleList } from '@/components/editorial/article-list'
import { SearchBox } from '@/components/editorial/search-box'
import { LoadingState } from '@/components/state/states'
import { Container } from '@/components/ui/container'
import { listPublishedArticles, searchPublishedArticles } from '@/lib/amplify/queries'
import { normalizeSearchTerm } from '@/lib/domain/search'
import { getDictionary } from '@/lib/i18n/hi'

/**
 * The public feed. No account, no sign-in, no Cognito.
 *
 * `revalidate = 60` is the ONLY cache on this path. The data layer
 * (src/lib/amplify/queries.ts) deliberately holds none — it used to, and two
 * caches disagreeing is what made a published article invisible to ~90% of
 * visitors in production. Read the note in that file before adding caching
 * anywhere below this page.
 *
 * Observed on Amplify: this route is served from Lambda with
 * `cache-control: no-store` rather than as ISR, so in practice every request
 * re-renders and reads AppSync live. The TTL here is what applies if Amplify
 * ever does serve it statically, and it stays for that reason.
 *
 * The page is a Server Component and imports nothing from
 * src/lib/amplify/browser-client.ts, so no Amplify JavaScript reaches the
 * reader at all. The feed is HTML — and so is search, which is a plain GET
 * form submitting back to this route (see components/editorial/search-box).
 *
 * A NOTE ON `revalidate` NOW THAT THIS ROUTE READS `searchParams`.
 * Awaiting searchParams is a dynamic API, so Next no longer prerenders this
 * route and the TTL below no longer applies to it. That is a documentation
 * change more than a behavioural one: Amplify was already serving this page
 * from Lambda with `cache-control: no-store`, re-rendering every request, so
 * the TTL was already inert in production. The visible effect is that a
 * published article appears immediately rather than within 60 seconds. The
 * export stays because it is what would apply if this route were ever served
 * statically again — the same reason it was kept before.
 *
 * WHY THE FETCH IS BEHIND A <Suspense> AND NOT AWAITED UP HERE.
 * A page that awaits its data suspends the whole route segment, and Next fills
 * a suspended segment with the nearest `loading.tsx`. The one that used to live
 * beside this file wrapped its skeleton in <Container> — and Container owns
 * `id="content"` and `tabIndex={-1}`. So while the feed was in flight the
 * document held TWO `<main id="content">` elements, and the skip link pointed
 * at the one about to be thrown away. That is precisely the broken skip link
 * container.tsx warns about, and it only became reachable when this route
 * turned dynamic; it was invisible while `/` was prerendered.
 *
 * Keeping the await inside FeedResults means the shell — main landmark, search
 * box, heading — is in the FIRST flush and never re-created. `loading.tsx` is
 * gone rather than merely unused, so the duplicate cannot come back the next
 * time something above the boundary suspends.
 */
export const revalidate = 60

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const dict = getDictionary()

  /**
   * `?q=` arrives from a URL, so it is neither trimmed nor length-bounded nor
   * NFC-normalised no matter what the form did. Normalising HERE rather than
   * only inside the loader is what keeps the heading, the input's value and
   * the query all showing the same term.
   */
  const { q } = await searchParams
  const term = normalizeSearchTerm(q)
  const searching = term.length > 0

  return (
    <Container>
      <h1 className="sr-only">
        {dict.siteName} — {dict.tagline}
      </h1>

      <SearchBox q={term} />

      <h2 className="mb-6 font-display text-sm font-bold tracking-wide text-fg-muted uppercase">
        {searching ? `${dict.search.resultsFor}: “${term}”` : dict.feed.heading}
      </h2>

      {/*
        `key` restarts the boundary when the term changes, so submitting a new
        search shows the skeleton rather than the previous search's results
        sitting there looking like an answer to the new question.

        The fallback is a bare LoadingState — no Container, no landmark. That
        is the property that keeps `#content` unique; see the note above.
      */}
      <Suspense key={term} fallback={<LoadingState label={dict.loading} rows={4} />}>
        <FeedResults term={term} />
      </Suspense>
    </Container>
  )
}

/**
 * The half of the page that waits on AppSync.
 *
 * Distinguish "nothing published" from "the query failed".
 *
 * `listPublishedArticles` returns an empty page for both — it logs the failure
 * server-side and degrades rather than throwing, so the page still renders.
 * But an empty feed and a broken backend need different copy, and the only
 * signal available here is that a successful empty read is indistinguishable
 * from a failed one.
 *
 * So: treat empty as empty. The honest alternative — surfacing the failure —
 * would mean `queries.ts` returning a discriminated result, which it does for
 * the admin list (`admin-queries.ts`) precisely because there an editor can act
 * on the difference. A reader cannot. They get the empty state, and the
 * CloudWatch log line is where the outage is diagnosed.
 */
async function FeedResults({ term }: { term: string }) {
  const dict = getDictionary()
  const searching = term.length > 0

  const { items } = searching
    ? await searchPublishedArticles(term, { limit: 12 })
    : await listPublishedArticles({ limit: 12 })

  return (
    <ArticleList
      articles={items}
      // A lead story needs a feed to lead. In a result list the first match is
      // not more important than the second, it is merely newer.
      featureFirst={!searching}
      // Spread rather than `empty={searching ? … : undefined}`: under
      // exactOptionalPropertyTypes an explicit undefined is not an absent key.
      {...(searching ? { empty: dict.search.empty } : {})}
    />
  )
}
