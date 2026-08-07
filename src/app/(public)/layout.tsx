import type { ReactNode } from 'react'
import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'

/**
 * Reader-facing chrome.
 *
 * This is the only place the public header and footer are mounted. Keeping them
 * out of the root layout is what lets /admin have completely different chrome:
 * a nested layout can add to its ancestors but never remove from them, so
 * anything mounted at the root is mounted on the staff surfaces too.
 *
 * The group covers the editorial routes plus /auth, /account and /newsletter —
 * all of them reader-facing, all of them wanting the site nav. Route groups are
 * erased from the URL, so `(public)/page.tsx` is still `/`.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
      <SiteFooter />
    </>
  )
}
