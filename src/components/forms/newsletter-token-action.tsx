'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { guestDataClient, readableAmplifyError } from '@/lib/amplify/browser-client'

export function NewsletterTokenAction({
  action,
  id,
  token,
}: {
  action: 'verify' | 'unsubscribe'
  id: string
  token: string
}) {
  const [message, setMessage] = useState('आपका अनुरोध पूरा किया जा रहा है…')
  useEffect(() => {
    void (async () => {
      try {
        const response =
          action === 'verify'
            ? await guestDataClient.mutations.newsletterVerify({ id, token })
            : await guestDataClient.mutations.newsletterUnsubscribe({ id, signature: token })
        if (response.errors?.length) throw new Error(response.errors[0]?.message)
        setMessage(
          response.data?.ok
            ? action === 'verify'
              ? 'न्यूज़लेटर सदस्यता की पुष्टि हो गई है।'
              : 'आपकी सदस्यता समाप्त कर दी गई है।'
            : (response.data?.message ?? 'अनुरोध पूरा नहीं हो पाया।'),
        )
      } catch (error) {
        setMessage(readableAmplifyError(error))
      }
    })()
  }, [action, id, token])
  return (
    <div className="mx-auto max-w-xl rounded-card border border-border bg-surface p-6 text-center shadow-card">
      <h1 className="font-display text-2xl font-bold">
        {action === 'verify' ? 'न्यूज़लेटर पुष्टि' : 'सदस्यता समाप्त करें'}
      </h1>
      <p className="mt-4" role="status">
        {message}
      </p>
      <Link href="/" className="mt-5 inline-block">
        होम पर जाएँ
      </Link>
    </div>
  )
}
