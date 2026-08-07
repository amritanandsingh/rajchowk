import type { Metadata } from 'next'
import { AdminDashboard } from '@/components/admin/admin-dashboard'
import { PageHeader } from '@/components/site/page-header'
import { Container } from '@/components/ui/container'
export const metadata: Metadata = {
  title: 'स्टाफ डैशबोर्ड',
  robots: { index: false, follow: false },
}
export default function AdminPage() {
  return (
    <Container>
      <PageHeader title="स्टाफ डैशबोर्ड" description="संपादकीय और मॉडरेशन कार्य।" />
      <AdminDashboard />
    </Container>
  )
}
