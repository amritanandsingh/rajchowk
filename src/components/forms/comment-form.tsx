'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { useAnnounce, useDictionary } from '@/components/providers'
import { Button } from '@/components/ui/button'
import { userPoolDataClient, readableAmplifyError } from '@/lib/amplify/browser-client'
import { TextArea } from './form-field'

export function CommentForm({ articleId }: { articleId: string }) {
  const dict = useDictionary()
  const announce = useAnnounce()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const content = String(new FormData(formElement).get('content') ?? '').trim()
    if (content.length < 2) return
    setLoading(true)
    try {
      const response = await userPoolDataClient.mutations.submitComment({ articleId, content })
      if (response.errors?.length) throw new Error(response.errors[0]?.message)
      const next = response.data?.ok
        ? dict.comments.submitted
        : (response.data?.message ?? dict.errors.generic)
      setMessage(next)
      announce(next, response.data?.ok ? 'polite' : 'assertive')
      if (response.data?.ok) formElement.reset()
    } catch (error) {
      const next = readableAmplifyError(error)
      setMessage(next)
      announce(next, 'assertive')
    } finally {
      setLoading(false)
    }
  }
  return (
    <form onSubmit={submit} className="mt-5">
      <label className="block text-sm font-semibold">
        {dict.comments.label}
        <TextArea name="content" required minLength={2} maxLength={2000} />
      </label>
      <p className="mt-2 text-xs text-fg-muted">{dict.comments.hint}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" loading={loading}>
          {dict.comments.submit}
        </Button>
        <Link href="/auth/sign-in" className="text-sm">
          {dict.comments.signInToComment}
        </Link>
      </div>
      {message && (
        <p role="status" className="mt-3 rounded-card bg-brand-subtle p-3 text-sm">
          {message}
        </p>
      )}
    </form>
  )
}
