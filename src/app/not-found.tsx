import Link from 'next/link'

import { SiteFooter } from '@/components/site/site-footer'
import { SiteHeader } from '@/components/site/site-header'
import { EmptyState } from '@/components/state/states'
import { Container } from '@/components/ui/container'
import { getDictionary } from '@/lib/i18n/hi'

/**
 * 404.
 *
 * Renders its own header and footer rather than inheriting them. The root
 * `not-found.tsx` sits OUTSIDE the (public) route group, so it does not get
 * that group's layout — a 404 without chrome looks like a broken deployment
 * rather than a missing page.
 *
 * This is also what a reader sees for an unpublished or deleted article: the
 * article page calls `notFound()` when the resolver reports NotFound, and the
 * resolver reports NotFound for drafts on purpose.
 */
export default function NotFound() {
  const dict = getDictionary()

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <div className="flex-1">
        <Container width="prose">
          <EmptyState
            title={dict.notFound.title}
            description={dict.notFound.description}
            action={
              <Link href="/" className="text-sm font-semibold text-brand hover:text-brand-hover">
                {dict.article.backToFeed}
              </Link>
            }
          />
        </Container>
      </div>
      <SiteFooter />
    </div>
  )
}
