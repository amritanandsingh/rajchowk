import { CommentForm } from '@/components/forms/comment-form'
import type { PublicComment } from '@/lib/amplify/queries'
import { formatDate } from '@/lib/format'
import type { Dictionary } from '@/lib/i18n'

export function CommentsSection({
  articleId,
  comments,
  allowComments,
  dict,
}: {
  articleId: string
  comments: PublicComment[]
  allowComments: boolean
  dict: Dictionary
}) {
  return (
    <section className="mt-12 border-t border-border pt-8" aria-labelledby="comments-title">
      <h2 id="comments-title" className="font-display text-2xl font-bold">
        {dict.comments.title}
      </h2>
      {comments.length ? (
        <div className="mt-5 space-y-4">
          {comments.map((comment) => (
            <article key={comment.id} className="rounded-card bg-bg-subtle p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                <strong className="text-fg">{comment.authorDisplayName}</strong>
                {comment.createdAt && (
                  <time dateTime={comment.createdAt}>{formatDate(comment.createdAt)}</time>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap">{comment.content}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-fg-muted">{dict.comments.empty}</p>
      )}
      {allowComments ? (
        <CommentForm articleId={articleId} />
      ) : (
        <p className="mt-4 rounded-card bg-bg-subtle p-4 text-sm">{dict.comments.closed}</p>
      )}
    </section>
  )
}
