import type { Metadata } from 'next'
import { AccountPanel } from '@/components/auth/account-panel'
import { PageHeader } from '@/components/site/page-header'
import { Container } from '@/components/ui/container'
export const metadata: Metadata = { title: 'मेरा खाता', robots: { index: false, follow: false } }
export default function AccountPage() {
  return (
    <Container width="prose">
      <PageHeader title="मेरा खाता" />
      <AccountPanel />
    </Container>
  )
}
