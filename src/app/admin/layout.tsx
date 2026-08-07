import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AdminShell } from '@/components/admin/admin-shell'

/**
 * `robots` is set for the whole segment rather than per page. next.config.ts
 * also sends `X-Robots-Tag: noindex, nofollow` for /admin/*, which is the
 * defence that actually holds — a header cannot be missed off a new page the
 * way a metadata export can.
 */
export const metadata: Metadata = {
  title: { default: 'स्टाफ', template: '%s | स्टाफ' },
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>
}
