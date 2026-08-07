'use client'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <Container width="form" className="flex flex-col items-center justify-center py-16 text-center">
      <h1 className="font-display text-3xl font-bold">कुछ गलत हो गया</h1>
      <p className="mt-3 text-fg-muted">पृष्ठ लोड नहीं हो पाया। कृपया फिर से कोशिश करें।</p>
      <Button type="button" className="mt-6" onClick={reset}>
        फिर से कोशिश करें
      </Button>
      {/* The digest is an opaque hash, not a stack trace — it leaks nothing and
          it is the only handle that ties this blank page to a specific server
          log entry. Without it a production error is unreportable: the message
          is minified away and this boundary used to render nothing but prose. */}
      {error.digest && (
        <p className="mt-6 font-mono text-xs text-fg-subtle">त्रुटि कोड: {error.digest}</p>
      )}
    </Container>
  )
}
