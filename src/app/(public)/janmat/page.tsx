import Link from 'next/link'
import type { Metadata } from 'next'
import { EmptyState } from '@/components/site/empty-state'
import { PageHeader } from '@/components/site/page-header'
import { listPolls } from '@/lib/amplify/queries'
import { formatDate, interpolate } from '@/lib/format'
import { getDictionary } from '@/lib/i18n'

export const revalidate = 60
export const metadata: Metadata = { title: 'जनमत', alternates: { canonical: '/janmat' } }

export default async function JanmatPage() {
  const dict = getDictionary('hi')
  const [{ items: open }, { items: closed }] = await Promise.all([
    listPolls({ status: 'OPEN' }),
    listPolls({ status: 'CLOSED', limit: 6 }),
  ])
  const polls = [...open, ...closed]
  return (
    <main id="content" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
      <PageHeader
        title={dict.poll.title}
        description="समसामयिक मुद्दों पर अपनी राय दर्ज करें और पारदर्शी नतीजे देखें।"
      />
      {polls.length ? (
        <div className="grid gap-5 md:grid-cols-2">
          {polls.map((poll) => (
            <article
              key={poll.id}
              className="rounded-card border border-border bg-surface p-5 shadow-card"
            >
              <div className="flex justify-between gap-3">
                <span className="text-xs font-bold text-accent">
                  {poll.status === 'OPEN' ? 'खुला' : dict.poll.closed}
                </span>
                {poll.isDaily && <span className="text-xs text-fg-muted">आज का सवाल</span>}
              </div>
              <h2 className="mt-3 text-xl font-bold">
                <Link href={`/janmat/${poll.id}`} className="text-fg no-underline hover:text-brand">
                  {poll.question}
                </Link>
              </h2>
              {poll.description && <p className="mt-2 text-sm text-fg-muted">{poll.description}</p>}
              <div className="mt-4 flex flex-wrap justify-between gap-2 text-xs text-fg-subtle">
                <span>{interpolate(dict.poll.totalVotes, { count: poll.totalVotes ?? 0 })}</span>
                {poll.closesAt && (
                  <span>{dict.poll.closesOn.replace('{date}', formatDate(poll.closesAt))}</span>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="अभी कोई जनमत उपलब्ध नहीं है" />
      )}
    </main>
  )
}
