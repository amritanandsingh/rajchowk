import { AdminArticles } from '@/components/admin/admin-articles'
import { PageHeader } from '@/components/site/page-header'
export default function AdminArticlesPage() {
  return (
    <main id="content" className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader title="लेख प्रबंधन" />
      <AdminArticles />
    </main>
  )
}
