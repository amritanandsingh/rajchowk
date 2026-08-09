'use client'

import { useEffect } from 'react'

import { ErrorState } from '@/components/state/states'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { getDictionary } from '@/lib/i18n/hi'

/**
 * Segment-level boundary for /admin.
 *
 * Distinct from the root one because the recovery differs: an admin whose
 * dashboard failed usually wants to retry or return to the dashboard, not to
 * be sent to the public homepage.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'Unhandled admin render error',
        digest: error.digest ?? null,
      }),
    )
  }, [error])

  const dict = getDictionary()

  return (
    <Container width="form">
      <ErrorState
        title={dict.error.title}
        description={dict.error.description}
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Button onClick={reset}>{dict.error.retry}</Button>
            <Button variant="outline" onClick={() => window.location.assign('/admin')}>
              {dict.admin.title}
            </Button>
          </div>
        }
      />
    </Container>
  )
}
