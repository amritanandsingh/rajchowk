import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

beforeEach(() => {
  saveArticle.mockReset().mockResolvedValue(success)
  setArticleStatus.mockReset().mockResolvedValue({ data: { ok: true }, errors: null })
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
