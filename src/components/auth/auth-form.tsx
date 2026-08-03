'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { confirmSignUp, resendSignUpCode, signIn, signUp } from 'aws-amplify/auth'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { readableAmplifyError } from '@/lib/amplify/browser-client'
import { FormField, TextInput } from '@/components/forms/form-field'

type Mode = 'sign-in' | 'sign-up' | 'confirm'

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter()
  const params = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
      .trim()
      .toLowerCase()
    const password = String(form.get('password') ?? '')
    setLoading(true)
    setMessage('')
    try {
      if (mode === 'sign-up') {
        const displayName = String(form.get('displayName') ?? '').trim()
        const result = await signUp({
          username: email,
          password,
          options: {
            userAttributes: {
              email,
              preferred_username: displayName || email.split('@')[0] || 'member',
            },
          },
        })
        if (result.nextStep.signUpStep === 'CONFIRM_SIGN_UP')
          router.push(`/auth/confirm?email=${encodeURIComponent(email)}`)
        else router.push('/account')
      } else if (mode === 'confirm') {
        const code = String(form.get('code') ?? '').trim()
        await confirmSignUp({ username: email, confirmationCode: code })
        router.push(`/auth/sign-in?confirmed=1&email=${encodeURIComponent(email)}`)
      } else {
        const result = await signIn({ username: email, password })
        if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') {
          router.push(`/auth/confirm?email=${encodeURIComponent(email)}`)
          return
        }
        if (!result.isSignedIn) {
          setMessage('साइन-इन पूरा करने के लिए अगला सत्यापन चरण आवश्यक है।')
          return
        }
        router.push(params.get('next') || '/account')
        router.refresh()
      }
    } catch (error) {
      setMessage(readableAmplifyError(error))
    } finally {
      setLoading(false)
    }
  }

  async function resend() {
    const email = params.get('email') ?? ''
    if (!email) return
    setLoading(true)
    try {
      await resendSignUpCode({ username: email })
      setMessage('नया कोड भेज दिया गया है।')
    } catch (error) {
      setMessage(readableAmplifyError(error))
    } finally {
      setLoading(false)
    }
  }

  const isSignUp = mode === 'sign-up'
  const isConfirm = mode === 'confirm'
  return (
    <div className="mx-auto max-w-md">
      <h1 className="font-display text-3xl font-bold">
        {isSignUp ? 'खाता बनाएँ' : isConfirm ? 'ईमेल सत्यापित करें' : 'साइन इन'}
      </h1>
      <p className="mt-2 text-sm text-fg-muted">
        {isSignUp
          ? 'जनमत, सवाल और टिप्पणियों में भाग लें।'
          : isConfirm
            ? 'ईमेल पर भेजा गया कोड दर्ज करें।'
            : 'अपने राज चौक खाते में जाएँ।'}
      </p>
      <form
        onSubmit={submit}
        className="mt-6 grid gap-4 rounded-card border border-border bg-surface p-5 shadow-card"
      >
        {isSignUp && (
          <FormField label="नाम">
            <TextInput
              name="displayName"
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
            />
          </FormField>
        )}
        <FormField label="ईमेल">
          <TextInput
            type="email"
            name="email"
            required
            autoComplete="email"
            defaultValue={params.get('email') ?? ''}
            readOnly={isConfirm && Boolean(params.get('email'))}
          />
        </FormField>
        {isConfirm ? (
          <FormField label="सत्यापन कोड">
            <TextInput name="code" required inputMode="numeric" autoComplete="one-time-code" />
          </FormField>
        ) : (
          <FormField label="पासवर्ड" hint="कम से कम 12 अक्षर, बड़े-छोटे अक्षर, अंक और प्रतीक।">
            <TextInput
              type="password"
              name="password"
              required
              minLength={12}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
            />
          </FormField>
        )}
        <Button type="submit" loading={loading}>
          {isSignUp ? 'खाता बनाएँ' : isConfirm ? 'पुष्टि करें' : 'साइन इन'}
        </Button>
        {isConfirm && (
          <Button type="button" variant="ghost" onClick={resend} disabled={loading}>
            कोड फिर भेजें
          </Button>
        )}
        {message && (
          <p role="alert" className="rounded-card bg-danger-subtle p-3 text-sm text-danger">
            {message}
          </p>
        )}
      </form>
      <p className="mt-4 text-center text-sm">
        {isSignUp ? (
          <>
            पहले से खाता है? <Link href="/auth/sign-in">साइन इन</Link>
          </>
        ) : !isConfirm ? (
          <>
            नये हैं? <Link href="/auth/sign-up">खाता बनाएँ</Link>
          </>
        ) : null}
      </p>
    </div>
  )
}
