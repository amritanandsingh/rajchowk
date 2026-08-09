import { NewsletterTokenAction } from '@/components/forms/newsletter-token-action'
import { Container } from '@/components/ui/container'
type Props = { searchParams: Promise<{ id?: string; signature?: string }> }
export default async function NewsletterUnsubscribePage({ searchParams }: Props) {
  const { id = '', signature = '' } = await searchParams
  return (
    <Container width="form">
      <NewsletterTokenAction action="unsubscribe" id={id} token={signature} />
    </Container>
  )
}
