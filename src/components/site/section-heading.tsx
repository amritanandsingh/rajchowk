import Link from 'next/link'

export function SectionHeading({
  title,
  href,
  linkLabel = 'सभी देखें',
}: {
  title: string
  href?: string
  linkLabel?: string
}) {
  return (
    <div className="mb-5 flex items-center justify-between gap-4 border-b-2 border-brand pb-2">
      <h2 className="font-display text-2xl font-bold">{title}</h2>
      {href && (
        <Link href={href} className="text-sm font-semibold whitespace-nowrap">
          {linkLabel}
        </Link>
      )}
    </div>
  )
}
