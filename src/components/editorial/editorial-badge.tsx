import {
  AlertTriangle,
  BadgeCheck,
  Megaphone,
  MessageSquareQuote,
  PencilLine,
  Radio,
  type LucideIcon,
} from 'lucide-react'
import type { Dictionary } from '@/lib/i18n'
import { cn } from '@/lib/utils/cn'

/**
 * The label that tells a reader what KIND of claim they are looking at.
 *
 * This is the product's core credibility mechanism, so it is built to survive
 * everything that normally erases visual distinction:
 *
 *  - a distinct ICON per kind, so it works in greyscale and for colour-blind
 *    readers;
 *  - always-visible TEXT, so it survives reader mode and printing;
 *  - colour last, as reinforcement only.
 *
 * Remove the colour from this component and no information is lost. That is
 * the test it has to pass.
 */

export type EditorialBadgeKind =
  'VERIFIED_FACT' | 'MY_ANALYSIS' | 'OPINION' | 'DEVELOPING' | 'CORRECTION' | 'SPONSORED'

const CONFIG: Record<
  EditorialBadgeKind,
  { icon: LucideIcon; className: string; label: (dict: Dictionary) => string }
> = {
  VERIFIED_FACT: {
    icon: BadgeCheck,
    className: 'text-tone-fact bg-tone-fact-bg border-tone-fact/30',
    label: (dict) => dict.badge.verifiedFact,
  },
  MY_ANALYSIS: {
    icon: PencilLine,
    className: 'text-tone-analysis bg-tone-analysis-bg border-tone-analysis/30',
    label: (dict) => dict.badge.myAnalysis,
  },
  OPINION: {
    icon: MessageSquareQuote,
    className: 'text-tone-opinion bg-tone-opinion-bg border-tone-opinion/30',
    label: (dict) => dict.badge.opinion,
  },
  DEVELOPING: {
    icon: Radio,
    className: 'text-tone-developing bg-tone-developing-bg border-tone-developing/30',
    label: (dict) => dict.badge.developing,
  },
  CORRECTION: {
    icon: AlertTriangle,
    className: 'text-tone-correction bg-tone-correction-bg border-tone-correction/30',
    label: (dict) => dict.badge.correction,
  },
  SPONSORED: {
    icon: Megaphone,
    className: 'text-tone-sponsored bg-tone-sponsored-bg border-tone-sponsored/30',
    label: (dict) => dict.badge.sponsored,
  },
}

export function EditorialBadge({
  kind,
  dict,
  className,
}: {
  kind: EditorialBadgeKind
  dict: Dictionary
  className?: string
}) {
  const config = CONFIG[kind]
  const Icon = config.icon

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold',
        config.className,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {config.label(dict)}
    </span>
  )
}
