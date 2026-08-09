'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, type FormEvent } from 'react'

import { FormNotice } from '@/components/state/states'
import { Button } from '@/components/ui/button'
import { Field, TextArea, TextInput } from '@/components/ui/field'
import {
  firstErrorMessage,
  isAuthError,
  readableAmplifyError,
  userPoolDataClient,
} from '@/lib/amplify/browser-client'
import { parseArticleInput, type ArticleFieldError } from '@/lib/domain/article'
import { resultMessage } from '@/lib/domain/result-code'
import { SLUG_PATTERN } from '@/lib/domain/slug'
import { getDictionary } from '@/lib/i18n/hi'

const dict = getDictionary()

export type ArticleFormValues = {
  id: string
  title: string
  slug: string
  summary: string
  content: string
}

/**
 * The create/edit form.
 *
 * DUPLICATE SUBMISSION is prevented three times over, which sounds excessive
 * until you notice each layer catches a case the others miss:
 *
 *  1. `submitting` guard at the top of the handler — catches a second submit
 *     dispatched before React re-renders, which a disabled button does not.
 *  2. `loading` on the Button, which also disables it — the visible
 *     affordance, and the only one a user perceives.
 *  3. A STABLE `id` generated once per form mount and sent with every attempt.
 *     The save handler creates with `attribute_not_exists(id)`, so a retry
 *     that gets past 1 and 2 — a flaky network where the first request
 *     actually succeeded, say — collapses onto the same row instead of
 *     creating a second article.
 *
 * Only the third survives a page that has already sent the request. It is the
 * one that matters, and it is why the id lives in a ref rather than being
 * generated at submit time.
 */
export function ArticleForm({ initial }: { initial: ArticleFormValues }) {
  const router = useRouter()

  /**
   * The idempotency key. `useRef` rather than `useState`: it must survive
   * re-renders without causing one, and it must NOT change between a failed
   * attempt and its retry — regenerating it on retry would defeat the whole
   * mechanism by making the second attempt look like a different article.
   */
  const articleId = useRef(initial.id)

  /**
   * Which button was pressed.
   *
   * Both buttons are `type="submit"`, so the form fires ONE submit handler and
   * has to be told which verb the editor chose. A ref rather than state
   * because it is read synchronously inside the handler on the same tick it is
   * written — a `setState` here would not have applied yet.
   *
   * The alternative — a click handler that synthesises a submit event — was
   * tried and is worse: it bypasses the form's own submit path, so pressing
   * Enter in a text field silently took a different code path from clicking.
   */
  const publishIntent = useRef(false)

  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<ArticleFieldError[]>([])
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const errorFor = (field: ArticleFieldError['field']) =>
    fieldErrors.find((error) => error.field === field)?.message

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    // Read once, immediately: a later `await` would let a second click change
    // it mid-flight.
    const publish = publishIntent.current
    publishIntent.current = false

    const form = new FormData(event.currentTarget)
    const raw = {
      title: String(form.get('title') ?? ''),
      summary: String(form.get('summary') ?? ''),
      content: String(form.get('content') ?? ''),
      slug: String(form.get('slug') ?? ''),
    }

    /**
     * The SAME validator the Lambda runs, so the two cannot disagree about
     * what is acceptable. This call is a convenience — fast per-field feedback
     * without a round trip — and not a security control; the authoritative
     * call happens in the handler against arguments it does not trust.
     */
    const parsed = parseArticleInput(raw)
    if (!parsed.ok) {
      setFieldErrors(parsed.errors)
      setNotice(null)
      // Move focus to the first bad field. Without this a keyboard or screen
      // reader user gets an error announced and no idea where it applies.
      const first = parsed.errors[0]
      if (first) document.getElementsByName(first.field)[0]?.focus()
      return
    }

    setFieldErrors([])
    setSubmitting(true)
    setNotice(null)

    try {
      const saved = await userPoolDataClient.mutations.saveArticle({
        id: articleId.current,
        title: parsed.value.title,
        summary: parsed.value.summary,
        content: parsed.value.content,
        slug: parsed.value.slug || null,
      })

      // The v6 client resolves with `{ data, errors }` rather than throwing,
      // so an unchecked `data` would render success over a refused request.
      const transportError = firstErrorMessage(saved.errors)
      if (transportError) {
        setNotice({ tone: 'error', text: transportError })
        return
      }

      const result = saved.data
      if (!result?.ok) {
        setNotice({ tone: 'error', text: resultMessage(result?.code) })
        return
      }

      if (!publish) {
        setNotice({ tone: 'success', text: dict.admin.form.saved })
        // refresh() so the dashboard list behind this page reflects the save.
        router.refresh()
        return
      }

      /**
       * Publishing is a SECOND mutation, deliberately not folded into the
       * first. The two are separate authorisation decisions with separate
       * transition rules, and a `publish: true` flag on save would mean the
       * save handler owning the state machine as well as content validation.
       *
       * The consequence is a window where the save succeeded and the publish
       * failed. That is reported honestly below rather than rolled back: the
       * editor's words are safely stored as a draft, which is the outcome they
       * would choose.
       */
      const published = await userPoolDataClient.mutations.setArticleStatus({
        articleId: articleId.current,
        action: 'PUBLISH',
      })

      const publishTransportError = firstErrorMessage(published.errors)
      if (publishTransportError) {
        setNotice({ tone: 'error', text: publishTransportError })
        return
      }

      if (!published.data?.ok) {
        setNotice({ tone: 'error', text: resultMessage(published.data?.code) })
        return
      }

      router.replace('/admin')
      router.refresh()
    } catch (caught) {
      /**
       * An expired Cognito session cannot be retried out of, so it navigates
       * rather than showing a message next to a button that will keep failing.
       */
      if (isAuthError(caught)) {
        router.replace('/admin/login?next=/admin')
        return
      }
      setNotice({ tone: 'error', text: readableAmplifyError(caught) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {notice && <FormNotice tone={notice.tone}>{notice.text}</FormNotice>}

      <Field label={dict.admin.form.title} error={errorFor('title')} required>
        {(props) => (
          <TextInput
            {...props}
            name="title"
            defaultValue={initial.title}
            placeholder={dict.admin.form.titlePlaceholder}
            maxLength={300}
            autoFocus
          />
        )}
      </Field>

      <Field
        label={dict.admin.form.summary}
        hint={dict.admin.form.summaryHint}
        error={errorFor('summary')}
        required
      >
        {(props) => (
          <TextArea
            {...props}
            name="summary"
            defaultValue={initial.summary}
            maxLength={600}
            rows={3}
          />
        )}
      </Field>

      <Field
        label={dict.admin.form.content}
        hint={dict.admin.form.contentHint}
        error={errorFor('content')}
        required
      >
        {(props) => (
          <TextArea
            {...props}
            name="content"
            defaultValue={initial.content}
            className="min-h-80 font-mono text-sm"
          />
        )}
      </Field>

      <Field label={dict.admin.form.slug} hint={dict.admin.form.slugHint} error={errorFor('slug')}>
        {(props) => (
          <TextInput
            {...props}
            name="slug"
            defaultValue={initial.slug}
            // Shares its source with the server-side check, so the browser's
            // native validation and the Lambda's agree by construction.
            pattern={SLUG_PATTERN}
            maxLength={80}
            dir="ltr"
            className="font-mono text-sm"
          />
        )}
      </Field>

      <div className="flex flex-wrap gap-3 border-t border-border pt-6">
        {/*
          Save is FIRST in the DOM, which makes it the form's implicit default:
          pressing Enter in a text field saves a draft rather than publishing.
          Publishing should take a deliberate click.
        */}
        <Button
          type="submit"
          variant="outline"
          loading={submitting}
          loadingLabel={dict.admin.form.saving}
          onClick={() => {
            publishIntent.current = false
          }}
        >
          {dict.admin.form.save}
        </Button>

        {/*
          A second submit button rather than a checkbox plus one button. The
          editor's intent — "keep working on this" versus "put it in front of
          readers" — is a decision, and a decision deserves a verb they can read
          before they commit to it.

          The click handler runs before the form's submit event, so setting the
          ref here is seen by the handler on the same interaction.
        */}
        <Button
          type="submit"
          loading={submitting}
          loadingLabel={dict.admin.form.publishing}
          onClick={() => {
            publishIntent.current = true
          }}
        >
          {dict.admin.form.saveAndPublish}
        </Button>
      </div>
    </form>
  )
}
