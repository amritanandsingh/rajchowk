import Link from 'next/link'

import { ArticleTable } from '@/components/admin/article-table'
import { SignOutButton } from '@/components/admin/sign-out-button'
import { buttonVariants } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { listArticlesForAdmin } from '@/lib/amplify/admin-queries'
import { getDictionary } from '@/lib/i18n/hi'

/**
 * The dashboard.
 *
 * `force-dynamic` because the data is per-admin and must never be cached: it
 * is read through the signed-in user's cookies, and a shared cache entry would
 * be a cross-account leak. It also means an editor who just published sees the
 * result immediately rather than a 60-second-old list.
 *
 * A Server Component, so the list arrives as HTML with no client-side loading
 * flash. The only JavaScript on this page is the publish/unpublish buttons and
 * sign-out.
 */
export const dynamic = 'force-dynamic'

export default async function AdminDashboard() {
  const dict = getDictionary()

  // Both states in parallel. Two Queries against the same GSI on different
  // partitions — neither is a Scan, and serialising them would double the
  // dashboard's time to first byte for no reason.
  const [drafts, published] = await Promise.all([
    listArticlesForAdmin('DRAFT'),
    listArticlesForAdmin('PUBLISHED'),
  ])

  return (
    <Container>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{dict.admin.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{dict.admin.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <SignOutButton />
          <Link href="/admin/articles/new" className={buttonVariants({ size: 'md' })}>
            {dict.admin.newArticle}
          </Link>
        </div>
      </div>

      <section className="mt-10" aria-labelledby="drafts-heading">
        <h2
          id="drafts-heading"
          className="mb-3 font-display text-sm font-bold tracking-wide uppercase"
        >
          {dict.admin.list.drafts}
        </h2>
        <ArticleTable status="DRAFT" result={drafts} />
      </section>

      <section className="mt-10" aria-labelledby="published-heading">
        <h2
          id="published-heading"
          className="mb-3 font-display text-sm font-bold tracking-wide uppercase"
        >
          {dict.admin.list.published}
        </h2>
        <ArticleTable status="PUBLISHED" result={published} />
      </section>
    </Container>
  )
}
