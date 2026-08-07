import type { MetadataRoute } from 'next'
import { BG_LIGHT_HEX, BRAND_HEX } from '@/lib/design/brand'
import { DEFAULT_LOCALE, getDictionary, LOCALE_TAGS } from '@/lib/i18n'

/**
 * Web app manifest, served at /manifest.webmanifest.
 *
 * Next links this automatically from the file convention, so no `manifest` entry
 * in the layout's metadata is needed. The CSP allows it without a change:
 * manifest fetches fall back to `default-src 'self'`.
 *
 * `display: 'browser'` rather than 'standalone'. A news site installed as a
 * standalone app loses the URL bar and the back gesture, which is actively worse
 * for something readers arrive at from a WhatsApp link and leave again — the
 * install prompt is worth having for the icon, not for the app frame.
 */
export default function manifest(): MetadataRoute.Manifest {
  const dict = getDictionary(DEFAULT_LOCALE)
  return {
    name: `${dict.siteName} — ${dict.tagline}`,
    short_name: dict.siteName,
    description: dict.tagline,
    start_url: '/',
    display: 'browser',
    lang: LOCALE_TAGS[DEFAULT_LOCALE],
    dir: 'ltr',
    background_color: BG_LIGHT_HEX,
    theme_color: BRAND_HEX,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android crops a circle out of any non-maskable icon, which would clip
      // the roads. The maskable variant keeps the mark inside the safe zone.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
