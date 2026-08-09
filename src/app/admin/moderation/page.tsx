import { ModerationQueue } from '@/components/admin/moderation-queue'
import { PageHeader } from '@/components/site/page-header'
import { Container } from '@/components/ui/container'
export default function ModerationPage() {
  return (
    <Container width="prose">
      <PageHeader title="मॉडरेशन कतार" />
      <ModerationQueue />
    </Container>
  )
}
