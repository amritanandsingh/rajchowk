import { Noto_Sans_Devanagari, Noto_Serif_Devanagari } from 'next/font/google'

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
 *
 * Inter was here for "numerals, dates and English content" via `--font-sans`,
 * but `font-sans` was never applied to a single element: `body` is pinned to
 * `--font-hindi`, and the Devanagari faces already carry a Latin subset for
 * code-mixed headlines. It was a font download that nothing ever rendered in,
 * so it is gone. If a Latin-only face is wanted later, add it AND apply it —
 * an unused `@theme` token is invisible dead weight.
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

export const fontVariables = [notoSansDevanagari.variable, notoSerifDevanagari.variable].join(' ')
