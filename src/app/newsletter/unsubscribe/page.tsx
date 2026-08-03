import { NewsletterTokenAction } from '@/components/forms/newsletter-token-action'
type Props = { searchParams: Promise<{ id?: string; signature?: string }> }
export default async function NewsletterUnsubscribePage({ searchParams }: Props) {
  const { id = '', signature = '' } = await searchParams
  return (
    <main id="content" className="px-4 py-16">
      <NewsletterTokenAction action="unsubscribe" id={id} token={signature} />
    </main>
  )
}
