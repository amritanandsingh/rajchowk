'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'

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
import { ALLOWED_IMAGE_TYPES } from '@/lib/domain/media'
import { resultMessage } from '@/lib/domain/result-code'
import { SLUG_PATTERN } from '@/lib/domain/slug'
import { getDictionary } from '@/lib/i18n/hi'
import { insertImageMarkdown, uploadArticleImage } from '@/lib/media/upload-image'

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

  /**
   * The content textarea, so an uploaded image can be spliced in at the caret.
   *
   * The field stays UNCONTROLLED — its value is mutated directly rather than
   * driven from state. That is not laziness: every other field in this form is
   * read through FormData on submit, and making this one controlled would give
   * the article body a second source of truth that the `key={article.id}`
   * remount in the edit page would then have to keep in step.
   */
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const altRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [uploading, setUploading] = useState(false)
  /** Thumbnails of what was added this session, so the editor can see that the
   *  upload produced a real, fetchable image rather than just a line of text. */
  const [uploaded, setUploaded] = useState<{ url: string; alt: string }[]>([])

  const errorFor = (field: ArticleFieldError['field']) =>
    fieldErrors.find((error) => error.field === field)?.message

  /**
   * Upload the chosen file, then write `![alt](url)` where the caret is.
   *
   * Follows the same async idiom as submit() below and as status-action.tsx:
   * re-entrancy guard, clear the previous notice, distinguish transport
   * failure from a refused request, navigate on an expired session, and always
   * re-enable in `finally`.
   */
  async function onImageSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Resetting the input immediately means choosing the SAME file twice in a
    // row still fires a change event the second time.
    event.target.value = ''
    if (!file || uploading) return

    setUploading(true)
    setNotice(null)

    try {
      const result = await uploadArticleImage(articleId.current, file)

      if (!result.ok) {
        setNotice({ tone: 'error', text: result.message })
        return
      }

      const alt = altRef.current?.value.trim() ?? ''
      const textarea = contentRef.current
      if (textarea) {
        const { text, caretAfter } = insertImageMarkdown(
          textarea.value,
          // selectionStart is null for a never-focused field in some browsers;
          // appending at the end is the sane fallback.
          textarea.selectionStart ?? textarea.value.length,
          { url: result.mediaUrl, alt },
        )
        textarea.value = text
        // Put the caret after what was inserted and give the field focus back,
        // so the editor can keep typing where they left off rather than
        // hunting for their place.
        textarea.setSelectionRange(caretAfter, caretAfter)
        textarea.focus()
      }

      setUploaded((previous) => [...previous, { url: result.mediaUrl, alt }])
      if (altRef.current) altRef.current.value = ''
      setNotice({ tone: 'success', text: dict.admin.form.image.uploaded })
    } catch (caught) {
      if (isAuthError(caught)) {
        router.replace('/admin/login?next=/admin')
        return
      }
      setNotice({ tone: 'error', text: readableAmplifyError(caught) })
    } finally {
      setUploading(false)
    }
  }

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
            ref={contentRef}
            name="content"
            defaultValue={initial.content}
            className="min-h-80 font-mono text-sm"
          />
        )}
      </Field>

      {/*
        The image control sits BELOW the content field, not above it. It acts
        on the caret inside that field, and a control that edits something
        above it reads as unrelated to it.

        It is a <div>, not a <fieldset> inside <form>: the file input carries
        no `name` and its value is never submitted. Nothing here is part of the
        article payload — the upload produces Markdown, and the Markdown is the
        payload.
      */}
      <div className="rounded-card border border-border bg-bg-subtle p-4">
        <p className="font-display text-sm font-bold">{dict.admin.form.image.label}</p>
        <p className="mt-1 text-xs text-fg-muted">{dict.admin.form.image.hint}</p>

        <div className="mt-3 space-y-3">
          <Field label={dict.admin.form.image.alt} hint={dict.admin.form.image.altHint}>
            {(props) => (
              <TextInput {...props} ref={altRef} type="text" maxLength={200} disabled={uploading} />
            )}
          </Field>

          <div>
            {/*
              A visually hidden input driven by a Button, rather than a styled
              file input. The native control cannot be restyled consistently
              across browsers, and `Button` already carries the 44px touch
              target and the busy/disabled coupling this needs. The label is
              what keeps it operable by keyboard and named for a screen reader
              — it is a real <label>, so the input is reachable by its
              accessible name rather than by clicking a div.
            */}
            <label htmlFor="article-image" className="sr-only">
              {dict.admin.form.image.choose}
            </label>
            <input
              id="article-image"
              ref={fileRef}
              type="file"
              accept={Object.keys(ALLOWED_IMAGE_TYPES).join(',')}
              onChange={onImageSelected}
              disabled={uploading}
              className="sr-only"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={uploading}
              loadingLabel={dict.admin.form.image.uploading}
              onClick={() => fileRef.current?.click()}
            >
              {dict.admin.form.image.choose}
            </Button>
          </div>
        </div>

        {uploaded.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-fg-muted">{dict.admin.form.image.added}</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {uploaded.map((image) => (
                <li key={image.url}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- an
                      admin-only preview of an arbitrary upload; next/image
                      needs intrinsic dimensions this does not have. */}
                  <img
                    src={image.url}
                    alt={image.alt}
                    loading="lazy"
                    decoding="async"
                    className="size-16 rounded border border-border object-cover"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

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
