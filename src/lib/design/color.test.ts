import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  oklchToHex,
  parseOklch,
  relativeLuminance,
  WCAG_AA_LARGE,
  WCAG_AA_NON_TEXT,
  WCAG_AA_NORMAL,
} from './color'

describe('oklch parsing and conversion', () => {
  it('parses the oklch() forms used in globals.css', () => {
    expect(parseOklch('oklch(0.47 0.183 26)')).toEqual({ l: 0.47, c: 0.183, h: 26 })
    expect(parseOklch('oklch(1 0 0)')).toEqual({ l: 1, c: 0, h: 0 })
    expect(parseOklch('  oklch(0.985 0.004 85)  ')).toEqual({ l: 0.985, c: 0.004, h: 85 })
  })

  it('accepts percentage lightness', () => {
    expect(parseOklch('oklch(47% 0.183 26)').l).toBeCloseTo(0.47, 5)
  })

  it('rejects anything that is not an oklch() colour', () => {
    expect(() => parseOklch('#ff0000')).toThrow(/Not an oklch/)
    expect(() => parseOklch('rgb(255 0 0)')).toThrow(/Not an oklch/)
  })

  it('converts the achromatic endpoints exactly', () => {
    expect(oklchToHex('oklch(1 0 0)')).toBe('#ffffff')
    expect(oklchToHex('oklch(0 0 0)')).toBe('#000000')
  })

  it('produces the reference luminances for black and white', () => {
    expect(relativeLuminance('oklch(1 0 0)')).toBeCloseTo(1, 4)
    expect(relativeLuminance('oklch(0 0 0)')).toBeCloseTo(0, 4)
  })

  it('gives 21:1 for black on white, and 1:1 for a colour against itself', () => {
    expect(contrastRatio('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 1)
    expect(contrastRatio('oklch(0.47 0.183 26)', 'oklch(0.47 0.183 26)')).toBeCloseTo(1, 5)
  })

  it('is symmetric in its arguments', () => {
    const a = 'oklch(0.31 0.072 258)'
    const b = 'oklch(0.985 0.004 85)'
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10)
  })
})

/* ---------------------------------------------------------------------------
 * The palette itself. Tokens are read out of globals.css rather than copied,
 * so editing a colour there without checking contrast fails this test.
 * ------------------------------------------------------------------------ */

function readTokenBlock(selector: string): Record<string, string> {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`No "${selector}" block in globals.css`)
  const end = css.indexOf('\n}', start)
  const block = css.slice(start, end)

  const tokens: Record<string, string> = {}
  for (const [, name, value] of block.matchAll(/^\s*(--[\w-]+):\s*(oklch\([^)]*\));/gm)) {
    tokens[name as string] = value as string
  }
  return tokens
}

const light = readTokenBlock(':root')
const dark = readTokenBlock('.dark')

function token(theme: Record<string, string>, name: string): string {
  const value = theme[name]
  if (!value) throw new Error(`Token ${name} is missing or is not an oklch() value`)
  return value
}

/** Text pairs that must clear 4.5:1. */
const NORMAL_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--fg', '--bg'],
  ['--fg', '--surface'],
  ['--fg', '--bg-subtle'],
  ['--fg-muted', '--bg'],
  ['--fg-muted', '--surface'],
  ['--brand', '--bg'],
  ['--brand', '--surface'],
  ['--brand-fg', '--brand'],
  ['--accent', '--bg'],
  ['--accent', '--surface'],
  ['--accent-fg', '--accent'],
  ['--success', '--bg'],
  ['--warning', '--bg'],
  ['--danger', '--bg'],
  ['--info', '--bg'],
  // Editorial tone labels sit on their own tinted backgrounds.
  ['--tone-fact', '--tone-fact-bg'],
  ['--tone-analysis', '--tone-analysis-bg'],
  ['--tone-opinion', '--tone-opinion-bg'],
  ['--tone-developing', '--tone-developing-bg'],
  ['--tone-correction', '--tone-correction-bg'],
  ['--tone-sponsored', '--tone-sponsored-bg'],
  // Status text on its own subtle fill (alerts, badges).
  ['--success', '--success-subtle'],
  ['--warning', '--warning-subtle'],
  ['--danger', '--danger-subtle'],
  ['--info', '--info-subtle'],
  ['--brand', '--brand-subtle'],
]

/** Large/secondary text: 3:1 is the AA threshold. */
const LARGE_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--fg-subtle', '--bg'],
  ['--fg-subtle', '--surface'],
]

/**
 * Non-text UI: focus rings and component boundaries must clear 3:1
 * (WCAG 1.4.11). `--border-strong` outlines buttons and inputs, so it is
 * checked against both surfaces it can sit on. `--border` is excluded on
 * purpose: it is decorative separation, not a component boundary.
 */
const NON_TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--ring', '--bg'],
  ['--ring', '--surface'],
  ['--border-strong', '--bg'],
  ['--border-strong', '--surface'],
]

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme meets WCAG 2.2 AA', (_themeName, theme) => {
  it.each(NORMAL_TEXT_PAIRS)('%s on %s clears 4.5:1', (fg, bg) => {
    const ratio = contrastRatio(token(theme, fg), token(theme, bg))
    expect(
      ratio,
      `${fg} (${oklchToHex(token(theme, fg))}) on ${bg} (${oklchToHex(token(theme, bg))}) = ${ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL)
  })

  it.each(LARGE_TEXT_PAIRS)('%s on %s clears 3:1 (large text only)', (fg, bg) => {
    const ratio = contrastRatio(token(theme, fg), token(theme, bg))
    expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(WCAG_AA_LARGE)
  })

  it.each(NON_TEXT_PAIRS)('%s on %s clears 3:1 (non-text)', (fg, bg) => {
    const ratio = contrastRatio(token(theme, fg), token(theme, bg))
    expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT)
  })
})

describe('palette completeness', () => {
  it('defines every light-theme token in the dark theme too', () => {
    const missing = Object.keys(light).filter((name) => !(name in dark))
    expect(missing, `dark theme is missing: ${missing.join(', ')}`).toEqual([])
  })
})
