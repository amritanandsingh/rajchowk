import { Suspense } from 'react'
import { AuthForm } from '@/components/auth/auth-form'
import { Container } from '@/components/ui/container'
export default function SignUpPage() {
  return (
    <Container width="form">
      <Suspense fallback={<p>लोड हो रहा है…</p>}>
        <AuthForm mode="sign-up" />
      </Suspense>
    </Container>
  )
}
