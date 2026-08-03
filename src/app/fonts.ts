import { Inter, Noto_Sans_Devanagari, Noto_Serif_Devanagari } from 'next/font/google'

/**
 * Font strategy for a Hindi-primary, code-mixed newsroom.
 *
 * Devanagari caveats that are easy to get wrong:
 *  - Noto Sans/Serif Devanagari ship `normal` style ONLY. Italic utilities
 *    produce browser-synthesised oblique, which is illegible in Devanagari.
 *    globals.css maps :lang(hi) em/i to weight instead.
 *  - Never pass `weight` to a variable font — it collapses the axis to a
 *    single static instance and costs the weight range.
 *  - The `devanagari` subset is substantially larger than `latin`, so only the
 *    primary body face is preloaded.
 */

/** Primary body + UI face. Hindi headlines are routinely code-mixed
 *  ("Delhi में बड़ा फैसला"), so the Latin subset ships alongside. */
export const notoSansDevanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari', 'latin'],
  display: 'swap',
  variable: '--font-noto-devanagari',
  preload: true,
})

/** Editorial display face for headlines. Not preloaded — it is used for
 *  headings only, and the body face already covers first paint. */
export const notoSerifDevanagari = Noto_Serif_Devanagari({
  subsets: ['devanagari', 'latin'],
  display: 'swap',
  variable: '--font-noto-serif-devanagari',
  preload: false,
})

/** Latin-only face for numerals, dates, and English content. */
export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  preload: false,
})

export const fontVariables = [
  notoSansDevanagari.variable,
  notoSerifDevanagari.variable,
  inter.variable,
].join(' ')
