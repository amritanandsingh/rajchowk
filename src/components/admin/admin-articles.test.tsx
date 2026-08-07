import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminArticles } from './admin-articles'
import { resetStaffGroupsCache } from './use-staff-groups'

/**
 * The article-creation surface.
 *
 * This exists because of a bug that was invisible in every layer taken alone:
 * the browser Amplify client signed its requests with the identity pool, but
 * Category and Article authorize through user-pool rules, so `Category.list`
 * came back `Unauthorized` — and nothing checked `categoryResult.errors`. The
 * dropdown rendered empty, the `required` select silently blocked every submit,
 * and it looked for all the world like a missing feature.
 *
 * So the properties pinned here are: a rejected category list is VISIBLE, an
 * empty one is explained rather than silently unsatisfiable, and a category
 * created inline does not cost the editor the article they were half-way
 * through typing.
 */

const mocks = vi.hoisted(() => ({
  listArticles: vi.fn(),
  listCategories: vi.fn(),
  createArticle: vi.fn(),
  createCategory: vi.fn(),
  categoryBySlug: vi.fn(),
  publishArticle: vi.fn(),
  fetchAuthSession: vi.fn(),
  getCurrentUser: vi.fn(),
}))

// Mocking this module also side-steps its top-level `Amplify.configure(outputs)`.
// `firstErrorMessage` is re-implemented rather than imported through
// `importOriginal`, which would run that configure call.
vi.mock('@/lib/amplify/browser-client', () => ({
  browserDataClient: {},
  adminDataClient: {
    models: {
      Article: { list: mocks.listArticles, create: mocks.createArticle },
      Category: {
        list: mocks.listCategories,
        create: mocks.createCategory,
        categoryBySlug: mocks.categoryBySlug,
      },
    },
    mutations: { publishArticle: mocks.publishArticle },
  },
  firstErrorMessage: (errors?: readonly { message?: string }[] | null) =>
    errors?.length ? (errors[0]?.message ?? null) : null,
  readableAmplifyError: (error: unknown) =>
    error instanceof Error && error.message ? error.message : 'कुछ गलत हो गया।',
}))

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: mocks.fetchAuthSession,
  getCurrentUser: mocks.getCurrentUser,
}))

const category = (id: string, nameHi: string, displayOrder: number | null = 100) => ({
  id,
  slug: id,
  nameHi,
  nameEn: id,
  displayOrder,
  isActive: true,
})

const session = (groups: string[]) => ({
  tokens: { idToken: { payload: { 'cognito:groups': groups } } },
})

// vitest.config.mts sets restoreMocks + clearMocks, which strips every
// implementation between tests. They have to be (re)assigned here, not at
// module scope.
beforeEach(() => {
  // useStaffGroups caches the decoded token in module scope so the same
  // session is not re-fetched by every staff component. Vitest keeps modules
  // between cases, so without this every test after the first would see the
  // first test's role.
  resetStaffGroupsCache()
  mocks.listArticles.mockResolvedValue({ data: [], errors: undefined })
  mocks.listCategories.mockResolvedValue({ data: [], errors: undefined })
  mocks.categoryBySlug.mockResolvedValue({ data: [], errors: undefined })
  mocks.createCategory.mockResolvedValue({
    data: category('cat-new', 'राजनीति'),
    errors: undefined,
  })
  mocks.createArticle.mockResolvedValue({ data: { id: 'art-1' }, errors: undefined })
  mocks.publishArticle.mockResolvedValue({ data: { ok: true }, errors: undefined })
  mocks.fetchAuthSession.mockResolvedValue(session(['EDITOR']))
  mocks.getCurrentUser.mockResolvedValue({ userId: 'user-1', username: 'editor' })
})

async function openForm() {
  render(<AdminArticles />)
  await userEvent.click(await screen.findByRole('button', { name: 'नया लेख' }))
}

const categorySelect = () => screen.getByRole('combobox', { name: /श्रेणी/ })

describe('the category field', () => {
  it('shows a rejected category list instead of an empty dropdown', async () => {
    // The original failure, pinned. `Category.list` is refused but
    // `Article.list` succeeds — so the table must still render, and the reason
    // the dropdown is missing must be on screen.
    mocks.listCategories.mockResolvedValue({
      data: [],
      errors: [{ message: 'Unauthorized' }],
    })
    mocks.listArticles.mockResolvedValue({
      data: [{ id: 'art-1', title: 'पहला लेख', contentType: 'NEWS', status: 'DRAFT' }],
      errors: undefined,
    })

    await openForm()

    expect(screen.getByRole('alert')).toHaveTextContent('Unauthorized')
    expect(screen.queryByRole('combobox', { name: /श्रेणी/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' })).toBeDisabled()
    expect(screen.getByText('पहला लेख')).toBeInTheDocument()
  })

  it('explains an empty list rather than rendering a dead required select', async () => {
    await openForm()

    expect(screen.queryByRole('combobox', { name: /श्रेणी/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('कोई सक्रिय श्रेणी नहीं मिली')
    expect(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' })).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('orders options by displayOrder, then by Hindi name', async () => {
    mocks.listCategories.mockResolvedValue({
      data: [
        category('c-sports', 'खेल', 50),
        category('c-none', 'अर्थ', null),
        category('c-politics', 'राजनीति', 10),
        category('c-world', 'आवास', 50),
      ],
      errors: undefined,
    })

    await openForm()

    const options = within(categorySelect())
      .getAllByRole('option')
      .map((option) => option.textContent)
    // null displayOrder falls back to 100, so it sorts last; the two 50s
    // tie-break on the Hindi name.
    expect(options).toEqual(['चुनें', 'राजनीति', 'आवास', 'खेल', 'अर्थ'])
  })

  it('drops inactive categories', async () => {
    mocks.listCategories.mockResolvedValue({
      data: [category('c-live', 'सक्रिय'), { ...category('c-dead', 'निष्क्रिय'), isActive: false }],
      errors: undefined,
    })

    await openForm()

    const options = within(categorySelect())
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual(['चुनें', 'सक्रिय'])
  })
})

describe('creating a category from inside the article form', () => {
  it('keeps the half-written article, and selects the new category', async () => {
    // The whole point of creating a category inline. If this test fails because
    // the fields came back empty, something re-triggered `load()` and unmounted
    // the form.
    await openForm()

    await userEvent.type(screen.getByLabelText('शीर्षक'), 'बजट पर बहस')
    await userEvent.type(screen.getByLabelText('लेख (Markdown)'), 'पहला पैराग्राफ।')

    await userEvent.click(screen.getByRole('button', { name: '+ नई श्रेणी' }))
    await userEvent.type(screen.getByLabelText('Name (English)'), 'Politics')
    // The slug is derived from the ENGLISH name — Devanagari has no ASCII form.
    expect(screen.getByLabelText('श्रेणी का स्लग')).toHaveValue('politics')
    await userEvent.type(screen.getByLabelText('नाम (हिंदी)'), 'राजनीति')
    await userEvent.click(screen.getByRole('button', { name: 'श्रेणी सहेजें' }))

    expect(mocks.categoryBySlug).toHaveBeenCalledWith({ slug: 'politics' }, { limit: 1 })
    const input = mocks.createCategory.mock.calls[0]?.[0]
    expect(input).toMatchObject({ slug: 'politics', nameHi: 'राजनीति', nameEn: 'Politics' })
    // Immediately usable: the form only lists active categories.
    expect(input.isActive).toBe(true)
    // Lambda-owned (field-level auth grants read only); sending it fails the
    // whole mutation. `id` is refused by the client outright.
    expect(input).not.toHaveProperty('publishedArticleCount')
    expect(input).not.toHaveProperty('id')

    expect(await screen.findByRole('combobox', { name: /श्रेणी/ })).toHaveValue('cat-new')
    expect(screen.getByLabelText('शीर्षक')).toHaveValue('बजट पर बहस')
    expect(screen.getByLabelText('लेख (Markdown)')).toHaveValue('पहला पैराग्राफ।')
    // Appended locally, never refetched — a refetch is what would wipe the form.
    expect(mocks.listArticles).toHaveBeenCalledTimes(1)
  })

  it('refuses a duplicate slug without writing anything', async () => {
    mocks.categoryBySlug.mockResolvedValue({ data: [{ id: 'cat-existing' }], errors: undefined })

    await openForm()
    await userEvent.click(screen.getByRole('button', { name: '+ नई श्रेणी' }))
    await userEvent.type(screen.getByLabelText('नाम (हिंदी)'), 'राजनीति')
    await userEvent.type(screen.getByLabelText('Name (English)'), 'Politics')
    await userEvent.click(screen.getByRole('button', { name: 'श्रेणी सहेजें' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('यह स्लग पहले से मौजूद है')
    expect(mocks.createCategory).not.toHaveBeenCalled()
  })

  it('asks for an English slug instead of transliterating a Hindi one', async () => {
    // slugify('राजनीति') is '' by design: a slug is a permanent public URL, so
    // it gets typed, never guessed.
    await openForm()
    await userEvent.click(screen.getByRole('button', { name: '+ नई श्रेणी' }))
    await userEvent.type(screen.getByLabelText('नाम (हिंदी)'), 'राजनीति')
    await userEvent.type(screen.getByLabelText('Name (English)'), 'राजनीति')
    await userEvent.click(screen.getByRole('button', { name: 'श्रेणी सहेजें' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('स्लग अंग्रेज़ी अक्षरों')
    expect(mocks.categoryBySlug).not.toHaveBeenCalled()
    expect(mocks.createCategory).not.toHaveBeenCalled()
  })

  it('does not submit the article when Enter is pressed in a category field', async () => {
    // These inputs live INSIDE the article <form>, so Enter would otherwise
    // trigger implicit submission.
    await openForm()
    await userEvent.click(screen.getByRole('button', { name: '+ नई श्रेणी' }))
    await userEvent.type(screen.getByLabelText('नाम (हिंदी)'), 'राजनीति{Enter}')

    expect(mocks.createArticle).not.toHaveBeenCalled()
  })
})

describe('saving the article', () => {
  it('sends the selected category and resets the field afterwards', async () => {
    mocks.listCategories.mockResolvedValue({
      data: [category('c-politics', 'राजनीति', 10)],
      errors: undefined,
    })

    await openForm()
    await userEvent.type(screen.getByLabelText('शीर्षक'), 'बजट पर बहस')
    await userEvent.type(screen.getByLabelText('URL स्लग'), 'budget-par-bahas')
    await userEvent.type(screen.getByLabelText('सारांश'), 'सारांश यहाँ।')
    await userEvent.type(screen.getByLabelText('लेख (Markdown)'), 'पहला पैराग्राफ।')
    await userEvent.selectOptions(categorySelect(), 'c-politics')
    await userEvent.click(screen.getByRole('button', { name: 'ड्राफ़्ट सहेजें' }))

    expect(mocks.createArticle).toHaveBeenCalledTimes(1)
    expect(mocks.createArticle.mock.calls[0]?.[0]).toMatchObject({
      categoryId: 'c-politics',
      title: 'बजट पर बहस',
      slug: 'budget-par-bahas',
      authorProfileId: 'user-1',
    })

    // Reopening must not inherit the previous category: form.reset() cannot
    // clear React state, so the component has to do it explicitly.
    await userEvent.click(await screen.findByRole('button', { name: 'नया लेख' }))
    expect(categorySelect()).toHaveValue('')
  })
})

describe('role gating', () => {
  const oneDraft = {
    data: [{ id: 'art-1', title: 'पहला लेख', contentType: 'NEWS', status: 'DRAFT' }],
    errors: undefined,
  }

  it('gives a MODERATOR a read-only view', async () => {
    // Article grants MODERATOR read only — offering any control is a dead end.
    mocks.fetchAuthSession.mockResolvedValue(session(['MODERATOR']))
    mocks.listArticles.mockResolvedValue(oneDraft)

    render(<AdminArticles />)

    expect(await screen.findByText('पहला लेख')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'नया लेख' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ नई श्रेणी' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'प्रकाशित करें' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('अनुमति नहीं है')
  })

  it('lets an EDITOR write and submit for review, but NOT publish', async () => {
    // PUBLISH/UNPUBLISH are adminOnly in the transition table and the publish
    // function enforces it, so an editor offered this button would only ever
    // get "आपके पास इसकी अनुमति नहीं है".
    //
    // But hiding it must not leave the editor with NOTHING. SUBMIT_FOR_REVIEW
    // is the non-admin transition out of DRAFT, and it is the entire reason
    // publishArticle is allow.groups(STAFF) rather than allow.group(ADMIN).
    // Before this, an editor's article could never leave DRAFT by any route
    // the UI offered.
    mocks.listArticles.mockResolvedValue(oneDraft)

    render(<AdminArticles />)

    expect(await screen.findByRole('button', { name: 'नया लेख' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'प्रकाशित करें' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'समीक्षा के लिए भेजें' })).toBeInTheDocument()
  })

  it('sends SUBMIT_FOR_REVIEW when an editor uses it', async () => {
    mocks.listArticles.mockResolvedValue(oneDraft)
    mocks.publishArticle.mockResolvedValue({
      data: { ok: true, code: 'OK', status: 'IN_REVIEW', revisionNumber: 1 },
      errors: undefined,
    })

    render(<AdminArticles />)
    await userEvent.click(await screen.findByRole('button', { name: 'समीक्षा के लिए भेजें' }))

    expect(mocks.publishArticle).toHaveBeenCalledTimes(1)
    expect(mocks.publishArticle.mock.calls[0]?.[0]).toMatchObject({
      articleId: 'art-1',
      action: 'SUBMIT_FOR_REVIEW',
    })
    // The row is patched from the mutation's own response rather than refetched.
    expect(await screen.findByText('समीक्षा में')).toBeInTheDocument()
  })

  it('lets an ADMIN publish', async () => {
    mocks.fetchAuthSession.mockResolvedValue(session(['ADMIN']))
    mocks.listArticles.mockResolvedValue(oneDraft)

    render(<AdminArticles />)

    expect(await screen.findByRole('button', { name: 'प्रकाशित करें' })).toBeInTheDocument()
  })

  it('reports a refused transition by CODE, not the generic fallback', async () => {
    // The failure this whole change exists to make visible. A publish that
    // could never succeed used to read "कृपया फिर से कोशिश करें", which is
    // advice that cannot work — the code is what says whether a retry helps.
    mocks.fetchAuthSession.mockResolvedValue(session(['ADMIN']))
    mocks.listArticles.mockResolvedValue(oneDraft)
    mocks.publishArticle.mockResolvedValue({
      data: { ok: false, code: 'CONFLICT', message: 'अभी पूरा नहीं हो सका।' },
      errors: undefined,
    })

    render(<AdminArticles />)
    await userEvent.click(await screen.findByRole('button', { name: 'प्रकाशित करें' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('स्थिति बदल गई है')
    // The row must not have moved: the transition was refused.
    expect(screen.getByText('ड्राफ़्ट')).toBeInTheDocument()
  })
})
