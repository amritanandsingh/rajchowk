import type { ReactNode } from 'react'

import { cn } from '@/lib/utils/cn'

/**
 * The page's main content region.
 *
 * Two things live here so that no page can get one without the other.
 *
 * ONE — `id="content"` and `tabIndex={-1}` travel together. The skip link
 * targets the id, but focus only MOVES to an element that can hold it. A page
 * that sets the id and forgets tabIndex scrolls the keyboard user to the
 * content and leaves their focus at the top of the document, so the next Tab
 * resumes in the header. That is the classic broken skip link, and it is
 * broken in a way nobody notices without testing by keyboard.
 *
 * TWO — one named width per kind of page, rather than a max-w-* chosen per
 * route. Three cover every case here:
 *
 *   wide  — listings and card grids. Needs the full measure.
 *   prose — running text. Capped near 70 characters, which for Devanagari at
 *           text-article is about max-w-3xl.
 *   form  — a single column of inputs. Wider only makes labels harder to scan.
 */
const WIDTHS = {
  wide: 'max-w-5xl',
  prose: 'max-w-3xl',
  form: 'max-w-2xl',
} as const

export type ContainerWidth = keyof typeof WIDTHS

export function Container({
  children,
  width = 'wide',
  className,
}: {
  children: ReactNode
  width?: ContainerWidth
  className?: string
}) {
  return (
    <main
      id="content"
      // Required, not optional — see the note above.
      tabIndex={-1}
      className={cn(
        'mx-auto min-h-[60vh] px-4 py-8 sm:py-12',
        WIDTHS[width],
        // The skip link moves focus here; a focus ring around the entire page
        // is noise, and the reader can already see where they landed.
        'focus:outline-none',
        className,
      )}
    >
      {children}
    </main>
  )
}
