import { CheckCircle2, CircleDashed, CirclePause, CircleX, Gauge } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

const config: Record<string, { label: string; className: string; Icon: typeof Gauge }> = {
  ANNOUNCED: { label: 'घोषित', className: 'bg-bg-subtle text-fg-muted', Icon: CircleDashed },
  IN_PROGRESS: { label: 'जारी', className: 'bg-info-subtle text-info', Icon: Gauge },
  COMPLETED: { label: 'पूरा', className: 'bg-success-subtle text-success', Icon: CheckCircle2 },
  PARTIALLY_COMPLETED: {
    label: 'आंशिक रूप से पूरा',
    className: 'bg-warning-subtle text-warning',
    Icon: CirclePause,
  },
  NOT_COMPLETED: { label: 'पूरा नहीं', className: 'bg-danger-subtle text-danger', Icon: CircleX },
  UNVERIFIABLE: {
    label: 'सत्यापन संभव नहीं',
    className: 'bg-bg-subtle text-fg-muted',
    Icon: CircleDashed,
  },
  ON_HOLD: { label: 'रोका गया', className: 'bg-warning-subtle text-warning', Icon: CirclePause },
}

export function PromiseStatus({ status }: { status: string }) {
  const item = config[status] ?? config.ANNOUNCED!
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold',
        item.className,
      )}
    >
      <item.Icon aria-hidden="true" className="size-4" />
      {item.label}
    </span>
  )
}
