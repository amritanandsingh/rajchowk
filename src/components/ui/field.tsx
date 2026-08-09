import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'

import { cn } from '@/lib/utils/cn'

const controlClass =
  'mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base text-fg ' +
  'placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-1 ' +
  'focus-visible:outline-ring disabled:opacity-60 aria-[invalid=true]:border-danger'

/**
 * A labelled form control with hint and error slots.
 *
 * The accessibility wiring is the reason this is a component rather than
 * markup repeated per field, and it is easy to get subtly wrong:
 *
 *  - the label is associated by `htmlFor`/`id`, not by nesting, so a screen
 *    reader announces the field name when focus lands on the control;
 *  - `aria-describedby` points at the hint AND the error, so both are read;
 *  - `aria-invalid` is what actually marks the field as failed — a red border
 *    alone communicates nothing to a non-visual reader, and colour alone would
 *    fail WCAG 1.4.1 even for sighted users;
 *  - the error carries `role="alert"` so it is announced when it appears,
 *    rather than only when the user happens to navigate onto it.
 *
 * `useId` rather than a caller-supplied id: two instances of the same form on
 * one page would otherwise share ids and the label would point at the wrong
 * control.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string
  hint?: string
  error?: string | undefined
  required?: boolean
  /** Receives the wiring it must spread onto the control. */
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    'aria-invalid': boolean | undefined
    required: boolean | undefined
  }) => ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  // Both are listed when both exist. Dropping the hint once an error appears
  // would remove the formatting rule at exactly the moment it is needed.
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
        {required && (
          <span aria-hidden="true" className="ms-1 text-danger">
            *
          </span>
        )}
      </label>

      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
        required: required || undefined,
      })}

      {hint && (
        <p id={hintId} className="mt-1 text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-danger">
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
  return <textarea className={cn(controlClass, 'min-h-32 resize-y', className)} {...props} />
}
