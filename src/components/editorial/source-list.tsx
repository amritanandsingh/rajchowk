import { ExternalLink } from 'lucide-react'
import type { Dictionary } from '@/lib/i18n'
import { safeHref } from '@/lib/markdown/safe-href'

type Source = {
  id: string
  title: string
  publisher?: string | null
  url?: string | null
  archiveUrl?: string | null
  publishedAt?: string | null
  accessedAt?: string | null
  verificationNote?: string | null
}

/**
 * The sources behind a story.
 *
 * Listing them is the other half of the fact/opinion separation: a
 * "Verified Fact" label means nothing if the reader cannot check it. Every URL
 * goes through safeHref, and an unsafe one renders as plain text rather than
 * being dropped — a source the reader cannot click is still a source they can
 * look up.
 */
export function SourceList({
  sources,
  dict,
  headingLevel = 2,
}: {
  sources: Source[]
  dict: Dictionary
  headingLevel?: 2 | 3
}) {
  if (sources.length === 0) return null

  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const ordered = [...sources].sort((a, b) => a.title.localeCompare(b.title, 'hi'))

  return (
    <section id="sources" aria-labelledby="sources-heading" className="my-8 scroll-mt-20">
      <Heading id="sources-heading" className="font-display text-xl font-bold sm:text-2xl">
        {dict.article.sources}
      </Heading>

      <ol className="mt-4 space-y-3">
        {ordered.map((source, index) => {
          const href = safeHref(source.url)
          return (
            <li
              key={source.id}
              className="rounded-card border border-border bg-surface p-3 text-sm"
            >
              <div className="flex gap-3">
                <span aria-hidden="true" className="font-mono text-fg-subtle">
                  {index + 1}.
                </span>
                <div className="min-w-0">
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="font-medium text-brand underline hover:text-brand-hover"
                    >
                      {source.title}
                      <ExternalLink aria-hidden="true" className="ms-1 inline size-3.5" />
                      <span className="sr-only"> {dict.common.opensInNewWindow}</span>
                    </a>
                  ) : (
                    <span className="font-medium">{source.title}</span>
                  )}

                  <p className="mt-1 text-fg-muted">
                    {[source.publisher, source.publishedAt ? formatDate(source.publishedAt) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>

                  {source.verificationNote && (
                    <p className="mt-1 text-fg-muted italic">{source.verificationNote}</p>
                  )}

                  {source.archiveUrl && safeHref(source.archiveUrl) && (
                    <a
                      href={safeHref(source.archiveUrl) as string}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="mt-1 inline-block text-xs text-fg-subtle underline"
                    >
                      संग्रहीत प्रति
                    </a>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
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
