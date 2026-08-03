'use client'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
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
    <main
      id="content"
      className="mx-auto flex min-h-[55vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center"
    >
      <h1 className="font-display text-3xl font-bold">कुछ गलत हो गया</h1>
      <p className="mt-3 text-fg-muted">पृष्ठ लोड नहीं हो पाया। कृपया फिर से कोशिश करें।</p>
      <Button type="button" className="mt-6" onClick={reset}>
        फिर से कोशिश करें
      </Button>
    </main>
  )
}
