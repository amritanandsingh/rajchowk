import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/utils/cn'

const controlClass =
  'mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-subtle disabled:opacity-60'

export function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string
  children: ReactNode
}) {
  return (
    <div>
      <label className="block text-sm font-semibold">
        {label}
        {children}
      </label>
      {hint && !error && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
      {error && (
        <p className="mt-1 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(controlClass, className)} {...props} />
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(controlClass, 'min-h-28 resize-y', className)} {...props} />
}
