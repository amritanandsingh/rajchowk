'use client'

import Link from 'next/link'
import { Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useAnnounce, useDictionary, useLocale } from '@/components/providers'
import { Button } from '@/components/ui/button'
import { guestDataClient, readableAmplifyError } from '@/lib/amplify/browser-client'
import type { Schema } from '@/../amplify/data/resource'
import { TextInput } from './form-field'

type Result = NonNullable<Schema['searchContent']['returnType']>['items'][number]

function resultPath(item: Result): string {
  if (item.entityType === 'PROMISE') return `/promises/${item.slug}`
  if (item.entityType === 'QUESTION') return '/ask'
  return `${item.contentType === 'OPINION' ? '/opinion' : '/news'}/${item.slug}`
}

export function SearchForm({ initialQuery = '' }: { initialQuery?: string }) {
  const dict = useDictionary()
  const { locale } = useLocale()
  const announce = useAnnounce()
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<Result[]>([])
  const [searched, setSearched] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = query.trim()
    if (value.length < 2) return
    setLoading(true)
    setError('')
    try {
      const response = await guestDataClient.queries.searchContent({
        query: value,
        language: locale.toUpperCase(),
        limit: 24,
      })
      if (response.errors?.length) throw new Error(response.errors[0]?.message)
      const items = response.data?.items ?? []
      setResults(items)
      setSearched(true)
      history.replaceState(null, '', `/search?q=${encodeURIComponent(value)}`)
      announce(
        items.length
          ? dict.search.resultCount.replace('{count}', String(items.length))
          : dict.search.noResults,
      )
    } catch (caught) {
      const message = readableAmplifyError(caught)
      setError(message)
      announce(message, 'assertive')
    } finally {
      setLoading(false)
    }
  }
  return (
    <>
      <form onSubmit={submit} role="search" className="flex gap-2">
        <label className="flex-1">
          <span className="sr-only">{dict.search.placeholder}</span>
          <TextInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={dict.search.placeholder}
            minLength={2}
            maxLength={120}
            required
            className="mt-0"
          />
        </label>
        <Button type="submit" loading={loading} aria-label={dict.search.submit}>
          <Search aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">{dict.search.submit}</span>
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-4 rounded-card bg-danger-subtle p-3 text-danger">
          {error}
        </p>
      )}
      {searched && (
        <section className="mt-8" aria-live="polite">
          <h2 className="text-xl font-bold">
            {dict.search.resultsFor.replace('{query}', query.trim())}
          </h2>
          {results.length ? (
            <div className="mt-4 divide-y divide-border rounded-card border border-border bg-surface">
              {results.map((item) => (
                <article key={`${item.entityType}-${item.entityId}`} className="p-5">
                  <p className="text-xs font-bold text-accent">{item.entityType}</p>
                  <h3 className="mt-1 text-lg font-bold">
                    <Link href={resultPath(item)} className="text-fg no-underline hover:text-brand">
                      {item.title}
                    </Link>
                  </h3>
                  {item.excerpt && <p className="mt-2 text-sm text-fg-muted">{item.excerpt}</p>}
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-card bg-bg-subtle p-8 text-center">
              <p className="font-bold">{dict.search.noResults}</p>
              <p className="mt-1 text-sm text-fg-muted">{dict.search.tryDifferent}</p>
            </div>
          )}
        </section>
      )}
    </>
  )
}
