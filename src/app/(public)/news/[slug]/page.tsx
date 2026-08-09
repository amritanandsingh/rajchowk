import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound, permanentRedirect } from 'next/navigation'
import { Suspense } from 'react'
import { ArticleBody, ArticleMeta } from '@/components/editorial/article-body'
import { CommentsSection } from '@/components/editorial/comments-section'
import { JsonLd } from '@/components/seo/json-ld'
import {
  getArticleBySlug,
  getSlugRedirect,
  listApprovedComments,
  listPublishedArticles,
} from '@/lib/amplify/queries'
import { absoluteUrl, env } from '@/lib/env'
import { DEFAULT_LOCALE, getDictionary, OG_LOCALES } from '@/lib/i18n'
import { mediaUrl } from '@/lib/media'
import { buildArticleLd, buildBreadcrumbLd } from '@/lib/seo/jsonld'
import { Container } from '@/components/ui/container'

/**
 * The article page — the reference implementation for every public route.
 *
 * CACHING: Amplify Hosting does not support on-demand ISR, so
 * `revalidate` is the only freshness mechanism available; revalidateTag() and
 * revalidatePath() silently do nothing in production. Publish-to-live is
 * therefore ~60 seconds. Editors get an authenticated instant preview at
 * /preview/[id] rather than waiting on this. See docs/architecture.md.
 */
export const revalidate = 60
export const dynamicParams = true

type Props = { params: Promise<{ slug: string }> }

/**
 * Comments, fetched inside their own Suspense boundary.
 *
 * The await has to live in a child component, not in the page body: this is a
 * SECOND AppSync round trip that cannot start until the article resolves (it
 * needs article.id), and while it sat in the page it blocked the headline on a
 * section that is below the fold and below the entire article body. Streaming
 * it means first paint no longer waits for it.
 */
async function Comments({
  articleId,
  allowComments,
  dict,
}: {
  articleId: string
  allowComments: boolean
  dict: ReturnType<typeof getDictionary>
}) {
  const { items } = await listApprovedComments(articleId, { limit: 20 })
  return (
    <CommentsSection
      articleId={articleId}
      comments={items}
      allowComments={allowComments}
      dict={dict}
    />
  )
}

function CommentsFallback() {
  return (
    <div aria-busy="true" className="mt-12 space-y-3">
      <div className="h-7 w-40 animate-pulse rounded bg-bg-subtle" />
      <div className="h-24 animate-pulse rounded-card bg-bg-subtle" />
    </div>
  )
}

/**
 * Prerender the most recent articles at build time; everything older is
 * generated on first request and then cached.
 */
export async function generateStaticParams() {
  const { items } = await listPublishedArticles({ contentType: 'NEWS', limit: 24 })
  return items.map((article) => ({ slug: article.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  // React cache() means this shares one AppSync request with the page below.
  const article = await getArticleBySlug(slug)

  if (!article) {
    return { title: 'नहीं मिला', robots: { index: false, follow: false } }
  }

  const path = `${article.contentType === 'OPINION' ? '/opinion' : '/news'}/${article.slug}`
  const locale = article.language === 'EN' ? 'en' : 'hi'
  const imageUrl = article.socialImageKey ?? article.heroImageKey ?? undefined

  return {
    title: article.seoTitle ?? article.title,
    description: article.seoDescription ?? article.excerpt ?? undefined,
    alternates: {
      // Always absolute, always the unprefixed path. A self-referencing
      // canonical is what collapses the ?utm_*/?fbclid duplicates that a
      // WhatsApp-shared audience generates in volume.
      canonical: absoluteUrl(path),
    },
    openGraph: {
      type: 'article',
      url: absoluteUrl(path),
      title: article.title,
      description: article.excerpt ?? undefined,
      locale: OG_LOCALES[locale],
      siteName: env.NEXT_PUBLIC_SITE_NAME,
      ...(article.publishedAt ? { publishedTime: article.publishedAt } : {}),
      ...(article.updatedAt ? { modifiedTime: article.updatedAt } : {}),
      ...(article.authorDisplayName ? { authors: [article.authorDisplayName] } : {}),
      ...(imageUrl ? { images: [{ url: imageUrl, width: 1200, height: 630 }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: article.title,
      description: article.excerpt ?? undefined,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
  }
}

export default async function NewsArticlePage({ params }: Props) {
  const { slug } = await params
  const dict = getDictionary(DEFAULT_LOCALE)
  const article = await getArticleBySlug(slug)

  if (!article) {
    // Slug changed? Redirect data lives in DynamoDB, so this cannot be a
    // build-time next.config redirect. Doing it here rather than in middleware
    // keeps the DynamoDB round trip off the 99.9% of requests that resolve
    // fine — Next stores the redirect as this slug's ISR cache entry.
    const target = await getSlugRedirect(slug)
    if (target) permanentRedirect(`/news/${target}`)
    notFound()
  }

  // Canonicalise: an old-but-still-resolving slug redirects to the current one.
  if (article.slug !== slug) permanentRedirect(`/news/${article.slug}`)

  const path = `${article.contentType === 'OPINION' ? '/opinion' : '/news'}/${article.slug}`
  const heroImage = mediaUrl(article.heroImageKey)

  return (
    <>
      <JsonLd
        data={[
          buildArticleLd(article, {
            path,
            imageUrl: article.socialImageKey ?? article.heroImageKey ?? null,
          }),
          buildBreadcrumbLd([
            { name: dict.nav.home, path: '/' },
            { name: dict.nav.latest, path: '/latest' },
            { name: article.title, path },
          ]),
        ]}
      />

      <Container width="prose">
        <article>
          <header className="mb-8">
            <h1 className="font-display text-3xl leading-tight font-bold text-balance sm:text-4xl">
              {article.title}
            </h1>
            {article.subtitle && <p className="mt-3 text-lg text-fg-muted">{article.subtitle}</p>}
            <div className="mt-4">
              <ArticleMeta article={article} dict={dict} />
            </div>
          </header>

          {heroImage && (
            <figure className="mb-8">
              <div className="relative aspect-video overflow-hidden rounded-card bg-bg-subtle">
                <Image
                  src={heroImage}
                  alt={article.heroImageAlt ?? ''}
                  fill
                  priority
                  sizes="(min-width: 768px) 768px, 100vw"
                  className="object-cover"
                />
              </div>
              {article.heroImageCredit && (
                <figcaption className="mt-2 text-xs text-fg-muted">
                  {article.heroImageCredit}
                </figcaption>
              )}
            </figure>
          )}

          <ArticleBody article={article} dict={dict} />
          <Suspense fallback={<CommentsFallback />}>
            <Comments
              articleId={article.id}
              allowComments={article.allowComments !== false}
              dict={dict}
            />
          </Suspense>
        </article>
      </Container>
    </>
  )
}
