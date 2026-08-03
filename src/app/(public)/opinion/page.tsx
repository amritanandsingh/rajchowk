import type { Metadata } from 'next'
import { ArticleGrid } from '@/components/editorial/article-grid'
import { EmptyState } from '@/components/site/empty-state'
import { PageHeader } from '@/components/site/page-header'
import { listPublishedArticles } from '@/lib/amplify/queries'
import { getDictionary } from '@/lib/i18n'

export const revalidate = 60
export const metadata: Metadata = { title: 'मेरी राय', alternates: { canonical: '/opinion' } }

export default async function OpinionPage() {
  const dict = getDictionary('hi')
  const { items } = await listPublishedArticles({ contentType: 'OPINION', limit: 24 })
  return (
    <>
      <main id="content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-8 sm:py-10">
        <PageHeader
          title={dict.nav.opinion}
          description="तथ्यों से अलग, स्पष्ट रूप से चिह्नित विश्लेषण और विचार।"
        />
        {items.length ? (
          <ArticleGrid articles={items} />
        ) : (
          <EmptyState title="अभी कोई राय प्रकाशित नहीं है" />
        )}
      </main>
    </>
  )
}
