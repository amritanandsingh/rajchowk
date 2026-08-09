import type { Metadata } from 'next'
import { SearchForm } from '@/components/forms/search-form'
import { PageHeader } from '@/components/site/page-header'
import { Container } from '@/components/ui/container'

export const metadata: Metadata = {
  title: 'खोज',
  alternates: { canonical: '/search' },
  robots: { index: false, follow: true },
}
type Props = { searchParams: Promise<{ q?: string }> }
export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams
  return (
    <Container width="prose">
      <PageHeader title="खोज" description="खबरें, सवाल और वादे खोजें।" />
      <SearchForm initialQuery={q ?? ''} />
    </Container>
  )
}
