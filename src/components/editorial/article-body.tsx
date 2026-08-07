import type { Dictionary } from '@/lib/i18n'
import { MarkdownContent } from '@/lib/markdown/markdown-content'
import type { PublicArticle } from '@/lib/amplify/queries'
import { EditorialBadge } from './editorial-badge'
import { LabeledBlock } from './labeled-block'
import { SourceList } from './source-list'
import { YouTubeEmbed } from './youtube-embed'

/**
 * Composes an article's editorial blocks in reading order.
 *
 * The order is the product's engagement loop, not an arbitrary layout:
 *   correction notice → what happened → key facts → the story →
 *   the video → my analysis → my conclusion → sources
 *
 * Fact-bearing blocks come before opinion-bearing ones, every one of them is
 * labelled, and the sources close the piece. A reader who stops halfway has
 * read facts, not opinion presented as fact.
 */
export function ArticleBody({ article, dict }: { article: PublicArticle; dict: Dictionary }) {
  const keyFacts = (article.keyFacts ?? []).filter(
    (fact): fact is string => typeof fact === 'string' && fact.trim().length > 0,
  )

  return (
    <div lang={article.language === 'EN' ? 'en' : 'hi'}>
      {article.correctionNotice && (
        <LabeledBlock
          id="correction"
          title={dict.article.correction}
          badge="CORRECTION"
          tone="correction"
          dict={dict}
        >
          <MarkdownContent source={article.correctionNotice} profile="inline" />
          {article.correctedAt && (
            <p className="mt-2 text-sm text-fg-muted">{formatDate(article.correctedAt)}</p>
          )}
        </LabeledBlock>
      )}

      {article.factualSummary && (
        <LabeledBlock
          id="what-happened"
          title={dict.article.whatHappened}
          badge="VERIFIED_FACT"
          tone="fact"
          dict={dict}
        >
          <MarkdownContent source={article.factualSummary} profile="inline" />
        </LabeledBlock>
      )}

      {keyFacts.length > 0 && (
        <LabeledBlock
          id="key-facts"
          title={dict.article.importantFacts}
          badge="VERIFIED_FACT"
          tone="fact"
          dict={dict}
        >
          <ul className="list-disc space-y-2 ps-6 text-article">
            {keyFacts.map((fact, index) => (
              <li key={index}>
                <MarkdownContent source={fact} profile="inline" />
              </li>
            ))}
          </ul>
        </LabeledBlock>
      )}

      {/* No wrapper class. `prose-article` used to be here and was defined
          NOWHERE — not in globals.css, and @tailwindcss/typography is not a
          dependency — so it styled nothing while looking like it styled
          everything. MarkdownContent gives each element its own classes. */}
      {article.bodyMarkdown && <MarkdownContent source={article.bodyMarkdown} profile="full" />}

      {article.youtubeVideoId && (
        <section aria-label={dict.article.watchAnalysis} className="my-8">
          <h2 className="mb-3 font-display text-xl font-bold sm:text-2xl">
            {dict.article.watchAnalysis}
          </h2>
          <YouTubeEmbed videoId={article.youtubeVideoId} title={article.title} />
        </section>
      )}

      {article.analysisMarkdown && (
        <LabeledBlock
          id="my-analysis"
          title={dict.article.myAnalysis}
          badge="MY_ANALYSIS"
          tone="analysis"
          dict={dict}
        >
          {/* headingOffset pushes any h2 inside the analysis to h3, so nesting
              a block inside a section keeps the document outline legal. */}
          <MarkdownContent source={article.analysisMarkdown} profile="full" headingOffset={1} />
        </LabeledBlock>
      )}

      {article.conclusionMarkdown && (
        <LabeledBlock
          id="my-conclusion"
          title={dict.article.myConclusion}
          badge="OPINION"
          tone="opinion"
          dict={dict}
        >
          <MarkdownContent source={article.conclusionMarkdown} profile="inline" />
        </LabeledBlock>
      )}

      <SourceList
        // The generated type permits null entries in the array, so filter
        // rather than assert — a null source would crash the list renderer.
        sources={(article.sources ?? []).filter(
          (source): source is NonNullable<typeof source> => source !== null && source !== undefined,
        )}
        dict={dict}
      />
    </div>
  )
}

/** Shown alongside the headline, above the body. */
export function ArticleMeta({ article, dict }: { article: PublicArticle; dict: Dictionary }) {
  const isOpinion = article.contentType === 'OPINION' || article.contentType === 'EDITORIAL'

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fg-muted">
      {isOpinion && <EditorialBadge kind="OPINION" dict={dict} />}
      <span>
        {dict.article.by}{' '}
        <strong className="text-fg">{article.bylineOverride ?? article.authorDisplayName}</strong>
      </span>
      {article.publishedAt && (
        <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
      )}
      {article.readingMinutes ? (
        <span>{dict.article.readingTime.replace('{minutes}', String(article.readingMinutes))}</span>
      ) : null}
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('hi-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}
