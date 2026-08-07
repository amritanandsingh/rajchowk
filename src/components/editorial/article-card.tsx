import Image from 'next/image'
import Link from 'next/link'
import { Clock3, MessageCircle } from 'lucide-react'
import type { ArticleCard as ArticleCardData } from '@/lib/amplify/queries'
import { formatDate } from '@/lib/format'
import { mediaUrl } from '@/lib/media'
import { cardVariants } from '@/components/ui/card'
import { cn } from '@/lib/utils/cn'

const typeLabels: Record<string, string> = {
  NEWS: 'खबर',
  OPINION: 'राय',
  ANALYSIS: 'विश्लेषण',
  EXPLAINER: 'समझिए',
  FACT_CHECK: 'फैक्ट चेक',
  INTERVIEW: 'इंटरव्यू',
  EDITORIAL: 'संपादकीय',
}

export function articlePath(article: Pick<ArticleCardData, 'slug' | 'contentType'>): string {
  return `${article.contentType === 'OPINION' ? '/opinion' : '/news'}/${article.slug}`
}

export function ArticleCard({
  article,
  featured = false,
}: {
  article: ArticleCardData
  featured?: boolean
}) {
  const image = mediaUrl(article.heroImageKey)
  const path = articlePath(article)
  return (
    <article
      className={cn(
        cardVariants({ variant: 'surface', padding: 'none' }),
        'group overflow-hidden',
        featured && 'md:grid md:grid-cols-2',
      )}
    >
      {image && (
        <Link
          href={path}
          tabIndex={-1}
          aria-hidden="true"
          className={cn(
            'relative block aspect-video overflow-hidden bg-bg-subtle',
            featured && 'md:aspect-auto md:min-h-72',
          )}
        >
          <Image
            src={image}
            alt=""
            fill
            sizes={featured ? '(min-width: 768px) 50vw, 100vw' : '(min-width: 1024px) 33vw, 100vw'}
            // The featured card is the hero on / and /latest, which makes this
            // the LCP element on the highest-traffic page. Without `priority`
            // it is lazy-loaded like every card below the fold, so the largest
            // paint waits for the image to be discovered by the scanner rather
            // than being preloaded in the initial HTML. The article page
            // already does this; the homepage did not.
            priority={featured}
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
          />
        </Link>
      )}
      <div className={cn('p-5', featured && 'md:flex md:flex-col md:justify-center md:p-8')}>
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-bold text-accent">
          <span>{typeLabels[article.contentType ?? ''] ?? article.contentType}</span>
          {article.isBreaking && (
            <span className="rounded-full bg-accent-subtle px-2 py-1">ब्रेकिंग</span>
          )}
        </div>
        <h2
          className={cn('font-display text-xl leading-snug font-bold', featured && 'sm:text-3xl')}
        >
          <Link href={path} className="text-fg no-underline group-hover:text-brand">
            {article.title}
          </Link>
        </h2>
        {article.excerpt && (
          <p className="mt-3 line-clamp-3 text-sm text-fg-muted sm:text-base">{article.excerpt}</p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-subtle">
          {article.authorDisplayName && <span>{article.authorDisplayName}</span>}
          {article.publishedAt && (
            <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
          )}
          {!!article.readingMinutes && (
            <span className="inline-flex items-center gap-1">
              <Clock3 aria-hidden="true" className="size-3.5" />
              {article.readingMinutes} मिनट
            </span>
          )}
          {!!article.commentCount && (
            <span className="inline-flex items-center gap-1">
              <MessageCircle aria-hidden="true" className="size-3.5" />
              {article.commentCount}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
