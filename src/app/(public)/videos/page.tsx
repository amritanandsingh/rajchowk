import type { Metadata } from 'next'
import { ArticleGrid } from '@/components/editorial/article-grid'
import { EmptyState } from '@/components/site/empty-state'
import { PageHeader } from '@/components/site/page-header'
import { listPublishedArticles } from '@/lib/amplify/queries'
import { Container } from '@/components/ui/container'

export const revalidate = 60
export const metadata: Metadata = { title: 'वीडियो', alternates: { canonical: '/videos' } }

export default async function VideosPage() {
  const { items } = await listPublishedArticles({ limit: 24 })
  const videos = items.filter((item) => Boolean(item.youtubeVideoId))
  return (
    <Container>
      <PageHeader
        title="वीडियो"
        description="राज चौक के वीडियो विश्लेषण, साक्षात्कार और व्याख्या।"
      />
      {videos.length ? (
        <ArticleGrid articles={videos} />
      ) : (
        <EmptyState title="अभी कोई वीडियो प्रकाशित नहीं है" />
      )}
    </Container>
  )
}
