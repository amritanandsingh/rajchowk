import type { ReactNode } from 'react'

import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { SkipLink } from '@/components/ui/skip-link'
import { getDictionary } from '@/lib/i18n/hi'

/**
 * Chrome for reader-facing pages.
 *
 * A route group rather than the root layout, because /admin must NOT inherit
 * any of it: an editor does not need a masthead linking them out of the tool
 * they are working in, and the skip-link target would collide with the admin
 * shell's own.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  const dict = getDictionary()

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Must be the first focusable node in the document. */}
      <SkipLink targetId="content" label={dict.nav.skipToContent} />
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  )
}
