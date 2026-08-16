import type { ArticleCard as ArticleCardData } from '@/lib/amplify/queries'
import { EmptyState, ErrorState } from '@/components/state/states'
import { getDictionary } from '@/lib/i18n/hi'
import { ArticleCard } from './article-card'

/**
 * The feed.
 *
 * Owns the empty and error states rather than leaving them to each caller,
 * which is what stops "the API failed" from rendering as a blank page. The
 * distinction it draws is the one the data layer cannot: `queries.ts` returns
 * an empty page on failure AND on genuine emptiness, so the PAGE has to tell
 * this component which happened.
 *
 * A plain <ul> rather than a grid of cards at every breakpoint. A single
 * column reads like a publication; a three-across card grid reads like a
 * dashboard, and the product is meant to feel like the former.
 */
export function ArticleList({
  articles,
  failed = false,
  /** Renders the first item larger. Homepage only — a lead story needs a feed
   *  above it to lead. */
  featureFirst = false,
  /**
   * Overrides the "nothing published yet" copy.
   *
   * Search needs this and it is not cosmetic: a search that matches nothing
   * would otherwise tell the reader "अभी कोई लेख प्रकाशित नहीं हुआ है" — no
   * articles have been published — which is false, and which sends them away
   * from a site that is in fact full of articles. Empty-because-you-searched
   * and empty-because-nothing-exists are different facts.
   *
   * Declared `| undefined` explicitly: `exactOptionalPropertyTypes` is on, so
   * an absent key and an explicit undefined are not the same type.
   */
  empty,
}: {
  articles: readonly ArticleCardData[]
  failed?: boolean
  featureFirst?: boolean
  empty?: { title: string; description: string } | undefined
}) {
  const dict = getDictionary()

  if (failed) {
    return <ErrorState title={dict.feed.error.title} description={dict.feed.error.description} />
  }

  if (articles.length === 0) {
    const state = empty ?? dict.feed.empty
    return <EmptyState title={state.title} description={state.description} />
  }

  return (
    <ul className="space-y-5">
      {articles.map((article, index) => (
        <li key={article.id}>
          <ArticleCard article={article} featured={featureFirst && index === 0} />
        </li>
      ))}
    </ul>
  )
}
