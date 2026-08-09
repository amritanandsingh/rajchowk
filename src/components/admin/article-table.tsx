import Link from 'next/link'

import { EmptyState, ErrorState } from '@/components/state/states'
import type { AdminArticleCard, AdminListResult } from '@/lib/amplify/admin-queries'
import { availableActions, type ArticleStatus } from '@/lib/domain/article-status'
import { formatShortDate } from '@/lib/format'
import { getDictionary } from '@/lib/i18n/hi'
import { StatusAction } from './status-action'

const dict = getDictionary()

/**
 * One state's worth of articles.
 *
 * A list of rows rather than a <table>. There are three fields and one action
 * per article, which a table would spread across the full width on desktop and
 * force into a horizontal scroll on a phone — and this product's editors will
 * be on phones. Rows stack.
 *
 * The empty and error states are distinct on purpose. `listArticlesForAdmin`
 * returns a discriminated result precisely so this can tell "you have no
 * drafts" (write one) from "we could not reach the API" (refresh) — an editor
 * can act on that difference, which is why the admin layer carries it and the
 * public feed does not.
 */
export function ArticleTable({
  status,
  result,
}: {
  status: ArticleStatus
  result: AdminListResult
}) {
  if (!result.ok) {
    return (
      <ErrorState
        title={dict.admin.list.error.title}
        description={dict.admin.list.error.description}
      />
    )
  }

  if (result.items.length === 0) {
    const empty = status === 'DRAFT' ? dict.admin.list.emptyDrafts : dict.admin.list.emptyPublished
    return <EmptyState title={empty.title} description={empty.description} />
  }

  return (
    <ul className="divide-y divide-border rounded-card border border-border bg-surface">
      {result.items.map((article) => (
        <li key={article.id}>
          <Row article={article} />
        </li>
      ))}
    </ul>
  )
}

function Row({ article }: { article: AdminArticleCard }) {
  // The resolver already defaults a missing status to DRAFT; this narrows the
  // string it returns back to the union the transition table expects.
  const status: ArticleStatus = article.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT'
  const published = formatShortDate(article.publishedAt ?? article.updatedAt)

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          {published && <span className="text-xs text-fg-subtle">{published}</span>}
        </div>

        <p className="mt-1.5 font-display font-bold text-balance">{article.title}</p>
        <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{article.summary}</p>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link
            href={`/admin/articles/${article.id}/edit`}
            className="font-semibold text-brand hover:text-brand-hover"
          >
            {dict.admin.list.edit}
          </Link>
          {status === 'PUBLISHED' && (
            <Link
              href={`/article/${article.slug}`}
              className="font-semibold text-brand hover:text-brand-hover"
            >
              {dict.admin.list.view}
            </Link>
          )}
        </div>
      </div>

      <div className="shrink-0">
        {availableActions(status).map((action) => (
          <StatusAction
            key={action}
            articleId={article.id}
            action={action}
            articleTitle={article.title}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * Status is conveyed by TEXT, with colour as reinforcement.
 *
 * A coloured dot alone would fail WCAG 1.4.1 — colour is not the only means of
 * conveying information — and would also be meaningless to anyone who has not
 * learned the convention.
 */
function StatusBadge({ status }: { status: ArticleStatus }) {
  const tone =
    status === 'PUBLISHED' ? 'bg-success-subtle text-success' : 'bg-bg-subtle text-fg-muted'

  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {dict.admin.status[status]}
    </span>
  )
}
