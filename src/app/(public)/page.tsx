import type { Metadata } from 'next'
import { ArticleCard } from '@/components/editorial/article-card'
import { ArticleGrid } from '@/components/editorial/article-grid'
import { LazyNewsletterForm } from '@/components/forms/lazy'
import { EmptyState } from '@/components/site/empty-state'
import { SectionHeading } from '@/components/site/section-heading'
import { listPublishedArticles } from '@/lib/amplify/queries'
import { DEFAULT_LOCALE, getDictionary } from '@/lib/i18n'
import { Container } from '@/components/ui/container'

// Editorial pages are ISR: Amplify Hosting does not support on-demand ISR, so
// freshness is a TTL rather than an invalidation. See docs/architecture.md.
export const revalidate = 60

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

export default async function HomePage() {
  const dict = getDictionary(DEFAULT_LOCALE)
  const [{ items: latest }, { items: opinion }] = await Promise.all([
    listPublishedArticles({ limit: 10 }),
    listPublishedArticles({ contentType: 'OPINION', limit: 3 }),
  ])
  const featured = latest.find((article) => article.isFeatured) ?? latest[0]
  const remaining = latest.filter((article) => article.id !== featured?.id).slice(0, 6)

  return (
    <>
      <Container>
        <section aria-labelledby="top-story">
          <h1 id="top-story" className="sr-only">
            {dict.siteName} — {dict.tagline}
          </h1>
          {featured ? (
            <ArticleCard article={featured} featured />
          ) : (
            <EmptyState
              title="अभी कोई प्रकाशित खबर नहीं है"
              description="प्रकाशित खबरें यहाँ दिखेंगी।"
            />
          )}
        </section>

        {/* The id goes on the <h2> inside SectionHeading, not on a wrapper
            around the grid. Pointing aria-labelledby at the wrapper made each
            section's accessible name the full text of every card in it. */}
        {remaining.length > 0 && (
          <section className="mt-12" aria-labelledby="latest-heading">
            <SectionHeading id="latest-heading" title={dict.nav.latest} href="/latest" />
            <ArticleGrid articles={remaining} />
          </section>
        )}
        {opinion.length > 0 && (
          <section
            className="mt-12 rounded-card bg-brand-subtle p-5 sm:p-7"
            aria-labelledby="opinion-heading"
          >
            <SectionHeading id="opinion-heading" title={dict.nav.opinion} href="/opinion" />
            <ArticleGrid articles={opinion} />
          </section>
        )}
        <section className="mt-12" aria-label={dict.newsletter.title}>
          <LazyNewsletterForm source="HOMEPAGE" />
        </section>
      </Container>
    </>
  )
}
