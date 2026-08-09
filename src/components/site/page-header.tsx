import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  eyebrow,
  action,
}: {
  title: string
  description?: string
  eyebrow?: string
  action?: ReactNode
}) {
  return (
    <header className="mb-8 border-b border-border pb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && (
            <p className="mb-2 text-sm font-bold tracking-wide text-accent uppercase">{eyebrow}</p>
          )}
          <h1 className="font-display text-3xl font-bold sm:text-4xl">{title}</h1>
          {description && <p className="mt-3 max-w-3xl text-fg-muted">{description}</p>}
        </div>
        {action}
      </div>
    </header>
  )
}
