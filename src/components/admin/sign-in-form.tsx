'use client'

import { confirmSignIn, fetchAuthSession, signIn, signOut } from 'aws-amplify/auth'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'

import { FormNotice } from '@/components/state/states'
import { Button } from '@/components/ui/button'
import { Field, TextInput } from '@/components/ui/field'
import { configureBrowserAmplify } from '@/lib/amplify/browser-client'
import { getDictionary } from '@/lib/i18n/hi'

// Amplify must be configured before any auth call. The module-level call in
// browser-client.ts does it; importing the function makes that dependency
// explicit rather than an import side effect someone later "cleans up".
configureBrowserAmplify()

const dict = getDictionary()

/**
 * Where to send an administrator after a successful sign-in.
 *
 * ONLY a site-relative path is honoured. The `next` parameter is
 * attacker-controllable — a phishing link to
 * `/admin/login?next=https://evil.example` is the whole open-redirect attack,
 * and it is more credible than usual here because the victim has just typed
 * real credentials into a page they trust.
 *
 * Rejecting `//` matters as much as rejecting `https:`: `//evil.example` reads
 * as a path and is a protocol-relative URL. Requiring a leading `/` and
 * forbidding a second one is the whole check.
 */
function safeNext(next: string | null): string {
  if (!next) return '/admin'
  if (!next.startsWith('/') || next.startsWith('//')) return '/admin'
  return next
}

type Stage = 'CREDENTIALS' | 'NEW_PASSWORD'

export function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const destination = safeNext(searchParams.get('next'))

  const [stage, setStage] = useState<Stage>('CREDENTIALS')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  /**
   * Complete the sign-in by checking the group, then navigate.
   *
   * Signing in successfully is NOT the same as being an administrator. The
   * pool holds only admins today, but that is a fact about current operations
   * rather than a guarantee, and "authenticated" silently meaning "authorised"
   * is how privilege bugs start. An account without the group is signed
   * straight back out — leaving it signed in would give a confusing half-state
   * where the middleware bounces them on every navigation with no explanation.
   */
  async function finish() {
    const session = await fetchAuthSession({ forceRefresh: true })
    const groups = session.tokens?.idToken?.payload['cognito:groups']

    if (!Array.isArray(groups) || !groups.includes('ADMIN')) {
      await signOut()
      setError(dict.admin.login.notAdmin)
      setStage('CREDENTIALS')
      return
    }

    // `refresh()` before `replace()` so the server components under /admin
    // re-render with the cookies that were just set. Without it the dashboard
    // can render from a cached RSC payload produced while logged out.
    router.replace(destination)
    router.refresh()
  }

  async function onCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')

    setSubmitting(true)
    setError('')

    try {
      const result = await signIn({ username: email, password })

      /**
       * The first sign-in after `admin --create` lands here: Cognito issues a
       * temporary password and requires it to be changed before it will issue
       * tokens. Without this branch the bootstrap flow dead-ends — sign-in
       * "succeeds" with no session and the middleware bounces the new admin
       * back to this page forever.
       */
      if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setStage('NEW_PASSWORD')
        return
      }

      if (!result.isSignedIn) {
        // Any other challenge (TOTP, and so on). Not implemented in the MVP,
        // and saying so beats appearing to hang.
        setError(dict.admin.login.failed)
        return
      }

      await finish()
    } catch {
      // Deliberately one message for every failure mode. Distinguishing
      // "no such user" from "wrong password" turns the form into an account
      // enumeration oracle, and Cognito's own exception names would leak that
      // straight through if echoed.
      setError(dict.admin.login.failed)
    } finally {
      setSubmitting(false)
    }
  }

  async function onNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const form = new FormData(event.currentTarget)
    const newPassword = String(form.get('newPassword') ?? '')

    setSubmitting(true)
    setError('')

    try {
      const result = await confirmSignIn({ challengeResponse: newPassword })
      if (!result.isSignedIn) {
        setError(dict.admin.login.failed)
        return
      }
      await finish()
    } catch (caught) {
      // Here the real message IS useful and is not an enumeration risk: it is
      // Cognito's password-policy complaint about a password the user just
      // chose, and hiding it would leave them guessing which rule they missed.
      setError(caught instanceof Error ? caught.message : dict.admin.login.failed)
    } finally {
      setSubmitting(false)
    }
  }

  if (stage === 'NEW_PASSWORD') {
    return (
      <form onSubmit={onNewPassword} className="space-y-5" noValidate>
        <div>
          <h2 className="font-display text-lg font-bold">{dict.admin.login.newPasswordTitle}</h2>
          <p className="mt-1 text-sm text-fg-muted">{dict.admin.login.newPasswordDescription}</p>
        </div>

        {error && <FormNotice tone="error">{error}</FormNotice>}

        <Field
          label={dict.admin.login.newPassword}
          hint={dict.admin.login.newPasswordHint}
          required
        >
          {(props) => (
            <TextInput
              {...props}
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              autoFocus
            />
          )}
        </Field>

        <Button
          type="submit"
          size="full"
          loading={submitting}
          loadingLabel={dict.admin.login.submitting}
        >
          {dict.admin.login.confirmSubmit}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={onCredentials} className="space-y-5" noValidate>
      {error && <FormNotice tone="error">{error}</FormNotice>}

      <Field label={dict.admin.login.email} required>
        {(props) => (
          <TextInput
            {...props}
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoFocus
          />
        )}
      </Field>

      <Field label={dict.admin.login.password} required>
        {(props) => (
          <TextInput {...props} name="password" type="password" autoComplete="current-password" />
        )}
      </Field>

      <Button
        type="submit"
        size="full"
        loading={submitting}
        loadingLabel={dict.admin.login.submitting}
      >
        {dict.admin.login.submit}
      </Button>
    </form>
  )
}
