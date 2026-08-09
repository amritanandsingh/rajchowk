import type { ReactNode } from 'react'

import { cn } from '@/lib/utils/cn'

/**
 * The four states every data-backed screen has to be able to show.
 *
 * They live in one file because they are one design decision, not four: same
 * padding, same border, same vertical rhythm, differing only in tone and
 * whether they offer an action. Splitting them across four files is how they
 * drift into looking like four different products.
 *
 * The requirement they exist to satisfy: the application must never leave a
 * visitor looking at a blank screen because a request failed. Every list and
 * every page below renders exactly one of these when it has nothing else.
 */

function Frame({
  children,
  className,
  role,
}: {
  children: ReactNode
  className?: string
  role?: 'status' | 'alert'
}) {
  return (
    <div
      role={role}
      // `polite` rather than `assertive`: these appear as a result of the
      // reader's own navigation, so interrupting them mid-sentence would be
      // rude rather than helpful.
      aria-live={role ? 'polite' : undefined}
      className={cn(
        'rounded-card border border-border bg-surface px-6 py-12 text-center',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * Loading.
 *
 * A skeleton rather than a spinner for lists: it reserves the space the
 * content will occupy, so the page does not jump when data arrives. That is a
 * Cumulative Layout Shift avoided, not just a nicety.
 *
 * `aria-hidden` on the bars with a single visually-hidden status message: a
 * screen reader should hear "लोड हो रहा है" once, not read out eight empty
 * grey rectangles.
 */
export function LoadingState({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div>
      <span role="status" aria-live="polite" className="sr-only">
        {label}
      </span>
      <div aria-hidden="true" className="space-y-4">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="rounded-card border border-border bg-surface p-5">
            <div className="h-5 w-3/4 animate-pulse rounded bg-bg-subtle motion-reduce:animate-none" />
            <div className="mt-3 h-4 w-full animate-pulse rounded bg-bg-subtle motion-reduce:animate-none" />
            <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-bg-subtle motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Nothing here yet — and that is fine. Distinct from ErrorState on purpose:
 *  "no articles published" and "we could not reach the API" look identical if
 *  you collapse them, and only one of them is the reader's problem. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <Frame role="status">
      <p className="font-display text-lg font-bold text-fg">{title}</p>
      {description && <p className="mt-2 text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </Frame>
  )
}

/** Something failed. Always offers a way forward — a retry, or a link out. */
export function ErrorState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <Frame role="alert" className="border-danger/40 bg-danger-subtle">
      <p className="font-display text-lg font-bold text-fg">{title}</p>
      {description && <p className="mt-2 text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </Frame>
  )
}

/**
 * An inline success or failure notice, for forms.
 *
 * `role` is chosen by tone rather than fixed: a failure interrupts (`alert`),
 * a success does not (`status`). Getting that backwards means either shouting
 * over the user or letting a failure pass silently.
 */
export function FormNotice({ tone, children }: { tone: 'success' | 'error'; children: ReactNode }) {
  const success = tone === 'success'
  return (
    <p
      role={success ? 'status' : 'alert'}
      aria-live={success ? 'polite' : 'assertive'}
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        success
          ? 'border-success/40 bg-success-subtle text-success'
          : 'border-danger/40 bg-danger-subtle text-danger',
      )}
    >
      {children}
    </p>
  )
}
