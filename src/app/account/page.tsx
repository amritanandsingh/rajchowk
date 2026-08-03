import type { Metadata } from 'next'
import { AccountPanel } from '@/components/auth/account-panel'
import { PageHeader } from '@/components/site/page-header'
export const metadata: Metadata = { title: 'मेरा खाता', robots: { index: false, follow: false } }
export default function AccountPage() {
  return (
    <main id="content" className="mx-auto min-h-[50vh] max-w-3xl px-4 py-10">
      <PageHeader title="मेरा खाता" />
      <AccountPanel />
    </main>
  )
}
