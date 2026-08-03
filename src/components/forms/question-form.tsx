'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { useAnnounce, useDictionary, useLocale } from '@/components/providers'
import { Button } from '@/components/ui/button'
import { browserDataClient, readableAmplifyError } from '@/lib/amplify/browser-client'
import { FormField, TextArea, TextInput } from './form-field'

export function QuestionForm() {
  const dict = useDictionary()
  const { locale } = useLocale()
  const announce = useAnnounce()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const questionText = String(form.get('question') ?? '').trim()
    if (questionText.length < 10) {
      setMessage('कृपया कम से कम 10 अक्षरों में सवाल लिखें।')
      return
    }
    setLoading(true)
    try {
      const response = await browserDataClient.mutations.submitQuestion({
        questionText,
        category: String(form.get('category') ?? '').trim() || null,
      })
      if (response.errors?.length) throw new Error(response.errors[0]?.message)
      const next = response.data?.ok
        ? dict.questions.submitted
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
    <form
      onSubmit={submit}
      className="rounded-card border border-border bg-surface p-5 shadow-card"
    >
      <h2 className="text-xl font-bold">{dict.questions.ask}</h2>
      <div className="mt-4 grid gap-4">
        <FormField label={dict.questions.ask}>
          <TextArea name="question" required minLength={10} maxLength={1000} />
        </FormField>
        <FormField label={locale === 'hi' ? 'विषय (वैकल्पिक)' : 'Topic (optional)'}>
          <TextInput name="category" maxLength={80} />
        </FormField>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={loading}>
            {dict.questions.ask}
          </Button>
          <Link href="/auth/sign-in" className="text-sm">
            {dict.questions.signInToAsk}
          </Link>
        </div>
        {message && (
          <p role="status" className="rounded-card bg-brand-subtle p-3 text-sm">
            {message}
          </p>
        )}
      </div>
    </form>
  )
}
