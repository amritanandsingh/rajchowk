import { NewsletterTokenAction } from '@/components/forms/newsletter-token-action'
type Props = { searchParams: Promise<{ id?: string; token?: string }> }
export default async function NewsletterVerifyPage({ searchParams }: Props) {
  const { id = '', token = '' } = await searchParams
  return (
    <main id="content" className="px-4 py-16">
      <NewsletterTokenAction action="verify" id={id} token={token} />
    </main>
  )
}
