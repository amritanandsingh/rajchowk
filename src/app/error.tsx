'use client'

import { useEffect } from 'react'

import { ErrorState } from '@/components/state/states'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { getDictionary } from '@/lib/i18n/hi'

/**
 * The last line of defence against a blank page.
 *
 * Must be a Client Component — Next requires it, because `reset` is a callback
 * it hands to the browser.
 *
 * NOTE what is NOT rendered: `error.message`. In production Next already
 * replaces it with a generic string plus a digest, but relying on that is
 * fragile, and in development it would put a stack trace on screen. The digest
 * is the useful half anyway — it correlates to the full error in CloudWatch.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Single-line JSON so CloudWatch Logs Insights can query it. The digest is
    // what ties this to the server-side stack trace.
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'Unhandled render error',
        digest: error.digest ?? null,
      }),
    )
  }, [error])

  const dict = getDictionary()

  return (
    <Container width="prose">
      <ErrorState
        title={dict.error.title}
        description={dict.error.description}
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={reset}>{dict.error.retry}</Button>
            <Button variant="outline" onClick={() => window.location.assign('/')}>
              {dict.error.home}
            </Button>
          </div>
        }
      />
      {error.digest && (
        <p className="mt-4 text-center text-xs text-fg-subtle">
          {/* Gives a reader something to quote in a bug report, and gives us
              something to grep for. Not sensitive: it is a hash. */}
          संदर्भ: <code>{error.digest}</code>
        </p>
      )}
    </Container>
  )
}
