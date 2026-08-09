import type { Metadata } from 'next'
import { ArticleGrid } from '@/components/editorial/article-grid'
import { EmptyState } from '@/components/site/empty-state'
import { PageHeader } from '@/components/site/page-header'
import { listPublishedArticles } from '@/lib/amplify/queries'
import { getDictionary } from '@/lib/i18n'
import { Container } from '@/components/ui/container'

export const revalidate = 60
export const metadata: Metadata = { title: 'ताज़ा खबरें', alternates: { canonical: '/latest' } }

export default async function LatestPage() {
  const dict = getDictionary('hi')
  const { items } = await listPublishedArticles({ limit: 24 })
  return (
    <>
      <Container>
        <PageHeader
          title={dict.nav.latest}
          description="देश, राज्य और राजनीति की सबसे नई खबरें और स्पष्ट संदर्भ।"
        />
        {items.length ? (
          <ArticleGrid articles={items} />
        ) : (
          <EmptyState title="अभी कोई खबर नहीं है" />
        )}
      </Container>
    </>
  )
}
