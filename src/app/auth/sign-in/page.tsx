import { Suspense } from 'react'
import { AuthForm } from '@/components/auth/auth-form'
export default function SignInPage() {
  return (
    <main id="content" className="px-4 py-12">
      <Suspense fallback={<p>लोड हो रहा है…</p>}>
        <AuthForm mode="sign-in" />
      </Suspense>
    </main>
  )
}
