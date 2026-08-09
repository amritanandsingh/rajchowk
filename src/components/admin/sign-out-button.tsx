'use client'

import { signOut } from 'aws-amplify/auth'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { configureBrowserAmplify } from '@/lib/amplify/browser-client'
import { getDictionary } from '@/lib/i18n/hi'

configureBrowserAmplify()

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function run() {
    setPending(true)
    try {
      await signOut()
    } finally {
      /**
       * Navigate whatever happened.
       *
       * `signOut` can reject when the session is already gone — which is
       * exactly when the user most wants to be signed out. Swallowing the
       * error and leaving them on the dashboard would be the worst outcome:
       * they would believe they are still signed in, or believe sign-out is
       * broken. `replace` rather than `push` so Back does not return to an
       * admin page rendered under the old session.
       */
      router.replace('/')
      router.refresh()
    }
  }

  return (
    <Button variant="ghost" size="sm" loading={pending} onClick={run}>
      {getDictionary().admin.signOut}
    </Button>
  )
}
