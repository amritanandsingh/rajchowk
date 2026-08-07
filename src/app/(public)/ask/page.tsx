import type { Metadata } from 'next'
import { LazyQuestionForm, LazyQuestionUpvote } from '@/components/forms/lazy'
import { EmptyState } from '@/components/site/empty-state'
import { PageHeader } from '@/components/site/page-header'
import { listApprovedQuestions } from '@/lib/amplify/queries'
import { formatDate } from '@/lib/format'
import { getDictionary } from '@/lib/i18n'
import { Container } from '@/components/ui/container'

export const revalidate = 60
export const metadata: Metadata = { title: 'राज चौक से पूछें', alternates: { canonical: '/ask' } }

export default async function AskPage() {
  const dict = getDictionary('hi')
  const { items } = await listApprovedQuestions({ limit: 20 })
  return (
    <Container>
      <PageHeader
        title={dict.questions.title}
        description="राजनीति, नीति और जनहित पर अपना सवाल भेजें। चुने गए सवालों का स्पष्ट जवाब दिया जाएगा।"
      />
      <div className="grid gap-8 lg:grid-cols-[1.35fr_.8fr]">
        <section aria-labelledby="question-list">
          <h2 id="question-list" className="mb-4 text-2xl font-bold">
            लोकप्रिय सवाल
          </h2>
          {items.length ? (
            <div className="space-y-4">
              {items.map((question) => (
                <article
                  key={question.id}
                  className="rounded-card border border-border bg-surface p-5 shadow-card"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    {question.category && (
                      <span className="font-bold text-accent">{question.category}</span>
                    )}
                    <span>{question.askerDisplayName}</span>
                    {question.createdAt && (
                      <time dateTime={question.createdAt}>{formatDate(question.createdAt)}</time>
                    )}
                  </div>
                  <h3 className="mt-3 text-lg font-bold">{question.questionText}</h3>
                  {question.writtenAnswer && (
                    <div className="mt-4 rounded-card border-l-4 border-brand bg-brand-subtle p-4">
                      <p className="mb-1 text-xs font-bold text-brand">{dict.questions.answered}</p>
                      <p>{question.writtenAnswer}</p>
                    </div>
                  )}
                  <div className="mt-4">
                    <LazyQuestionUpvote
                      questionId={question.id}
                      initialCount={question.upvoteCount ?? 0}
                    />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title={dict.questions.empty} />
          )}
        </section>
        <aside>
          <LazyQuestionForm />
        </aside>
      </div>
    </Container>
  )
}
