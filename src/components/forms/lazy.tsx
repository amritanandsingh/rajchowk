'use client'

/**
 * Deferred loaders for the forms that pull in the Amplify Data client.
 *
 * THE COST THIS EXISTS TO AVOID
 *
 * src/lib/amplify/browser-client.ts calls configureBrowserAmplify() as a
 * top-level side effect and default-imports amplify_outputs.json (218 KB on
 * disk, no tree-shaking possible). Importing that module for ANY reason boots
 * the whole runtime, so a single email input at the bottom of the homepage was
 * costing every reader two page-weight chunks before first interaction:
 *
 *     3714-*.js   205 KB raw / 59.9 KB gz   aws-amplify Data client
 *     6792-*.js   100 KB raw /  9.1 KB gz   model_introspection from outputs
 *
 * Measured: `/` was 193.6 KB gz while `/latest`, which renders the identical
 * ArticleGrid with no interactive widget, was 109.0 KB gz. Both chunks were
 * confirmed page-scoped rather than shared with the root layout, which is what
 * makes deferring them actually work. On the 3G Indian mobile connection this
 * site is explicitly built for (see next.config.ts), that is roughly two
 * seconds before the page becomes interactive.
 *
 * WHAT IS AND IS NOT DEFERRED
 *
 * Only forms that are pure interaction — nothing a crawler or a reader needs in
 * the initial HTML. `ssr: false` costs nothing here because every one of these
 * is already JS-only: they submit through onSubmit + preventDefault with no
 * <form action> fallback, so they never worked without JS to begin with.
 *
 * SearchForm and VoteForm are deliberately NOT here. SearchForm is the primary
 * above-the-fold control on /search, and VoteForm renders the poll's options
 * and results — both are content, not chrome, and both should stay in the
 * server-rendered HTML even though it keeps Amplify on those two routes.
 *
 * Each placeholder reserves roughly the height of the real control so the
 * deferred swap does not shift the page under a reader who is already scrolling.
 */

import dynamic from 'next/dynamic'

function Placeholder({ className }: { className: string }) {
  return (
    <div aria-hidden="true" className={`animate-pulse rounded-card bg-bg-subtle ${className}`} />
  )
}

export const LazyNewsletterForm = dynamic(
  () => import('./newsletter-form').then((m) => m.NewsletterForm),
  { ssr: false, loading: () => <Placeholder className="h-52" /> },
)

export const LazyCommentForm = dynamic(() => import('./comment-form').then((m) => m.CommentForm), {
  ssr: false,
  loading: () => <Placeholder className="h-64" />,
})

export const LazyQuestionForm = dynamic(
  () => import('./question-form').then((m) => m.QuestionForm),
  { ssr: false, loading: () => <Placeholder className="h-64" /> },
)

export const LazyQuestionUpvote = dynamic(
  () => import('./question-upvote').then((m) => m.QuestionUpvote),
  { ssr: false, loading: () => <Placeholder className="h-11 w-24" /> },
)

export const LazyEventRegistrationButton = dynamic(
  () => import('./event-registration-button').then((m) => m.EventRegistrationButton),
  { ssr: false, loading: () => <Placeholder className="h-11 w-36" /> },
)
