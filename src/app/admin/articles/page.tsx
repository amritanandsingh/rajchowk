import { AdminArticles } from '@/components/admin/admin-articles'
import { PageHeader } from '@/components/site/page-header'
import { Container } from '@/components/ui/container'
export default function AdminArticlesPage() {
  return (
    <Container>
      <PageHeader title="लेख प्रबंधन" />
      <AdminArticles />
    </Container>
  )
}
