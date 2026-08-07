import { Suspense } from 'react'
import { AuthForm } from '@/components/auth/auth-form'
import { Container } from '@/components/ui/container'
export default function SignInPage() {
  return (
    <Container width="form">
      <Suspense fallback={<p>लोड हो रहा है…</p>}>
        <AuthForm mode="sign-in" />
      </Suspense>
    </Container>
  )
}
