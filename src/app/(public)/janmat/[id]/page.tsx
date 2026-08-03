import { notFound } from 'next/navigation'
import { VoteForm } from '@/components/forms/vote-form'
import { getPoll } from '@/lib/amplify/queries'
import { formatDate } from '@/lib/format'

export const revalidate = 30
type Props = { params: Promise<{ id: string }> }

export default async function PollPage({ params }: Props) {
  const { id } = await params
  const poll = await getPoll(id)
  if (!poll) notFound()
  return (
    <main id="content" tabIndex={-1} className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <article>
        <p className="text-sm font-bold text-accent">जनमत</p>
        <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{poll.question}</h1>
        {poll.description && <p className="mt-3 text-fg-muted">{poll.description}</p>}
        {poll.closesAt && (
          <p className="mt-3 text-sm text-fg-subtle">
            बंद होने की तारीख: {formatDate(poll.closesAt)}
          </p>
        )}
        <div className="mt-8">
          <VoteForm poll={poll} />
        </div>
      </article>
    </main>
  )
}
