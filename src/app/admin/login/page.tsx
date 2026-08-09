import type { Metadata } from 'next'
import { Suspense } from 'react'

import { SignInForm } from '@/components/admin/sign-in-form'
import { Container } from '@/components/ui/container'
import { getDictionary } from '@/lib/i18n/hi'

export const metadata: Metadata = {
  title: 'साइन इन',
  robots: { index: false, follow: false },
}

/**
 * Never prerendered — a cached sign-in page is a cached CSRF token waiting to
 * happen, and next.config.ts already sends `Cache-Control: no-store` here.
 */
export const dynamic = 'force-dynamic'

export default function AdminLoginPage() {
  const dict = getDictionary()

  return (
    <Container width="form">
      <div className="rounded-card border border-border bg-surface p-6 sm:p-8">
        <h1 className="font-display text-xl font-bold">{dict.admin.login.title}</h1>
        <p className="mt-1 mb-6 text-sm text-fg-muted">{dict.admin.login.description}</p>

        {/*
          SignInForm reads `next` via useSearchParams, which opts the whole
          subtree into client-side rendering. Without a Suspense boundary
          `next build` fails outright with "useSearchParams() should be wrapped
          in a suspense boundary" — this is a build-time requirement, not a
          loading nicety.
        */}
        <Suspense fallback={<FormSkeleton />}>
          <SignInForm />
        </Suspense>
      </div>
    </Container>
  )
}

function FormSkeleton() {
  return (
    <div aria-hidden="true" className="animate-pulse space-y-5 motion-reduce:animate-none">
      <div className="h-16 rounded bg-bg-subtle" />
      <div className="h-16 rounded bg-bg-subtle" />
      <div className="h-11 rounded bg-bg-subtle" />
    </div>
  )
}
