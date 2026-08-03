import { Suspense } from 'react'
import { AuthForm } from '@/components/auth/auth-form'
export default function ConfirmPage() {
  return (
    <main id="content" className="px-4 py-12">
      <Suspense fallback={<p>लोड हो रहा है…</p>}>
        <AuthForm mode="confirm" />
      </Suspense>
    </main>
  )
}
