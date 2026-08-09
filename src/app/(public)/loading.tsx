import { LoadingState } from '@/components/state/states'
import { Container } from '@/components/ui/container'
import { getDictionary } from '@/lib/i18n/hi'

/**
 * Streamed while the feed's data is in flight.
 *
 * Reached on a cold ISR miss — a first request after the TTL expires renders
 * this until AppSync answers. Skeleton rows rather than a spinner so the page
 * does not jump when the articles land.
 */
export default function HomeLoading() {
  const dict = getDictionary()
  return (
    <Container>
      <div className="mb-6 h-4 w-24 animate-pulse rounded bg-bg-subtle motion-reduce:animate-none" />
      <LoadingState label={dict.loading} rows={4} />
    </Container>
  )
}
