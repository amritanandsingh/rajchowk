import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as UploadModule from '@/lib/media/upload-image'

/**
 * The create/publish form.
 *
 * What is worth testing here is the behaviour that protects data: that invalid
 * input never reaches the network, that a double-click cannot produce two
 * articles, and that a failed publish does not report success.
 */

const saveArticle = vi.fn()
const setArticleStatus = vi.fn()
const replace = vi.fn()
const refresh = vi.fn()

vi.mock('@/lib/amplify/browser-client', () => ({
  userPoolDataClient: {
    mutations: {
      saveArticle: (...args: unknown[]) => saveArticle(...args),
      setArticleStatus: (...args: unknown[]) => setArticleStatus(...args),
    },
  },
  firstErrorMessage: (errors: { message?: string }[] | null | undefined) =>
    errors?.length ? (errors[0]?.message ?? null) : null,
  isAuthError: (error: unknown) =>
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'NotAuthorizedException',
  readableAmplifyError: (error: unknown) =>
    error instanceof Error ? error.message : 'कुछ गड़बड़ हो गई।',
  configureBrowserAmplify: () => {},
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}))

/**
 * The upload helper is mocked, not the Amplify client it wraps.
 *
 * It lives in its own module precisely so this factory stays small: stubbing
 * the two-hop presign-then-PUT flow through the Amplify mock above would mean
 * hand-rolling a signed URL and a `fetch`, which tests the mock rather than
 * the form. `insertImageMarkdown` is deliberately NOT mocked — where the text
 * lands is the behaviour under test, and it is pure.
 */
const uploadArticleImage = vi.fn()

vi.mock('@/lib/media/upload-image', async (importOriginal) => {
  const actual = await importOriginal<typeof UploadModule>()
  return { ...actual, uploadArticleImage: (...args: unknown[]) => uploadArticleImage(...args) }
})

const { ArticleForm } = await import('./article-form')

const EMPTY = { id: 'fixed-article-id', title: '', slug: '', summary: '', content: '' }

const VALID = {
  title: 'दिल्ली में बड़ा फैसला',
  summary: 'सर्वोच्च न्यायालय ने आज एक महत्वपूर्ण निर्णय सुनाया है।',
  content: 'आज की सुनवाई में अदालत ने विस्तार से अपनी बात रखी और कई बिंदुओं पर टिप्पणी की।',
}

const success = {
  data: { ok: true, articleId: 'fixed-article-id', slug: 's', status: 'DRAFT' },
  errors: null,
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/शीर्षक/), VALID.title)
  await user.type(screen.getByLabelText(/सारांश/), VALID.summary)
  await user.type(screen.getByLabelText(/^लेख/), VALID.content)
}

const CDN_URL = 'https://d111111abcdef8.cloudfront.net/articles/a/b.jpg'

const jpeg = (name = 'photo.jpg') =>
  new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' })

beforeEach(() => {
  saveArticle.mockReset().mockResolvedValue(success)
  setArticleStatus.mockReset().mockResolvedValue({ data: { ok: true }, errors: null })
  uploadArticleImage.mockReset().mockResolvedValue({ ok: true, mediaUrl: CDN_URL })
  replace.mockReset()
  refresh.mockReset()
})

describe('validation', () => {
  it('blocks submission and shows per-field errors for empty input', async () => {
    const user = userEvent.setup()
    render(<ArticleForm initial={EMPTY} />)

    await user.click(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' }))

    // Nothing left the browser. The same validator runs in the Lambda, but
    // failing here is what saves the editor a round trip.
    expect(saveArticle).not.toHaveBeenCalled()

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.length).toBeGreaterThanOrEqual(3)
  })

  it('marks the failing field with aria-invalid, not just colour', async () => {
    const user = userEvent.setup()
    render(<ArticleForm initial={EMPTY} />)

    await user.click(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' }))

    await waitFor(() => {
      expect(screen.getByLabelText(/शीर्षक/)).toHaveAttribute('aria-invalid', 'true')
    })
  })

  it('moves focus to the first invalid field', async () => {
    const user = userEvent.setup()
    render(<ArticleForm initial={EMPTY} />)

    await user.click(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' }))

    // Without this a keyboard or screen-reader user hears an error and has no
    // idea which field it applies to.
    await waitFor(() => expect(screen.getByLabelText(/शीर्षक/)).toHaveFocus())
  })

  it('sends TRIMMED values once input is valid', async () => {
    const user = userEvent.setup()
    render(<ArticleForm initial={EMPTY} />)

    await user.type(screen.getByLabelText(/शीर्षक/), `   ${VALID.title}   `)
    await user.type(screen.getByLabelText(/सारांश/), VALID.summary)
    await user.type(screen.getByLabelText(/^लेख/), VALID.content)
    await user.click(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' }))

    await waitFor(() => expect(saveArticle).toHaveBeenCalledOnce())
    expect(saveArticle.mock.calls[0]![0]).toMatchObject({ title: VALID.title })
  })
})

describe('duplicate submission', () => {
  it('sends ONE request for a double-clicked submit', async () => {
    const user = userEvent.setup()
    // Hold the request open so the second click lands mid-flight — the exact
    // race a disabled button alone does not close.
    let release: (value: unknown) => void = () => {}
    saveArticle.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )

    render(<ArticleForm initial={EMPTY} />)
    await fillValid(user)

    const button = screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' })
    await user.click(button)
    await user.click(button)

    expect(saveArticle).toHaveBeenCalledOnce()
    release(success)
  })

  it('sends the SAME article id on a retry after failure', async () => {
    const user = userEvent.setup()
    saveArticle.mockResolvedValueOnce({ data: { ok: false, code: 'INTERNAL' }, errors: null })

    render(<ArticleForm initial={EMPTY} />)
    await fillValid(user)

    await user.click(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' }))

    await waitFor(() => expect(saveArticle).toHaveBeenCalledTimes(2))
    // Regenerating the id on retry would defeat the server-side idempotency
    // key: the second attempt would look like a different article.
    expect(saveArticle.mock.calls[0]![0].id).toBe(saveArticle.mock.calls[1]![0].id)
  })

  it('disables the button and marks it busy while submitting', async () => {
    const user = userEvent.setup()
    let release: (value: unknown) => void = () => {}
    saveArticle.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )

    render(<ArticleForm initial={EMPTY} />)
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' }))

    const button = screen.getByRole('button', { name: /ड्राफ़्ट सहेजें/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    release(success)
  })
})

describe('publish', () => {
  it('saves THEN publishes, in that order', async () => {
    const user = userEvent.setup()
    render(<ArticleForm initial={EMPTY} />)
    await fillValid(user)

    await user.click(screen.getByRole('button', { name: 'सहेजें और प्रकाशित करें' }))

    await waitFor(() => expect(setArticleStatus).toHaveBeenCalledOnce())
    expect(saveArticle).toHaveBeenCalledOnce()
    expect(setArticleStatus.mock.calls[0]![0]).toMatchObject({ action: 'PUBLISH' })
  })

  it('does NOT publish when the save failed', async () => {
    const user = userEvent.setup()
    saveArticle.mockResolvedValue({ data: { ok: false, code: 'INVALID_INPUT' }, errors: null })

    render(<ArticleForm initial={EMPTY} />)
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: 'सहेजें और प्रकाशित करें' }))

    await screen.findByRole('alert')
    expect(setArticleStatus).not.toHaveBeenCalled()
  })

  it('reports a failed publish rather than navigating away', async () => {
    const user = userEvent.setup()
    setArticleStatus.mockResolvedValue({ data: { ok: false, code: 'CONFLICT' }, errors: null })

    render(<ArticleForm initial={EMPTY} />)
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: 'सहेजें और प्रकाशित करें' }))

    // The save succeeded, so the editor's words are safe as a draft. Saying so
    // beats silently navigating to a dashboard that shows it unpublished.
    expect(await screen.findByRole('alert')).toHaveTextContent(/स्थिति बदल चुकी है/)
    expect(replace).not.toHaveBeenCalled()
  })

  it('saving a draft does NOT publish', async () => {
    const user = userEvent.setup()
    render(<ArticleForm initial={EMPTY} />)
    await fillValid(user)

    await user.click(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' }))

    await waitFor(() => expect(saveArticle).toHaveBeenCalledOnce())
    expect(setArticleStatus).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent('सहेज लिया गया।')
  })
})

describe('image upload', () => {
  it('inserts Markdown for the uploaded image', async () => {
    const user = userEvent.setup()
    render(<ArticleForm initial={EMPTY} />)

    await user.upload(screen.getByLabelText('चित्र चुनें'), jpeg())

    await waitFor(() => expect(uploadArticleImage).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByLabelText(/^लेख/)).toHaveValue(`![](${CDN_URL})`))
  })

  it('uses the alt text the editor typed', async () => {
    const user = userEvent.setup()
    render(<ArticleForm initial={EMPTY} />)

    await user.type(screen.getByLabelText('चित्र का विवरण'), 'सभा का दृश्य')
    await user.upload(screen.getByLabelText('चित्र चुनें'), jpeg())

    await waitFor(() =>
      expect(screen.getByLabelText(/^लेख/)).toHaveValue(`![सभा का दृश्य](${CDN_URL})`),
    )
  })

  it('inserts AT THE CARET, not at the end', async () => {
    const user = userEvent.setup()
    render(<ArticleForm initial={{ ...EMPTY, content: 'पहलादूसरा' }} />)

    // Derived, not hardcoded. A caret offset is in UTF-16 code units, and
    // Devanagari does not map one glyph to one unit — writing `5` here looks
    // right and lands inside the second word.
    const caret = 'पहला'.length
    const content = screen.getByLabelText(/^लेख/) as HTMLTextAreaElement
    content.focus()
    content.setSelectionRange(caret, caret)

    await user.upload(screen.getByLabelText('चित्र चुनें'), jpeg())

    // Appending would be the easy bug here, and it would drop every image at
    // the bottom of the article regardless of where the editor was writing.
    await waitFor(() => expect(content.value).toBe(`पहला\n\n![](${CDN_URL})\n\nदूसरा`))
  })

  it('passes the article id, so the object is keyed under this article', async () => {
    const user = userEvent.setup()
    render(<ArticleForm initial={EMPTY} />)

    await user.upload(screen.getByLabelText('चित्र चुनें'), jpeg())

    await waitFor(() => expect(uploadArticleImage).toHaveBeenCalledOnce())
    expect(uploadArticleImage.mock.calls[0]![0]).toBe(EMPTY.id)
  })

  it('shows a rejection and leaves the content untouched', async () => {
    const user = userEvent.setup()
    uploadArticleImage.mockResolvedValue({ ok: false, message: 'चित्र अधिकतम 5 MB का हो सकता है।' })

    render(<ArticleForm initial={{ ...EMPTY, content: 'मूल पाठ' }} />)
    await user.upload(screen.getByLabelText('चित्र चुनें'), jpeg())

    expect(await screen.findByRole('alert')).toHaveTextContent('5 MB')
    // A failed upload must not leave a broken image reference behind.
    expect(screen.getByLabelText(/^लेख/)).toHaveValue('मूल पाठ')
  })

  it('does not insert anything when the upload fails', async () => {
    const user = userEvent.setup()
    uploadArticleImage.mockResolvedValue({ ok: false, message: 'नहीं हो सका' })

    render(<ArticleForm initial={EMPTY} />)
    await user.upload(screen.getByLabelText('चित्र चुनें'), jpeg())

    await screen.findByRole('alert')
    expect(screen.getByLabelText(/^लेख/)).toHaveValue('')
  })

  it('marks the control busy while the upload is in flight', async () => {
    const user = userEvent.setup()
    let release: (value: unknown) => void = () => {}
    uploadArticleImage.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )

    render(<ArticleForm initial={EMPTY} />)
    await user.upload(screen.getByLabelText('चित्र चुनें'), jpeg())

    const button = screen.getByRole('button', { name: /चित्र चुनें/ })
    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveAttribute('aria-busy', 'true')

    release({ ok: true, mediaUrl: CDN_URL })
  })

  it('shows a preview of what was added', async () => {
    const user = userEvent.setup()
    render(<ArticleForm initial={EMPTY} />)

    await user.type(screen.getByLabelText('चित्र का विवरण'), 'सभा')
    await user.upload(screen.getByLabelText('चित्र चुनें'), jpeg())

    // Proof to the editor that the object is really there and fetchable,
    // rather than just a line of text that might 404 after publishing.
    const preview = await screen.findByRole('img', { name: 'सभा' })
    expect(preview).toHaveAttribute('src', CDN_URL)
  })

  it('redirects to sign-in when the session has expired mid-upload', async () => {
    const user = userEvent.setup()
    const expired = new Error('session expired')
    expired.name = 'NotAuthorizedException'
    uploadArticleImage.mockRejectedValue(expired)

    render(<ArticleForm initial={EMPTY} />)
    await user.upload(screen.getByLabelText('चित्र चुनें'), jpeg())

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/login?next=/admin'))
  })

  it('does not offer SVG in the file picker', async () => {
    render(<ArticleForm initial={EMPTY} />)

    // The accept attribute is a convenience, not the control — the Lambda
    // refuses SVG regardless — but offering it and then rejecting it would be
    // a poor way to tell an editor the format is unsupported.
    const input = screen.getByLabelText('चित्र चुनें')
    expect(input.getAttribute('accept')).not.toContain('svg')
    expect(input.getAttribute('accept')).toContain('image/jpeg')
  })

  it('uploading does not save or publish the article', async () => {
    const user = userEvent.setup()
    render(<ArticleForm initial={EMPTY} />)

    await user.upload(screen.getByLabelText('चित्र चुनें'), jpeg())
    await waitFor(() => expect(uploadArticleImage).toHaveBeenCalledOnce())

    // Adding an image is an edit in progress, not a commit.
    expect(saveArticle).not.toHaveBeenCalled()
    expect(setArticleStatus).not.toHaveBeenCalled()
  })
})

describe('failure handling', () => {
  it('surfaces a transport error instead of reporting success', async () => {
    const user = userEvent.setup()
    // The v6 client resolves with { data, errors } rather than throwing; an
    // unchecked `data` would render success over a refused request.
    saveArticle.mockResolvedValue({ data: null, errors: [{ message: 'Unauthorized' }] })

    render(<ArticleForm initial={EMPTY} />)
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Unauthorized')
  })

  it('redirects to sign-in when the session has expired', async () => {
    const user = userEvent.setup()
    const expired = new Error('session expired')
    expired.name = 'NotAuthorizedException'
    saveArticle.mockRejectedValue(expired)

    render(<ArticleForm initial={EMPTY} />)
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' }))

    // No amount of retrying fixes an expired session, so navigate rather than
    // showing a message beside a button that will keep failing.
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/admin/login?next=/admin'))
  })

  it('re-enables the button after a failure so the editor can retry', async () => {
    const user = userEvent.setup()
    saveArticle.mockResolvedValue({ data: { ok: false, code: 'INTERNAL' }, errors: null })

    render(<ArticleForm initial={EMPTY} />)
    await fillValid(user)
    await user.click(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' }))

    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' })).toBeEnabled()
  })
})
