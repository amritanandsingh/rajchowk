import { Newspaper } from 'lucide-react'

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-card border border-dashed border-border-strong bg-bg-subtle px-6 py-12 text-center">
      <Newspaper aria-hidden="true" className="mx-auto size-9 text-fg-subtle" />
      <h2 className="mt-4 text-lg font-bold">{title}</h2>
      {description && <p className="mx-auto mt-2 max-w-xl text-sm text-fg-muted">{description}</p>}
    </div>
  )
}
