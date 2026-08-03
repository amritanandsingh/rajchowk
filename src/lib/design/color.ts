/**
 * Minimal OKLCH → sRGB conversion and WCAG contrast maths.
 *
 * This exists so the design system's "meets WCAG AA" claim is a test that runs
 * in CI rather than an assertion in a document. The whole palette in
 * globals.css is declared in oklch, and every foreground/background pair that
 * carries text is checked in color.test.ts.
 *
 * Conversion follows Björn Ottosson's published OKLab matrices.
 */

export type Oklch = { l: number; c: number; h: number }

/** Parse `oklch(0.47 0.183 26)`. Alpha, if present, is ignored. */
export function parseOklch(input: string): Oklch {
  const match = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/i.exec(input.trim())
  if (!match) throw new Error(`Not an oklch() colour: ${input}`)

  const [, rawL, rawC, rawH] = match as unknown as [string, string, string, string]
  const l = rawL.endsWith('%') ? Number.parseFloat(rawL) / 100 : Number.parseFloat(rawL)

  return { l, c: Number.parseFloat(rawC), h: Number.parseFloat(rawH) }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** OKLCH → linear-light sRGB, clamped into gamut the way a display would. */
function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const hRad = (h * Math.PI) / 180
  const a = c * Math.cos(hRad)
  const b = c * Math.sin(hRad)

  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    clamp01(4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube),
    clamp01(-1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube),
    clamp01(-0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube),
  ]
}

const toGamma = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

/** OKLCH → `#rrggbb`, for debugging and for test failure messages. */
export function oklchToHex(colour: Oklch | string): string {
  const parsed = typeof colour === 'string' ? parseOklch(colour) : colour
  const channel = (v: number): string =>
    Math.round(clamp01(toGamma(v)) * 255)
      .toString(16)
      .padStart(2, '0')

  const [r, g, b] = oklchToLinearRgb(parsed)
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(colour: Oklch | string): number {
  const parsed = typeof colour === 'string' ? parseOklch(colour) : colour
  // Round-trip through the gamma encoding so out-of-gamut colours are measured
  // as they would actually be displayed after clamping.
  const [r, g, b] = oklchToLinearRgb(parsed).map((v) => {
    const encoded = clamp01(toGamma(v))
    return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.x contrast ratio, 1–21. Order of arguments does not matter. */
export function contrastRatio(a: Oklch | string, b: Oklch | string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

/** AA is 4.5:1 for body text, 3:1 for large text (>=24px, or >=18.66px bold). */
export const WCAG_AA_NORMAL = 4.5
export const WCAG_AA_LARGE = 3
/** AA non-text contrast for UI components and graphical objects (1.4.11). */
export const WCAG_AA_NON_TEXT = 3
