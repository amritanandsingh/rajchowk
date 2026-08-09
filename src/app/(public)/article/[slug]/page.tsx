import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Container } from '@/components/ui/container'
import { getPublishedArticle, listPublishedArticlesHourly } from '@/lib/amplify/queries'
import { formatLongDate, isoDateTime } from '@/lib/format'
import { getDictionary } from '@/lib/i18n/hi'
import { MarkdownContent } from '@/lib/markdown/markdown-content'

export const revalidate = 60

/**
 * Prerender the current feed at build time; everything else is generated on
 * first request and then cached.
 *
 * `dynamicParams` defaults to true, which is what makes that work — an article
 * published after the build is not in this list, and must still resolve rather
 * than 404. Setting it to false would make every new article invisible until
 * the next deploy.
 */
export async function generateStaticParams() {
  const { items } = await listPublishedArticlesHourly({ limit: 24 })
  return items.map((article) => ({ slug: article.slug }))
}

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const article = await getPublishedArticle(slug)

  /**
   * A draft and a missing article are indistinguishable here by design — the
   * resolver returns NotFound for both, so an unpublished headline cannot be
   * confirmed by probing the URL.
   *
   * WHY `robots: noindex` IS SET EXPLICITLY.
   *
   * On Next.js 15.5.22 `notFound()` renders the not-found UI but responds
   * HTTP **200**, not 404 — reproduced against a minimal next.config.ts and
   * Next's own default not-found page, so it is framework behaviour and not
   * something this app causes. An unknown slug is therefore a SOFT 404: a
   * crawler sees a successful response.
   *
   * Next does emit its own `<meta name="robots" content="noindex">` for
   * `notFound()`, so the indexing risk is already covered by the framework —
   * this is not the only thing standing between us and indexed garbage. It is
   * here to add `nofollow`, and to make the protection explicit and testable
   * rather than an implicit framework detail that a future upgrade could
   * change without anyone noticing. e2e/public.spec.ts pins it.
   */
  if (!article) {
    return {
      title: getDictionary().article.notFound.title,
      robots: { index: false, follow: false },
    }
  }

  return {
    title: article.title,
    description: article.summary,
    alternates: { canonical: `/article/${article.slug}` },
    openGraph: {
      type: 'article',
      title: article.title,
      description: article.summary,
      url: `/article/${article.slug}`,
      ...(article.publishedAt ? { publishedTime: article.publishedAt } : {}),
      ...(article.authorName ? { authors: [article.authorName] } : {}),
    },
  }
}

export default async function ArticlePage({ params }: Props) {
  const dict = getDictionary()
  const { slug } = await params
  const article = await getPublishedArticle(slug)

  if (!article) notFound()

  const published = formatLongDate(article.publishedAt)

  return (
    <Container width="prose">
      <article>
        <header className="border-b border-border pb-6">
          <h1 className="font-display text-3xl font-bold text-balance sm:text-4xl">
            {article.title}
          </h1>

          <p className="mt-4 text-lg text-fg-muted">{article.summary}</p>

          <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-subtle">
            {article.authorName && (
              <>
                <span>{article.authorName}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            {published && <time dateTime={isoDateTime(article.publishedAt)}>{published}</time>}
          </p>
        </header>

        {/*
          The only place authored Markdown becomes DOM. Sanitised on the hast
          tree and rendered to a React element tree — never an HTML string, so
          there is no dangerouslySetInnerHTML anywhere on this path.
        */}
        <div className="mt-8">
          <MarkdownContent source={article.content} />
        </div>
      </article>

      <nav className="mt-12 border-t border-border pt-6">
        <Link href="/" className="text-sm font-semibold text-brand hover:text-brand-hover">
          <span aria-hidden="true">←</span> {dict.article.backToFeed}
        </Link>
      </nav>
    </Container>
  )
}
