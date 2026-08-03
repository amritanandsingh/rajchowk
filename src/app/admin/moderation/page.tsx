import { ModerationQueue } from '@/components/admin/moderation-queue'
import { PageHeader } from '@/components/site/page-header'
export default function ModerationPage() {
  return (
    <main id="content" className="mx-auto max-w-4xl px-4 py-10">
      <PageHeader title="मॉडरेशन कतार" />
      <ModerationQueue />
    </main>
  )
}
