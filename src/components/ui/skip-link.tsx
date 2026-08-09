/**
 * First focusable node in the document.
 *
 * `z-[60]` puts it above the sticky header (z-50), which is the usual bug: a
 * skip link that renders behind the header looks broken to precisely the
 * keyboard users it exists for.
 *
 * The target must carry `tabIndex={-1}` so focus actually moves rather than
 * merely scrolling — see Container, which owns both halves.
 */
export function SkipLink({ targetId, label }: { targetId: string; label: string }) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-brand focus:px-4 focus:py-3 focus:text-brand-fg focus:shadow-raised"
    >
      {label}
    </a>
  )
}
