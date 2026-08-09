import Link from 'next/link'

import { getDictionary } from '@/lib/i18n/hi'

/**
 * The masthead.
 *
 * Deliberately almost empty. There is one public destination in this product,
 * so a navigation bar would be a row of one link pretending to be a menu. The
 * wordmark links home and that is the whole navigation — which is also what
 * keeps the reader's eye on the headline below it.
 *
 * `sticky` with z-50: the skip link sits at z-60 so it can never render behind
 * this.
 */
export function SiteHeader() {
  const dict = getDictionary()

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/85 backdrop-blur-sm">
      <div className="mx-auto flex h-(--header-h) max-w-5xl items-center px-4">
        <Link
          href="/"
          className="font-display text-xl font-bold tracking-tight text-fg hover:text-brand"
        >
          {dict.siteName}
        </Link>
        <span className="ms-3 hidden text-xs text-fg-subtle sm:inline">{dict.tagline}</span>
      </div>
    </header>
  )
}
