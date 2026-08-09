import Link from 'next/link'

export function SectionHeading({
  title,
  href,
  linkLabel = 'सभी देखें',
  id,
}: {
  title: string
  href?: string
  linkLabel?: string
  /**
   * Id for the `<h2>`, so a wrapping `<section aria-labelledby>` can point at
   * the heading itself. Callers previously had to put the id on a div around
   * the content, which made the section's accessible name the concatenated
   * text of everything inside it — on the homepage, every card in the grid.
   */
  id?: string
}) {
  return (
    <div className="mb-5 flex items-center justify-between gap-4 border-b-2 border-brand pb-2">
      <h2 id={id} className="font-display text-2xl font-bold">
        {title}
      </h2>
      {href && (
        <Link href={href} className="text-sm font-semibold whitespace-nowrap">
          {linkLabel}
        </Link>
      )}
    </div>
  )
}
