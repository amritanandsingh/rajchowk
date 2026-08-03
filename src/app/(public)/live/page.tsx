import { CalendarPlus, ExternalLink, Radio } from 'lucide-react'
import type { Metadata } from 'next'
import { EventRegistrationButton } from '@/components/forms/event-registration-button'
import { EmptyState } from '@/components/site/empty-state'
import { PageHeader } from '@/components/site/page-header'
import { listLiveEvents } from '@/lib/amplify/queries'
import { formatDateTime } from '@/lib/format'
import { getDictionary } from '@/lib/i18n'

export const revalidate = 30
export const metadata: Metadata = { title: 'लाइव चर्चा', alternates: { canonical: '/live' } }

function calendarUrl(event: {
  title: string
  description?: string | null
  startsAt?: string | null
  endsAt?: string | null
}) {
  if (!event.startsAt) return null
  const clean = (value: string) =>
    new Date(value)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '')
  const end =
    event.endsAt ?? new Date(new Date(event.startsAt).getTime() + 60 * 60 * 1000).toISOString()
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${clean(event.startsAt)}/${clean(end)}`,
    details: event.description ?? '',
  })
  return `https://calendar.google.com/calendar/render?${params}`
}

export default async function LivePage() {
  const dict = getDictionary('hi')
  const { items } = await listLiveEvents({ limit: 20 })
  return (
    <main id="content" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-8 sm:py-10">
      <PageHeader
        title={dict.live.title}
        description="सीधी बातचीत, सवाल-जवाब और रिकॉर्डिंग—सब एक जगह।"
      />
      {items.length ? (
        <div className="space-y-5">
          {items.map((event) => {
            const addToCalendar = calendarUrl(event)
            const stream = event.status === 'COMPLETED' ? event.replayUrl : event.youtubeLiveUrl
            return (
              <article
                key={event.id}
                className="rounded-card border border-border bg-surface p-5 shadow-card sm:p-6"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-accent">
                    <Radio aria-hidden="true" className="size-4" />
                    {event.status === 'LIVE'
                      ? dict.live.liveNow
                      : event.status === 'COMPLETED'
                        ? dict.live.ended
                        : dict.live.upcoming}
                  </span>
                  {event.startsAt && (
                    <time dateTime={event.startsAt} className="text-xs text-fg-muted">
                      {formatDateTime(event.startsAt)}
                    </time>
                  )}
                </div>
                <h2 className="mt-3 font-display text-2xl font-bold">{event.title}</h2>
                {event.description && <p className="mt-3 text-fg-muted">{event.description}</p>}
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {event.registrationEnabled && event.status !== 'COMPLETED' && (
                    <EventRegistrationButton eventId={event.id} />
                  )}
                  {addToCalendar && (
                    <a
                      href={addToCalendar}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border-strong px-4 py-2 font-semibold no-underline"
                    >
                      <CalendarPlus aria-hidden="true" className="size-4" />
                      {dict.live.addToCalendar}
                    </a>
                  )}
                  {stream && (
                    <a
                      href={stream}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-2 font-semibold"
                    >
                      {event.status === 'COMPLETED' ? dict.live.watchReplay : dict.live.liveNow}
                      <ExternalLink aria-hidden="true" className="size-4" />
                    </a>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <EmptyState title="अभी कोई लाइव चर्चा निर्धारित नहीं है" />
      )}
    </main>
  )
}
