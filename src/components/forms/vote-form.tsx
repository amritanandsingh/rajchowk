'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import type { PublicPoll } from '@/lib/amplify/queries'
import { useAnnounce, useDictionary } from '@/components/providers'
import { Button } from '@/components/ui/button'
import { userPoolDataClient, readableAmplifyError } from '@/lib/amplify/browser-client'
import { interpolate } from '@/lib/format'
import { TextArea } from './form-field'

export function VoteForm({ poll }: { poll: PublicPoll }) {
  const dict = useDictionary()
  const announce = useAnnounce()
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ message: string; total?: number } | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) {
      setResult({ message: dict.poll.selectFirst })
      return
    }
    const form = new FormData(event.currentTarget)
    setLoading(true)
    try {
      const response = await userPoolDataClient.mutations.castVote({
        pollId: poll.id,
        pollOptionId: selected,
        explanation: String(form.get('explanation') ?? '').trim() || null,
      })
      if (response.errors?.length) throw new Error(response.errors[0]?.message)
      const message = response.data?.ok
        ? dict.poll.voted
        : (response.data?.message ?? dict.errors.generic)
      setResult({
        message,
        ...(response.data?.totalVotes == null ? {} : { total: response.data.totalVotes }),
      })
      announce(message, response.data?.ok ? 'polite' : 'assertive')
    } catch (error) {
      const message = readableAmplifyError(error)
      setResult({ message })
      announce(message, 'assertive')
    } finally {
      setLoading(false)
    }
  }

  const total = result?.total ?? poll.totalVotes ?? 0
  const options = (poll.options ?? []).filter((option): option is NonNullable<typeof option> =>
    Boolean(option),
  )
  if (poll.status !== 'OPEN') return <PollResults poll={poll} total={total} />
  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className="sr-only">{poll.question}</legend>
        <div className="grid gap-3">
          {options.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer gap-3 rounded-card border border-border-strong bg-surface p-4 has-[:checked]:border-brand has-[:checked]:bg-brand-subtle"
            >
              <input
                type="radio"
                name="option"
                value={option.id}
                checked={selected === option.id}
                onChange={() => setSelected(option.id)}
                className="mt-1 size-5"
              />
              <span>
                <span className="font-semibold">{option.label}</span>
                {option.description && (
                  <span className="mt-1 block text-sm text-fg-muted">{option.description}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {poll.requestExplanation && (
        <label className="block text-sm font-semibold">
          {dict.poll.explainPrompt}
          <TextArea name="explanation" maxLength={500} />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={loading}>
          {dict.poll.vote}
        </Button>
        <Link href="/auth/sign-in" className="text-sm">
          {dict.poll.signInToVote}
        </Link>
      </div>
      {result && (
        <p role="status" className="rounded-card bg-brand-subtle p-3 text-sm">
          {result.message}
        </p>
      )}{' '}
      {poll.showResultsBeforeVoting && <PollResults poll={poll} total={total} />}
    </form>
  )
}

function PollResults({ poll, total }: { poll: PublicPoll; total: number }) {
  const dict = useDictionary()
  const options = (poll.options ?? []).filter((option): option is NonNullable<typeof option> =>
    Boolean(option),
  )
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold">{dict.poll.results}</h2>
      {options.map((option) => {
        const count = option.voteCount ?? 0
        const percent = total ? Math.round((count / total) * 100) : 0
        return (
          <div key={option.id}>
            <div className="mb-1 flex justify-between gap-3 text-sm">
              <span>{option.label}</span>
              <span>{percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-bg-subtle">
              <div className="h-full bg-brand" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )
      })}
      <p className="text-sm text-fg-muted">{interpolate(dict.poll.totalVotes, { count: total })}</p>
      <p className="text-xs text-fg-subtle">{dict.poll.disclaimer}</p>
    </div>
  )
}
