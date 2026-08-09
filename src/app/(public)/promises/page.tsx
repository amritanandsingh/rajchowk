import Link from 'next/link'
import type { Metadata } from 'next'
import { PromiseStatus } from '@/components/promises/promise-status'
import { EmptyState } from '@/components/site/empty-state'
import { PageHeader } from '@/components/site/page-header'
import { listPromisesSlow } from '@/lib/amplify/queries'
import { formatDate } from '@/lib/format'
import { Container } from '@/components/ui/container'

export const revalidate = 300
export const metadata: Metadata = { title: 'वादा ट्रैकर', alternates: { canonical: '/promises' } }

export default async function PromisesPage() {
  const { items } = await listPromisesSlow({ limit: 24 })
  return (
    <Container>
      <PageHeader
        title="वादा ट्रैकर"
        description="सार्वजनिक वादों की दस्तावेज़ी जाँच—स्रोत, सबूत और हमारे आकलन के साथ।"
      />
      {items.length ? (
        <div className="grid gap-5 md:grid-cols-2">
          {items.map((promise) => (
            <article
              key={promise.id}
              className="rounded-card border border-border bg-surface p-5 shadow-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <PromiseStatus status={promise.status} />
                <span className="text-xs text-fg-muted">{promise.party}</span>
              </div>
              <h2 className="mt-4 text-xl font-bold">
                <Link
                  href={`/promises/${promise.slug}`}
                  className="text-fg no-underline hover:text-brand"
                >
                  {promise.title}
                </Link>
              </h2>
              <p className="mt-2 text-sm font-semibold">{promise.politician}</p>
              <p className="mt-3 line-clamp-3 text-sm text-fg-muted">{promise.promiseText}</p>
              {promise.lastVerifiedAt && (
                <p className="mt-4 text-xs text-fg-subtle">
                  अंतिम जाँच: {formatDate(promise.lastVerifiedAt)}
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="अभी कोई सार्वजनिक वादा प्रकाशित नहीं है" />
      )}
    </Container>
  )
}
