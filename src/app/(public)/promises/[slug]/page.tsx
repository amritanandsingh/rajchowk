import { ExternalLink } from 'lucide-react'
import { notFound } from 'next/navigation'
import { PromiseStatus } from '@/components/promises/promise-status'
import { getPromise } from '@/lib/amplify/queries'
import { formatDate } from '@/lib/format'
import { Container } from '@/components/ui/container'

export const revalidate = 300
type Props = { params: Promise<{ slug: string }> }

export default async function PromisePage({ params }: Props) {
  const { slug } = await params
  const promise = await getPromise(slug)
  if (!promise) notFound()
  return (
    <Container width="prose">
      <article>
        <PromiseStatus status={promise.status} />
        <h1 className="mt-4 font-display text-3xl font-bold sm:text-4xl">{promise.title}</h1>
        <p className="mt-3 text-lg font-semibold">
          {promise.politician} · {promise.party}
        </p>
        <dl className="mt-6 grid gap-4 rounded-card bg-bg-subtle p-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-bold text-fg-muted">वादा किया</dt>
            <dd>{formatDate(promise.dateMade)}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-fg-muted">समय सीमा</dt>
            <dd>{formatDate(promise.targetDate) || 'निर्दिष्ट नहीं'}</dd>
          </div>
          {promise.state && (
            <div>
              <dt className="text-xs font-bold text-fg-muted">राज्य</dt>
              <dd>{promise.state}</dd>
            </div>
          )}
          {promise.constituency && (
            <div>
              <dt className="text-xs font-bold text-fg-muted">निर्वाचन क्षेत्र</dt>
              <dd>{promise.constituency}</dd>
            </div>
          )}
        </dl>
        <section className="mt-8">
          <h2 className="text-2xl font-bold">मूल वादा</h2>
          <p className="mt-3 text-lg leading-8">{promise.promiseText}</p>
          {promise.sourceUrl && (
            <a
              href={promise.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1"
            >
              मूल स्रोत <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          )}
        </section>
        {promise.assessment && (
          <section className="mt-8 rounded-card border-l-4 border-brand bg-brand-subtle p-5">
            <h2 className="text-2xl font-bold">हमारा आकलन</h2>
            <p className="mt-3 leading-7">{promise.assessment}</p>
            {promise.assessmentMethod && (
              <p className="mt-4 text-sm text-fg-muted">
                <strong>तरीका:</strong> {promise.assessmentMethod}
              </p>
            )}
          </section>
        )}
        {(promise.evidenceUrls ?? []).length > 0 && (
          <section className="mt-8">
            <h2 className="text-2xl font-bold">प्रमाण</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              {promise.evidenceUrls
                ?.filter((url): url is string => Boolean(url))
                .map((url, index) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      प्रमाण {index + 1}
                    </a>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </article>
    </Container>
  )
}
