import { NewsletterTokenAction } from '@/components/forms/newsletter-token-action'
import { Container } from '@/components/ui/container'
type Props = { searchParams: Promise<{ id?: string; token?: string }> }
export default async function NewsletterVerifyPage({ searchParams }: Props) {
  const { id = '', token = '' } = await searchParams
  return (
    <Container width="form">
      <NewsletterTokenAction action="verify" id={id} token={token} />
    </Container>
  )
}
