import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ArticleForm } from '@/components/admin/article-form'
import { Container } from '@/components/ui/container'
import { getArticleForEdit } from '@/lib/amplify/admin-queries'
import { getDictionary } from '@/lib/i18n/hi'

export const metadata: Metadata = {
  title: 'लेख संपादित करें',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export default async function EditArticlePage({ params }: Props) {
  const dict = getDictionary()
  const { id } = await params

  const article = await getArticleForEdit(id)

  /**
   * Covers three cases with one branch, and that is correct rather than lazy:
   * the article does not exist, it was deleted, or AppSync refused the read.
   * The third cannot happen to a legitimate admin — middleware already
   * established the group — so from this page's point of view all three mean
   * "there is nothing here to edit".
   */
  if (!article) notFound()

  return (
    <Container width="form">
      <nav className="mb-6">
        <Link href="/admin" className="text-sm font-semibold text-brand hover:text-brand-hover">
          <span aria-hidden="true">←</span> {dict.admin.title}
        </Link>
      </nav>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">{dict.admin.form.editTitle}</h1>
        <p className="mt-1 text-sm text-fg-muted">{dict.admin.status[article.status]}</p>
      </div>

      {/*
        `key` forces a fresh mount when the id changes. Without it, navigating
        from editing one article to another would reuse the component instance,
        and the form's idempotency ref would still hold the PREVIOUS article's
        id — so saving the second article would write over the first.
      */}
      <ArticleForm
        key={article.id}
        initial={{
          id: article.id,
          title: article.title,
          slug: article.slug,
          summary: article.summary,
          content: article.content,
        }}
      />
    </Container>
  )
}
