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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfaf7' },
    { media: '(prefers-color-scheme: dark)', color: '#14161c' },
  ],
}

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
