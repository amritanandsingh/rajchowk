import type { Metadata } from 'next'
import { SearchForm } from '@/components/forms/search-form'
import { PageHeader } from '@/components/site/page-header'

export const metadata: Metadata = {
  title: 'खोज',
  alternates: { canonical: '/search' },
  robots: { index: false, follow: true },
}
type Props = { searchParams: Promise<{ q?: string }> }
export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams
  return (
    <main id="content" tabIndex={-1} className="mx-auto min-h-[50vh] max-w-3xl px-4 py-8 sm:py-10">
      <PageHeader title="खोज" description="खबरें, सवाल और वादे खोजें।" />
      <SearchForm initialQuery={q ?? ''} />
    </main>
  )
}
