import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils/cn'

const buttonVariants = cva(
  // min-h-11 is the WCAG 2.5.5 44px target; it is on the base so no variant
  // can accidentally drop below it.
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md text-sm font-semibold ' +
    'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ' +
    'focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-55 ' +
    'motion-reduce:transition-none',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-brand-fg hover:bg-brand-hover',
        accent: 'bg-accent text-accent-fg hover:bg-accent-hover',
        outline: 'border border-border-strong bg-surface text-fg hover:bg-bg-subtle',
        ghost: 'text-fg hover:bg-bg-subtle',
        danger: 'bg-danger text-accent-fg hover:opacity-90',
        link: 'min-h-0 text-brand underline underline-offset-4 hover:text-brand-hover',
      },
      size: {
        sm: 'px-3 py-1.5 text-xs',
        md: 'px-4 py-2',
        lg: 'px-6 py-3 text-base',
        icon: 'min-w-11 p-2',
        full: 'w-full px-4 py-3 text-base',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** Shows a spinner and disables the button. The label stays visible so the
   *  button does not change width mid-submit. */
  loading?: boolean
  /** Announced to screen readers while `loading` is true. */
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
      {loading && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
      {children}
      {loading && loadingLabel && <span className="sr-only">{loadingLabel}</span>}
    </button>
  )
})

export { buttonVariants }
