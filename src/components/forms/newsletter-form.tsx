'use client'

import { useState, type FormEvent } from 'react'
import { useAnnounce, useDictionary, useLocale } from '@/components/providers'
import { Button } from '@/components/ui/button'
import { guestDataClient, readableAmplifyError } from '@/lib/amplify/browser-client'
import { FormField, TextInput } from './form-field'

export function NewsletterForm({ source = 'WEBSITE' }: { source?: string }) {
  const dict = useDictionary()
  const { locale } = useLocale()
  const announce = useAnnounce()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    if (!email) return
    setLoading(true)
    setMessage('')
    try {
      const result = await guestDataClient.mutations.newsletterSubscribe({
        email,
        language: locale.toUpperCase(),
        source,
      })
      if (result.errors?.length) throw new Error(result.errors[0]?.message)
      const next = result.data?.ok
        ? dict.newsletter.submitted
        : (result.data?.message ?? dict.errors.generic)
      setMessage(next)
      announce(next)
      if (result.data?.ok) event.currentTarget.reset()
    } catch (error) {
      const next = readableAmplifyError(error)
      setMessage(next)
      announce(next, 'assertive')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-card border border-border bg-surface p-5 shadow-card"
    >
      <h2 className="font-display text-xl font-bold">{dict.newsletter.title}</h2>
      <p className="mt-2 text-sm text-fg-muted">{dict.newsletter.description}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <FormField label={dict.newsletter.emailLabel}>
          <TextInput type="email" name="email" required autoComplete="email" inputMode="email" />
        </FormField>
        <Button type="submit" loading={loading}>
          {dict.newsletter.submit}
        </Button>
      </div>
      {message && (
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
      )}
    </form>
  )
}
