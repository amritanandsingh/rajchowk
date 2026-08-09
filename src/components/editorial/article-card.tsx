import Link from 'next/link'

import type { ArticleCard as ArticleCardData } from '@/lib/amplify/queries'
import { formatShortDate, isoDateTime } from '@/lib/format'
import { getDictionary } from '@/lib/i18n/hi'

/**
 * One article in the feed.
 *
 * THE WHOLE CARD IS THE LINK, but the anchor wraps only the TITLE and is
 * stretched over the card with `after:absolute inset-0`. Wrapping the entire
 * card in an `<a>` instead would give the link an accessible name consisting
 * of the title, the summary, the byline and the date read out as one
 * uninterrupted sentence — which is what a screen-reader user actually hears
 * on most "clickable card" implementations. This way the link is named by the
 * headline alone and the rest is ordinary text that happens to be inside the
 * click target.
 *
 * `relative` on the article plus `isolate` keeps the stretched pseudo-element
 * from escaping into a parent stacking context.
 */
export function ArticleCard({
  article,
  featured = false,
}: {
  article: ArticleCardData
  /** The lead story: larger headline, more prominent. Used for the first item
   *  on the homepage so the feed has a clear entry point rather than reading
   *  as an undifferentiated list. */
  featured?: boolean
}) {
  const dict = getDictionary()
  const published = formatShortDate(article.publishedAt)

  return (
    <article className="group relative isolate rounded-card border border-border bg-surface p-5 transition-shadow hover:shadow-card motion-reduce:transition-none sm:p-6">
      <h2
        className={
          featured
            ? 'font-display text-2xl font-bold text-balance sm:text-3xl'
            : 'font-display text-lg font-bold text-balance sm:text-xl'
        }
      >
        <Link
          href={`/article/${article.slug}`}
          className="group-hover:text-brand after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
        >
          {article.title}
        </Link>
      </h2>

      <p
        className={
          featured
            ? 'mt-3 text-base text-fg-muted sm:text-lg'
            : 'mt-2 line-clamp-3 text-sm text-fg-muted'
        }
      >
        {article.summary}
      </p>

      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-subtle">
        {article.authorName && (
          <>
            <span>{article.authorName}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        {published && <time dateTime={isoDateTime(article.publishedAt)}>{published}</time>}
      </p>

      {/* Visible affordance for a mouse user, redundant for everyone else —
          hidden from assistive tech because the headline link already names
          the destination and a second "पूरा पढ़ें" would just be noise. */}
      <p aria-hidden="true" className="mt-3 text-sm font-semibold text-brand">
        {dict.feed.readMore} <span aria-hidden="true">→</span>
      </p>
    </article>
  )
}
