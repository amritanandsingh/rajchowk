'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Error boundary for the staff surfaces.
 *
 * Without this, anything thrown while rendering AdminArticles or the moderation
 * queue — an Amplify client that failed to configure, a mutation response of an
 * unexpected shape — unwinds all the way to src/app/error.tsx and blanks the
 * entire page, chrome included. The editor is left with "कुछ गलत हो गया" and no
 * way to tell a permissions problem from a network problem from a bug.
 *
 * A segment boundary keeps the admin shell on screen, and shows the two things
 * that make the failure reportable: the digest (which correlates with the
 * server log) and, outside production, the actual message.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[admin]', error)
  }, [error])

  return (
    <div
      role="alert"
      className="mx-auto my-10 max-w-2xl rounded-card border border-danger bg-danger-subtle p-6"
    >
      <h2 className="font-display text-xl font-bold text-danger">यह पृष्ठ लोड नहीं हो पाया</h2>
      <p className="mt-2 text-sm text-fg-muted">
        स्टाफ़ पैनल का यह हिस्सा नहीं खुल सका। नीचे दिया कोड सहेज लें — इसी से सर्वर लॉग में यह
        त्रुटि खोजी जा सकती है।
      </p>

      {error.digest && (
        <p className="mt-4 font-mono text-xs text-fg-subtle">त्रुटि कोड: {error.digest}</p>
      )}

      {/* The raw message is developer-facing and can carry internals, so it is
          gated to non-production builds. The digest above is what a reader
          reports; this is what a developer reads in `npm run dev`. */}
      {process.env.NODE_ENV !== 'production' && error.message && (
        <pre className="mt-3 overflow-x-auto rounded-md bg-surface p-3 font-mono text-xs text-fg">
          {error.message}
        </pre>
      )}

      <Button type="button" variant="outline" className="mt-6" onClick={reset}>
        फिर से कोशिश करें
      </Button>
    </div>
  )
}
