'use client'

import Link from 'next/link'
import { getCurrentUser } from 'aws-amplify/auth'
import { useState } from 'react'
import { useAnnounce, useDictionary } from '@/components/providers'
import { Button } from '@/components/ui/button'
import { userPoolDataClient, readableAmplifyError } from '@/lib/amplify/browser-client'

export function EventRegistrationButton({ eventId }: { eventId: string }) {
  const dict = useDictionary()
  const announce = useAnnounce()
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [needsAuth, setNeedsAuth] = useState(false)

  async function register() {
    setLoading(true)
    try {
      let user
      try {
        user = await getCurrentUser()
      } catch {
        setNeedsAuth(true)
        return
      }
      const response = await userPoolDataClient.models.EventRegistration.create({
        userSub: user.userId,
        eventId,
        registeredAt: new Date().toISOString(),
      })
      if (response.errors?.length) throw new Error(response.errors[0]?.message)
      setDone(true)
      announce(dict.live.registered)
    } catch (error) {
      announce(readableAmplifyError(error), 'assertive')
    } finally {
      setLoading(false)
    }
  }

  if (needsAuth)
    return (
      <Link href="/auth/sign-in" className="font-semibold">
        {dict.nav.signIn}
      </Link>
    )
  return (
    <Button
      type="button"
      variant={done ? 'outline' : 'primary'}
      loading={loading}
      disabled={done}
      onClick={register}
    >
      {done ? dict.live.registered : dict.live.register}
    </Button>
  )
}
