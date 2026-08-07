import { ACCENT_HEX, BRAND_HEX, MARK_FG_HEX } from '@/lib/design/brand'
import { cn } from '@/lib/utils/cn'

/**
 * The राज चौक mark.
 *
 * A "chowk" is a public square where roads meet — the place people gather to
 * argue about the news. The mark draws that literally: two roads crossing on a
 * navy ground, with the intersection picked out in the editorial red. It is
 * built from four rectangles and a circle so it stays legible at 16px, where
 * anything more detailed turns to mush, and it reads as a recognisable shape in
 * pure silhouette for anyone who cannot distinguish the two hues.
 *
 * Colours come from src/lib/design/brand.ts, which derives them from the same
 * OKLCH tokens as the stylesheet via oklchToHex(). They are literal fills rather
 * than `currentColor` on purpose: this component and the static
 * src/app/icon.svg must be the same mark, and the icon file has no stylesheet.
 */
export function Logo({
  className,
  decorative = false,
}: {
  className?: string
  /**
   * Set when adjacent text already names the brand. The mark then carries no
   * accessible name at all, rather than making a screen reader say "राज चौक"
   * twice in a row.
   */
  decorative?: boolean
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn('size-8 shrink-0', className)}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': 'राज चौक' })}
    >
      <rect width="64" height="64" rx="14" fill={BRAND_HEX} />
      <g fill={MARK_FG_HEX}>
        <rect x="27" y="4" width="10" height="56" rx="1" />
        <rect x="4" y="27" width="56" height="10" rx="1" />
      </g>
      <circle cx="32" cy="32" r="7.5" fill={ACCENT_HEX} />
    </svg>
  )
}

/** The mark plus the wordmark, as used in the site header and footer. */
export function Wordmark({ siteName, className }: { siteName: string; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Logo className="size-7" decorative />
      <span className="font-display text-xl font-bold text-brand">{siteName}</span>
    </span>
  )
}
