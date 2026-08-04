'use client'

import { getCurrentUser } from 'aws-amplify/auth'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, TextArea, TextInput } from '@/components/forms/form-field'
import {
  adminDataClient,
  firstErrorMessage,
  readableAmplifyError,
} from '@/lib/amplify/browser-client'
import { SLUG_PATTERN } from '@/lib/domain/slug'
import { canCreateCategory, canWriteArticles } from '@/lib/domain/staff-role'
import { CategoryQuickCreate } from './category-quick-create'
import { useStaffGroups } from './use-staff-groups'
import type { Schema } from '@/../amplify/data/resource'

type Article = Schema['Article']['type']
type Category = Schema['Category']['type']

/**
 * Active categories, in the order an editor expects them.
 *
 * `Category.list` is an unordered scan, so the ordering has to happen here. The
 * `isActive !== false` filter stays client-side deliberately: a DynamoDB
 * `ne: false` filter would drop rows created before the attribute existed,
 * because a missing attribute matches no comparison.
 */
function sortCategories(items: Category[]): Category[] {
  return items
    .filter((item) => item.isActive !== false)
    .sort(
      (a, b) =>
        (a.displayOrder ?? 100) - (b.displayOrder ?? 100) || a.nameHi.localeCompare(b.nameHi, 'hi'),
    )
}

export function AdminArticles() {
  const [articles, setArticles] = useState<Article[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  // The one controlled field in this form, so that a category created inline can
  // be selected the moment it exists.
  const [categoryId, setCategoryId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [categoryError, setCategoryError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const { groups, ready } = useStaffGroups()
  const mayWrite = canWriteArticles(groups)
  const mayAddCategory = canCreateCategory(groups)

  async function load() {
    setLoading(true)
    try {
      const [articleResult, categoryResult] = await Promise.all([
        adminDataClient.models.Article.list({ limit: 100 }),
        adminDataClient.models.Category.list({ limit: 200 }),
      ])
      // Two independent error channels, on purpose. A category failure must not
      // blank the article table and vice versa — and the original bug was that
      // `categoryResult.errors` was never read at all, so a rejected category
      // list was indistinguishable from a newsroom that had no categories.
      const articleFailure = firstErrorMessage(articleResult.errors)
      if (articleFailure) {
        setError(articleFailure)
      } else {
        setError('')
        setArticles(articleResult.data)
      }
      const categoryFailure = firstErrorMessage(categoryResult.errors)
      if (categoryFailure) {
        setCategoryError(categoryFailure)
      } else {
        setCategoryError('')
        setCategories(sortCategories(categoryResult.data))
      }
    } catch (caught) {
      setError(readableAmplifyError(caught))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const title = String(form.get('title') ?? '').trim()
    if (!categoryId) {
      setError('कृपया श्रेणी चुनें।')
      return
    }
    setSaving(true)
    setError('')
    try {
      const user = await getCurrentUser()
      const response = await adminDataClient.models.Article.create({
        slug: String(form.get('slug') ?? '').trim(),
        language: 'HI',
        contentType: String(form.get('contentType') ?? 'NEWS') as 'NEWS',
        title,
        excerpt: String(form.get('excerpt') ?? '').trim(),
        bodyMarkdown: String(form.get('body') ?? '').trim(),
        // From state rather than FormData: this select is controlled.
        categoryId,
        authorProfileId: user.userId,
        authorDisplayName: user.username,
      })
      const failure = firstErrorMessage(response.errors)
      if (failure) throw new Error(failure)
      formElement.reset()
      // form.reset() restores DOM defaults but cannot touch React state, so
      // without this the next article silently inherits this category.
      setCategoryId('')
      setShowForm(false)
      await load()
    } catch (caught) {
      setError(readableAmplifyError(caught))
    } finally {
      setSaving(false)
    }
  }
  async function publish(articleId: string, action: 'PUBLISH' | 'UNPUBLISH') {
    setSaving(true)
    setError('')
    try {
      const response = await adminDataClient.mutations.publishArticle({
        articleId,
        action,
        changeSummary: action === 'PUBLISH' ? 'डैशबोर्ड से प्रकाशित' : 'डैशबोर्ड से हटाया गया',
      })
      const failure = firstErrorMessage(response.errors)
      if (failure) throw new Error(failure)
      if (!response.data?.ok) throw new Error(response.data?.message ?? 'कार्य पूरा नहीं हुआ')
      await load()
    } catch (caught) {
      setError(readableAmplifyError(caught))
    } finally {
      setSaving(false)
    }
  }
  // `ready` is part of the gate so the role-dependent UI below never renders
  // from an empty group list and flashes a false "not allowed" at an editor.
  if (loading || !ready) return <p role="status">लेख लोड हो रहे हैं…</p>
  return (
    <div>
      {mayWrite ? (
        <div className="mb-5 flex justify-end">
          <Button type="button" onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'फ़ॉर्म बंद करें' : 'नया लेख'}
          </Button>
        </div>
      ) : (
        <p role="status" className="mb-5 rounded-card bg-bg-subtle p-3 text-sm">
          आपकी भूमिका में लेख बनाने की अनुमति नहीं है — केवल समीक्षा।
        </p>
      )}
      {mayWrite && showForm && (
        <form
          onSubmit={create}
          className="mb-8 grid gap-4 rounded-card border border-border bg-surface p-5 shadow-card"
        >
          <FormField label="शीर्षक">
            <TextInput name="title" required maxLength={180} />
          </FormField>
          <FormField label="URL स्लग">
            <TextInput name="slug" required pattern={SLUG_PATTERN} maxLength={180} />
          </FormField>
          <label className="text-sm font-semibold">
            प्रकार
            <select
              name="contentType"
              className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2"
            >
              <option value="NEWS">खबर</option>
              <option value="OPINION">राय</option>
              <option value="ANALYSIS">विश्लेषण</option>
              <option value="EXPLAINER">समझाइश</option>
              <option value="FACT_CHECK">फैक्ट चेक</option>
              <option value="INTERVIEW">इंटरव्यू</option>
            </select>
          </label>
          <div className="grid gap-3">
            {categories.length ? (
              <label className="block text-sm font-semibold">
                श्रेणी
                <select
                  name="categoryId"
                  required
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  className="mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2"
                >
                  <option value="">चुनें</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.nameHi}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              // No <select> at all rather than an empty one. An empty `required`
              // select is a dead end: the browser blocks the submit and gives no
              // reason, which is exactly how this page failed before.
              <p role="status" className="rounded-md bg-bg-subtle p-3 text-sm">
                <span className="font-semibold">श्रेणी: </span>
                {mayAddCategory
                  ? 'कोई सक्रिय श्रेणी नहीं मिली। नीचे से नई श्रेणी जोड़ें।'
                  : 'कोई सक्रिय श्रेणी नहीं मिली। किसी संपादक से श्रेणी बनवाएँ।'}
              </p>
            )}
            {categoryError && (
              <p role="alert" className="rounded-md bg-danger-subtle p-3 text-sm text-danger">
                श्रेणियाँ लोड नहीं हो सकीं: {categoryError}
              </p>
            )}
            {mayAddCategory && (
              <CategoryQuickCreate
                onCreated={(category) => {
                  // Appended, NOT refetched. load() sets `loading`, and the
                  // `if (loading) return` above would unmount this <form> and
                  // destroy every uncontrolled field the editor has typed.
                  // Appending re-renders the same element tree in place, so the
                  // half-written article survives; and because both updates land
                  // in one batch, the new <option> exists by the time React
                  // assigns the select's value.
                  setCategories((current) => sortCategories([...current, category]))
                  setCategoryId(category.id)
                  setCategoryError('')
                }}
              />
            )}
          </div>
          <FormField label="सारांश">
            <TextArea name="excerpt" required maxLength={500} />
          </FormField>
          <FormField label="लेख (Markdown)">
            <TextArea name="body" required className="min-h-56 font-mono" />
          </FormField>
          <Button type="submit" loading={saving} disabled={!categoryId}>
            ड्राफ़्ट सहेजें
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mb-4 rounded-card bg-danger-subtle p-3 text-danger">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-bg-subtle">
            <tr>
              <th className="p-3">शीर्षक</th>
              <th className="p-3">प्रकार</th>
              <th className="p-3">स्थिति</th>
              <th className="p-3">कार्य</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {articles.map((article) => (
              <tr key={article.id}>
                <td className="p-3 font-semibold">{article.title}</td>
                <td className="p-3">{article.contentType}</td>
                <td className="p-3">{article.status ?? 'DRAFT'}</td>
                <td className="p-3">
                  {/* publishArticle is allow.groups(STAFF), so a MODERATOR
                      cannot call it at all. */}
                  {!mayWrite ? (
                    <span aria-hidden="true">—</span>
                  ) : article.status === 'PUBLISHED' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      loading={saving}
                      onClick={() => publish(article.id, 'UNPUBLISH')}
                    >
                      हटाएँ
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      loading={saving}
                      onClick={() => publish(article.id, 'PUBLISH')}
                    >
                      प्रकाशित करें
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
