import { randomUUID } from 'node:crypto'

import type { Metadata } from 'next'
import Link from 'next/link'

import { ArticleForm } from '@/components/admin/article-form'
import { Container } from '@/components/ui/container'
import { getDictionary } from '@/lib/i18n/hi'

export const metadata: Metadata = {
  title: 'नया लेख',
  robots: { index: false, follow: false },
}

/**
 * `force-dynamic` for a reason that is easy to miss: the id below.
 *
 * If this page were static, every editor loading /admin/articles/new would
 * receive the SAME prerendered id, and the second article created would
 * collide with the first on `attribute_not_exists(id)` — the idempotency
 * mechanism would silently turn two different articles into one duplicate
 * response. The id must be minted per request.
 */
export const dynamic = 'force-dynamic'

export default function NewArticlePage() {
  const dict = getDictionary()

  /**
   * The idempotency key, generated ONCE per page load and held in a ref by the
   * form for the life of the mount.
   *
   * `node:crypto` on the server rather than `crypto.randomUUID()` in the
   * browser: the latter is unavailable on insecure origins, which includes
   * some LAN-address dev setups, and a form whose duplicate-submit protection
   * silently disappears in one environment is worse than one that never had it.
   */
  const articleId = randomUUID()

  return (
    <Container width="form">
      <nav className="mb-6">
        <Link href="/admin" className="text-sm font-semibold text-brand hover:text-brand-hover">
          <span aria-hidden="true">←</span> {dict.admin.title}
        </Link>
      </nav>

      <h1 className="mb-6 font-display text-2xl font-bold">{dict.admin.form.newTitle}</h1>

      <ArticleForm initial={{ id: articleId, title: '', slug: '', summary: '', content: '' }} />
    </Container>
  )
}
