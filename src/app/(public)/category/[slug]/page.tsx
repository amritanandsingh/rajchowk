import { notFound } from 'next/navigation'
import { ArticleGrid } from '@/components/editorial/article-grid'
import { EmptyState } from '@/components/site/empty-state'
import { PageHeader } from '@/components/site/page-header'
import { getCategoryBySlug, listArticlesByCategory } from '@/lib/amplify/queries'

export const revalidate = 60
type Props = { params: Promise<{ slug: string }> }

export default async function CategoryPage({ params }: Props) {
  const { slug } = await params
  const category = await getCategoryBySlug(slug)
  if (!category) notFound()
  const { items } = await listArticlesByCategory(category.id, { limit: 24 })
  return (
    <main id="content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-8 sm:py-10">
      <PageHeader
        eyebrow="श्रेणी"
        title={category.nameHi}
        {...(category.descriptionHi ? { description: category.descriptionHi } : {})}
      />
      {items.length ? (
        <ArticleGrid articles={items} />
      ) : (
        <EmptyState title="इस श्रेणी में अभी कोई खबर नहीं है" />
      )}
    </main>
  )
}
