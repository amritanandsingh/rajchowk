import { notFound } from 'next/navigation'
import { ArticleGrid } from '@/components/editorial/article-grid'
import { EmptyState } from '@/components/site/empty-state'
import { PageHeader } from '@/components/site/page-header'
import { getTagBySlug, listArticlesByTag } from '@/lib/amplify/queries'
import { Container } from '@/components/ui/container'

export const revalidate = 60
type Props = { params: Promise<{ slug: string }> }

export default async function TagPage({ params }: Props) {
  const { slug } = await params
  const tag = await getTagBySlug(slug)
  if (!tag) notFound()
  const { items } = await listArticlesByTag(tag.id, { limit: 24 })
  return (
    <Container>
      <PageHeader eyebrow="टैग" title={tag.nameHi} />
      {items.length ? (
        <ArticleGrid articles={items} />
      ) : (
        <EmptyState title="इस टैग के लिए अभी कोई खबर नहीं है" />
      )}
    </Container>
  )
}
