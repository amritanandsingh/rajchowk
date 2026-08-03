import type { ReactNode } from 'react'

/**
 * Visible to assistive technology, not to sighted users.
 *
 * Uses Tailwind's `sr-only`, which is the clip-rect technique — the content
 * stays in the accessibility tree, unlike `display:none` or `visibility:hidden`.
 */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>
}
