import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils/cn'

const buttonVariants = cva(
  // min-h-11 is the WCAG 2.5.5 44px target; it sits on the BASE so no variant
  // can accidentally drop below it.
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md text-sm font-semibold ' +
    'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ' +
    'focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-55 ' +
    'motion-reduce:transition-none',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-brand-fg hover:bg-brand-hover',
        outline: 'border border-border-strong bg-surface text-fg hover:bg-bg-subtle',
        ghost: 'text-fg hover:bg-bg-subtle',
        danger: 'bg-danger text-accent-fg hover:opacity-90',
        link: 'min-h-0 text-brand underline underline-offset-4 hover:text-brand-hover',
      },
      size: {
        sm: 'px-3 py-1.5 text-xs',
        md: 'px-4 py-2',
        lg: 'px-6 py-3 text-base',
        full: 'w-full px-4 py-3 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /**
   * Shows a spinner AND disables the button.
   *
   * Coupling the two is the point: this is the component-level half of
   * "prevent duplicate submissions". The other half is the idempotency key in
   * the save handler, because a disabled button is a UX affordance and not a
   * guarantee — it does nothing for a double submit that races the state
   * update, or for a caller that is not this form.
   */
  loading?: boolean
  /** Announced to screen readers while `loading` is true. A spinner alone is
   *  invisible to anyone not looking at it. */
  loadingLabel?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading = false, loadingLabel, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner />}
      {/* The label stays visible so the button does not change width
          mid-submit, which is a layout shift under the user's cursor. */}
      {children}
      {loading && loadingLabel && <span className="sr-only">{loadingLabel}</span>}
    </button>
  )
})

/**
 * Inline SVG rather than an icon package.
 *
 * This is the only icon in the application. Pulling in a whole icon library
 * for it would add a dependency and a shared chunk to every page that renders
 * a button, which on the public feed is every page.
 */
function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-4 animate-spin motion-reduce:animate-none"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <circle cx="12" cy="12" r="9" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round" />
    </svg>
  )
}

export { buttonVariants }
