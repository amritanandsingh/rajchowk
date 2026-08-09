'use client'

import Link from 'next/link'
import { useDictionary } from '@/components/providers'
import { Wordmark } from '@/components/site/logo'

export function SiteFooter() {
  const dict = useDictionary()
  return (
    <footer className="mt-16 border-t border-border bg-bg-subtle">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Wordmark siteName={dict.siteName} />
          <p className="mt-2 text-sm text-fg-muted">{dict.tagline}</p>
        </div>
        <nav aria-label={dict.a11y.footerSections} className="grid content-start gap-2 text-sm">
          <Link href="/latest">{dict.nav.latest}</Link>
          <Link href="/opinion">{dict.nav.opinion}</Link>
          <Link href="/janmat">{dict.nav.janmat}</Link>
          <Link href="/ask">{dict.nav.ask}</Link>
        </nav>
        <nav aria-label={dict.a11y.footerInformation} className="grid content-start gap-2 text-sm">
          <Link href="/about">{dict.nav.about}</Link>
          <Link href="/editorial-policy">{dict.nav.editorialPolicy}</Link>
          <Link href="/corrections-policy">{dict.nav.correctionsPolicy}</Link>
          <Link href="/contact">{dict.nav.contact}</Link>
        </nav>
        <div className="text-sm text-fg-muted">
          <p>{dict.footerBlurb}</p>
          <Link href="/feed.xml" className="mt-3 inline-block">
            {dict.nav.rssFeed}
          </Link>
        </div>
      </div>
      <div className="border-t border-border px-4 py-4 text-center text-xs text-fg-muted">
        © {new Date().getFullYear()} {dict.siteName}
      </div>
    </footer>
  )
}
