import type { Metadata } from 'next'
import { AdminDashboard } from '@/components/admin/admin-dashboard'
import { PageHeader } from '@/components/site/page-header'
export const metadata: Metadata = {
  title: 'स्टाफ डैशबोर्ड',
  robots: { index: false, follow: false },
}
export default function AdminPage() {
  return (
    <main id="content" className="mx-auto min-h-[55vh] max-w-5xl px-4 py-10">
      <PageHeader title="स्टाफ डैशबोर्ड" description="संपादकीय और मॉडरेशन कार्य।" />
      <AdminDashboard />
    </main>
  )
}
