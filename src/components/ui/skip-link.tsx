/**
 * First focusable node in the document.
 *
 * z-50 puts it above the sticky header (z-40), which is the usual bug — a skip
 * link that renders behind the header looks broken to the keyboard users it
 * exists for. The target must carry `tabIndex={-1}` so focus actually moves
 * rather than merely scrolling.
 */
export function SkipLink({ targetId, label }: { targetId: string; label: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-brand focus:px-4 focus:py-3 focus:text-brand-fg focus:shadow-raised"
    >
      {label}
    </a>
  )
}
