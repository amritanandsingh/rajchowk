import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

/**
 * The surface every panel on the site is built from.
 *
 * `rounded-card border border-border bg-surface shadow-card` was written out by
 * hand in forty-five places, which is why hover states, padding and border
 * treatment had quietly diverged between the article grid, the admin dashboard
 * and the forms. Same `cva` shape as button.tsx so the two primitives read alike.
 *
 * `interactive` is separate from the variants on purpose: whether a card is
 * clickable is orthogonal to how it is filled, and a hover state on a card that
 * is not a link is a lie about what it does.
 */
const cardVariants = cva('rounded-card', {
  variants: {
    variant: {
      /** Default panel: raised off the page background. */
      surface: 'border border-border bg-surface shadow-card',
      /** Recessed — for a panel inside another panel, where a shadow would fight. */
      subtle: 'bg-bg-subtle',
      /** Brand-tinted, for an editorially promoted block. */
      brand: 'bg-brand-subtle',
      /** Outline only, no fill. */
      outline: 'border border-border',
    },
    padding: {
      none: '',
      sm: 'p-3',
      md: 'p-5',
      lg: 'p-5 sm:p-7',
    },
  },
  defaultVariants: { variant: 'surface', padding: 'md' },
})

export type CardProps = VariantProps<typeof cardVariants> & {
  children: ReactNode
  className?: string
  /** Adds the hover affordance. Only for cards that are actually a link or button. */
  interactive?: boolean
  /** Rendered element. `article` for editorial content, `section` for a region. */
  as?: 'div' | 'article' | 'section' | 'li'
}

export function Card({
  children,
  className,
  variant,
  padding,
  interactive = false,
  as: Tag = 'div',
}: CardProps) {
  return (
    <Tag
      className={cn(
        cardVariants({ variant, padding }),
        interactive && 'transition-colors hover:border-brand motion-reduce:transition-none',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

export { cardVariants }
