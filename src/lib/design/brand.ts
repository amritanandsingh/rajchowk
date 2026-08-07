/**
 * Brand colours as sRGB hex, for the places CSS variables cannot reach.
 *
 * Three consumers need a literal hex rather than a `var(--token)`:
 *   - `<meta name="theme-color">`, which colours the browser chrome
 *   - the icon / favicon SVG, which is a static file with no stylesheet
 *   - the Open Graph image, which is a raster
 *
 * globals.css remains the single source of truth. The OKLCH strings below are
 * copies of the tokens named in the comments, and brand.test.ts reads
 * globals.css and fails if any of them drifts — which had already happened:
 * layout.tsx hardcoded `#14161c` for the dark background while the token
 * actually resolved to `#0d0f15`, because it was hand-converted once and never
 * re-checked.
 *
 * Conversion goes through oklchToHex() from ./color, the same implementation the
 * WCAG contrast suite uses, so a hex here can never disagree with the colour
 * that suite verified.
 */
import { oklchToHex } from './color'

/** `--bg` in `:root`. */
export const BG_LIGHT_OKLCH = 'oklch(0.985 0.004 85)'
/** `--bg` in `.dark`. */
export const BG_DARK_OKLCH = 'oklch(0.17 0.012 265)'
/** `--brand` in `:root` — the deep navy the wordmark is set in. */
export const BRAND_OKLCH = 'oklch(0.31 0.072 258)'
/** `--accent` in `:root` — the restrained editorial red. */
export const ACCENT_OKLCH = 'oklch(0.47 0.183 26)'

export const BRAND_HEX = oklchToHex(BRAND_OKLCH)
export const ACCENT_HEX = oklchToHex(ACCENT_OKLCH)
export const BG_LIGHT_HEX = oklchToHex(BG_LIGHT_OKLCH)
export const BG_DARK_HEX = oklchToHex(BG_DARK_OKLCH)

/** Pure white, used for the roads in the mark. Not a token — it is the paper. */
export const MARK_FG_HEX = '#ffffff'
