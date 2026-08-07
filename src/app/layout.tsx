import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Providers } from '@/components/providers'
import { ThemeScript } from '@/components/theme-script'
import { absoluteUrl, env } from '@/lib/env'
import { DEFAULT_LOCALE, getDictionary, LOCALE_TAGS, OG_LOCALES } from '@/lib/i18n'
import { fontVariables } from './fonts'
import './globals.css'

const dict = getDictionary(DEFAULT_LOCALE)

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
  title: {
    default: `${dict.siteName} — ${dict.tagline}`,
    template: `%s | ${dict.siteName}`,
  },
  description: dict.tagline,
  applicationName: dict.siteName,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: dict.siteName,
    locale: OG_LOCALES[DEFAULT_LOCALE],
    url: absoluteUrl('/'),
  },
  twitter: { card: 'summary_large_image' },
  robots: {
    index: env.NEXT_PUBLIC_ENV === 'production',
    follow: env.NEXT_PUBLIC_ENV === 'production',
    googleBot: {
      index: env.NEXT_PUBLIC_ENV === 'production',
      follow: env.NEXT_PUBLIC_ENV === 'production',
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Never set maximumScale/userScalable=no: pinch-zoom is a WCAG 1.4.4
  // requirement and matters a great deal for Devanagari at small sizes.
  //
  // `themeColor` is deliberately NOT declared here. A static prefers-color-scheme
  // pair cannot describe a theme that the reader toggles manually, so a dark-OS
  // user who forced light mode got a dark chrome bar above a light page. The
  // pre-paint script writes the meta tag from the same decision that sets the
  // `dark` class, which is the only way the two can be guaranteed to agree.
  // The hexes it uses are derived from --bg by oklchToHex(); the hand-converted
  // pair that used to live here had already drifted (#14161c vs #0d0f15).
}

/**
 * The document shell, and nothing else.
 *
 * SiteHeader and SiteFooter deliberately do NOT live here. They used to, and
 * because this was the only layout in the app, /admin rendered inside the
 * public seven-item news nav and the marketing footer — the newsroom CMS
 * dressed as the reader-facing site, with no way to tell which one you were
 * looking at. A nested layout cannot un-render an ancestor's chrome, so the
 * public chrome moved down into (public)/layout.tsx and /admin got its own.
 *
 * Route groups do not appear in URLs, so every path is unchanged by that move.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  // `lang` is the site's primary language and stays static so public pages
  // remain statically generated. Providers updates it on hydration if the
  // reader has chosen English. See src/components/providers.tsx.
  return (
    <html lang={LOCALE_TAGS[DEFAULT_LOCALE]} className={fontVariables} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-bg font-hindi text-fg antialiased">
        <Providers initialLocale={DEFAULT_LOCALE}>{children}</Providers>
      </body>
    </html>
  )
}
