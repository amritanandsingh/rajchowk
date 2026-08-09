import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

import { env } from '@/lib/env'
import { getDictionary } from '@/lib/i18n/hi'
import { fontVariables } from './fonts'
import './globals.css'

const dict = getDictionary()

export const metadata: Metadata = {
  // Every relative URL in metadata below (canonicals, Open Graph) resolves
  // against this. Without it Next emits relative og:url values, which are
  // invalid and which most crawlers silently drop.
  metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
  title: {
    default: `${dict.siteName} — ${dict.tagline}`,
    template: `%s | ${dict.siteName}`,
  },
  description: 'विचार, विश्लेषण और लेख।',
  openGraph: {
    type: 'website',
    locale: 'hi_IN',
    siteName: dict.siteName,
  },
  robots: {
    // The site is public and should be indexed; /admin is excluded by an
    // X-Robots-Tag response header in next.config.ts, which cannot be
    // forgotten on a new page the way a metadata export can.
    index: true,
    follow: true,
  },
}

export const viewport: Viewport = {
  // No `maximum-scale` and no `user-scalable=no`. Blocking zoom is a WCAG
  // 1.4.4 failure, and on a Devanagari site it is a particularly unkind one.
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf7' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1b21' },
  ],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // `lang="hi"` drives the :lang(hi) rules in globals.css that replace
    // synthesised italic with weight — Devanagari has no italic and the
    // browser's oblique is illegible.
    <html lang="hi" suppressHydrationWarning>
      <body className={fontVariables}>{children}</body>
    </html>
  )
}
