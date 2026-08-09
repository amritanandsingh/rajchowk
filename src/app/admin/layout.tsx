import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { SkipLink } from '@/components/ui/skip-link'
import { getDictionary } from '@/lib/i18n/hi'

/**
 * `robots` is set for the whole segment rather than per page, so a new admin
 * route cannot be added without it.
 *
 * next.config.ts additionally sends `X-Robots-Tag: noindex, nofollow` and
 * `Cache-Control: no-store` for /admin/*, and the header is the defence that
 * actually holds — a metadata export can be forgotten on a new file; a header
 * rule matching the path cannot.
 */
export const metadata: Metadata = {
  title: { default: 'संपादकीय', template: '%s | संपादकीय' },
  robots: { index: false, follow: false },
}

/**
 * Deliberately does NOT render SiteHeader/SiteFooter. An editor working in the
 * tool does not need a masthead linking them out of it, and the reader-facing
 * chrome would make /admin look like a public page.
 *
 * There is no authorization check in this layout, on purpose. It happens in
 * middleware.ts before this renders, and again on every AppSync operation. A
 * third check here would be a third place to keep in agreement, and the one
 * most likely to be quietly relied upon as if it were the boundary.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const dict = getDictionary()

  return (
    <div className="flex min-h-dvh flex-col bg-bg-subtle">
      <SkipLink targetId="content" label={dict.nav.skipToContent} />
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-(--header-h) max-w-5xl items-center justify-between px-4">
          <Link href="/admin" className="font-display font-bold tracking-tight hover:text-brand">
            {dict.siteName}
            <span className="ms-2 text-xs font-normal text-fg-subtle">संपादकीय</span>
          </Link>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  )
}
