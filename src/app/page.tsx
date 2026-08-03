import type { Metadata } from 'next'
import { SkipLink } from '@/components/ui/skip-link'
import { DEFAULT_LOCALE, getDictionary } from '@/lib/i18n'

// Editorial pages are ISR: Amplify Hosting does not support on-demand ISR, so
// freshness is a TTL rather than an invalidation. See docs/architecture.md.
export const revalidate = 60

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

export default function HomePage() {
  const dict = getDictionary(DEFAULT_LOCALE)

  return (
    <>
      <SkipLink targetId="content" label={dict.nav.skipToContent} />
      <main id="content" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="font-display text-4xl leading-tight font-bold text-balance sm:text-5xl">
          {dict.siteName}
        </h1>
        <p className="mt-4 text-lg text-fg-muted">{dict.tagline}</p>
        <p className="mt-8 rounded-card border border-border bg-surface p-4 text-sm text-fg-muted shadow-card">
          Foundation scaffold. The editorial homepage is built in Phase 3, once the Amplify
          Gen&nbsp;2 backend and the data-access layer are deployed and verified.
        </p>
      </main>
    </>
  )
}
