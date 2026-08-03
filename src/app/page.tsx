import type { Metadata } from 'next'
import { ArticleCard } from '@/components/editorial/article-card'
import { ArticleGrid } from '@/components/editorial/article-grid'
import { NewsletterForm } from '@/components/forms/newsletter-form'
import { EmptyState } from '@/components/site/empty-state'
import { SectionHeading } from '@/components/site/section-heading'
import { listPublishedArticles } from '@/lib/amplify/queries'
import { DEFAULT_LOCALE, getDictionary } from '@/lib/i18n'

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
      <main id="content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-8 sm:py-10">
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

        {remaining.length > 0 && (
          <section className="mt-12" aria-labelledby="latest-heading">
            <SectionHeading title={dict.nav.latest} href="/latest" />
            <div id="latest-heading">
              <ArticleGrid articles={remaining} />
            </div>
          </section>
        )}
        {opinion.length > 0 && (
          <section
            className="mt-12 rounded-card bg-brand-subtle p-5 sm:p-7"
            aria-labelledby="opinion-heading"
          >
            <SectionHeading title={dict.nav.opinion} href="/opinion" />
            <div id="opinion-heading">
              <ArticleGrid articles={opinion} />
            </div>
          </section>
        )}
        <section className="mt-12" aria-label={dict.newsletter.title}>
          <NewsletterForm source="HOMEPAGE" />
        </section>
      </main>
    </>
  )
}
