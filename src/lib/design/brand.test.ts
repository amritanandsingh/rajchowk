import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACCENT_OKLCH,
  BG_DARK_OKLCH,
  BG_LIGHT_OKLCH,
  BRAND_HEX,
  BRAND_OKLCH,
  ACCENT_HEX,
  BG_DARK_HEX,
  BG_LIGHT_HEX,
} from './brand'

/**
 * brand.ts copies four OKLCH strings out of globals.css so that non-CSS
 * surfaces (browser chrome, the icon SVG, the OG image) can have a literal hex.
 * A copy that nothing checks is exactly how layout.tsx came to advertise
 * `#14161c` as the dark background when the token resolved to `#0d0f15`.
 *
 * These tests read globals.css and fail on any drift, in either direction.
 */
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')

function tokenIn(block: ':root' | '.dark', name: string): string {
  // Non-greedy to the first closing brace: both blocks are flat declaration
  // lists, so the first `}` after the selector ends it.
  const blockMatch = new RegExp(`${block.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css)
  if (!blockMatch?.[1]) throw new Error(`Could not find the ${block} block in globals.css`)
  const decl = new RegExp(`--${name}:\\s*(oklch\\([^)]*\\))`).exec(blockMatch[1])
  if (!decl?.[1]) throw new Error(`Could not find --${name} in ${block}`)
  return decl[1]
}

describe('brand colours track globals.css', () => {
  it.each([
    ['--bg in :root', ':root' as const, 'bg', BG_LIGHT_OKLCH],
    ['--bg in .dark', '.dark' as const, 'bg', BG_DARK_OKLCH],
    ['--brand in :root', ':root' as const, 'brand', BRAND_OKLCH],
    ['--accent in :root', ':root' as const, 'accent', ACCENT_OKLCH],
  ])('%s has not drifted', (_label, block, name, expected) => {
    expect(tokenIn(block, name)).toBe(expected)
  })
})

describe('derived hex values', () => {
  it('are six-digit lowercase sRGB hex', () => {
    for (const hex of [BRAND_HEX, ACCENT_HEX, BG_LIGHT_HEX, BG_DARK_HEX]) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('keeps the light and dark backgrounds far apart', () => {
    // A sanity check on the conversion itself: if these ever came out close,
    // the browser chrome would stop tracking the theme and nobody would notice.
    expect(BG_LIGHT_HEX).not.toBe(BG_DARK_HEX)
  })
})
