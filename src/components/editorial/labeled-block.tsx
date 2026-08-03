import type { ReactNode } from 'react'
import type { Dictionary } from '@/lib/i18n'
import { cn } from '@/lib/utils/cn'
import { EditorialBadge, type EditorialBadgeKind } from './editorial-badge'

/**
 * A labelled editorial section: "What happened", "My analysis", "My conclusion".
 *
 * The product's central claim is that verified fact and personal opinion are
 * never visually indistinguishable, so this component states the boundary FOUR
 * independent ways:
 *
 *   1. a visible heading
 *   2. an EditorialBadge (icon + text)
 *   3. a tone-coloured left border
 *   4. a tone-tinted background
 *
 * Strip any three and the distinction still survives — which is what makes it
 * hold up in greyscale, in reader mode, in print, and for colour-blind readers.
 * This is a structural component, not styling; changing it changes what the
 * publication is claiming.
 */

type Tone = 'fact' | 'analysis' | 'opinion' | 'correction'

const TONE_CLASSES: Record<Tone, string> = {
  fact: 'border-s-tone-fact bg-tone-fact-bg',
  analysis: 'border-s-tone-analysis bg-tone-analysis-bg',
  opinion: 'border-s-tone-opinion bg-tone-opinion-bg',
  correction: 'border-s-tone-correction bg-tone-correction-bg',
}

export function LabeledBlock({
  id,
  title,
  badge,
  tone,
  dict,
  children,
  headingLevel = 2,
}: {
  id: string
  title: string
  badge: EditorialBadgeKind
  tone: Tone
  dict: Dictionary
  children: ReactNode
  headingLevel?: 2 | 3
}) {
  const headingId = `${id}-heading`
  const Heading = headingLevel === 3 ? 'h3' : 'h2'

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        'my-8 scroll-mt-20 rounded-card border-s-4 px-4 py-5 sm:px-6',
        TONE_CLASSES[tone],
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Heading id={headingId} className="font-display text-xl font-bold sm:text-2xl">
          {title}
        </Heading>
        <EditorialBadge kind={badge} dict={dict} />
      </div>
      <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </section>
  )
}
