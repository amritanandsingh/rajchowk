import Link from 'next/link'

import { getDictionary } from '@/lib/i18n/hi'

/**
 * The masthead.
 *
 * This used to carry no <nav> at all, on the grounds that there was one public
 * destination and a navigation bar would be a row of one link pretending to be
 * a menu. That was true and is no longer: /about is a second destination, and
 * a page nothing links to is a page nobody reads.
 *
 * It stays at exactly one link. The wordmark still goes home — that is the
 * navigation for the feed, and giving "मुखपृष्ठ" its own entry beside a
 * wordmark that already does the job is the row-of-one problem again, just
 * moved. Search is not here either: it lives above the feed where the articles
 * are, not in the chrome of every page.
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

        {/* ms-auto rather than a spacer div, so the nav sits at the inline end
            in both directions if this ever renders under an RTL locale. */}
        <nav className="ms-auto">
          <Link href="/about" className="text-sm font-semibold text-fg-muted hover:text-brand">
            {dict.nav.about}
          </Link>
        </nav>
      </div>
    </header>
  )
}
