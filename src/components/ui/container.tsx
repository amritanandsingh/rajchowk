import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

/**
 * The page's main content region.
 *
 * Two problems this exists to solve.
 *
 * ONE — the skip link was broken on nearly half the site. skip-link.tsx states
 * the requirement in its own doc comment: "The target must carry tabIndex={-1}
 * so focus actually moves rather than merely scrolling." Thirteen of twenty-nine
 * pages set `id="content"` and forgot it, so a keyboard reader who used the skip
 * link got scrolled to the content but left with focus at the top of the
 * document — tab order resumed in the header. Both attributes now live here, so
 * a page cannot get one without the other.
 *
 * TWO — eight different max-widths were in play across twenty-nine hand-rolled
 * `<main>` elements (max-w-7xl ×11, 3xl ×9, 5xl ×4, 2xl ×3, xl ×2, 6xl ×2, 4xl
 * ×1, md ×1), with the vertical rhythm varying independently. Nothing chose
 * those values; they accumulated. Three named widths cover every real case:
 *
 *   wide  — card grids and listings. Needs the full measure.
 *   prose — running text: articles, policies, search results. Capped near 70
 *           characters, which for Devanagari at text-article is about max-w-3xl.
 *   form  — a single column of inputs. Wider only makes labels harder to scan.
 */
const WIDTHS = {
  wide: 'max-w-7xl',
  prose: 'max-w-3xl',
  form: 'max-w-xl',
} as const

export type ContainerWidth = keyof typeof WIDTHS

export function Container({
  children,
  width = 'wide',
  className,
  minHeight = true,
}: {
  children: ReactNode
  width?: ContainerWidth
  className?: string
  /**
   * Reserves a minimum viewport height so a short page does not leave the
   * footer floating halfway up the screen. Off for pages that are already tall.
   */
  minHeight?: boolean
}) {
  return (
    <main
      id="content"
      // Required, not optional — see the note above.
      tabIndex={-1}
      className={cn(
        'mx-auto px-4 py-8 sm:py-10',
        WIDTHS[width],
        minHeight && 'min-h-[55vh]',
        // The skip link moves focus here; a focus ring around the whole page is
        // noise, and the reader can already see where they landed.
        'focus:outline-none',
        className,
      )}
    >
      {children}
    </main>
  )
}
