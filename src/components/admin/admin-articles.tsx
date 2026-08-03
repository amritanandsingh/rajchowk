'use client'

import { getCurrentUser } from 'aws-amplify/auth'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, TextArea, TextInput } from '@/components/forms/form-field'
import { browserDataClient, readableAmplifyError } from '@/lib/amplify/browser-client'
import type { Schema } from '@/../amplify/data/resource'

type Article = Schema['Article']['type']
type Category = Schema['Category']['type']

export function AdminArticles() {
  const [articles, setArticles] = useState<Article[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  async function load() {
    setLoading(true)
    try {
      const [articleResult, categoryResult] = await Promise.all([
        browserDataClient.models.Article.list({ limit: 100 }),
        browserDataClient.models.Category.list({ limit: 100 }),
      ])
      if (articleResult.errors?.length) throw new Error(articleResult.errors[0]?.message)
      setArticles(articleResult.data)
      setCategories(categoryResult.data.filter((item) => item.isActive !== false))
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
    setSaving(true)
    setError('')
    try {
      const user = await getCurrentUser()
      const response = await browserDataClient.models.Article.create({
        slug: String(form.get('slug') ?? '').trim(),
        language: 'HI',
        contentType: String(form.get('contentType') ?? 'NEWS') as 'NEWS',
        title,
        excerpt: String(form.get('excerpt') ?? '').trim(),
        bodyMarkdown: String(form.get('body') ?? '').trim(),
        categoryId: String(form.get('categoryId') ?? ''),
        authorProfileId: user.userId,
        authorDisplayName: user.username,
      })
      if (response.errors?.length) throw new Error(response.errors[0]?.message)
      formElement.reset()
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
      const response = await browserDataClient.mutations.publishArticle({
        articleId,
        action,
        changeSummary: action === 'PUBLISH' ? 'डैशबोर्ड से प्रकाशित' : 'डैशबोर्ड से हटाया गया',
      })
      if (response.errors?.length) throw new Error(response.errors[0]?.message)
      if (!response.data?.ok) throw new Error(response.data?.message ?? 'कार्य पूरा नहीं हुआ')
      await load()
    } catch (caught) {
      setError(readableAmplifyError(caught))
    } finally {
      setSaving(false)
    }
  }
  if (loading) return <p role="status">लेख लोड हो रहे हैं…</p>
  return (
    <div>
      <div className="mb-5 flex justify-end">
        <Button type="button" onClick={() => setShowForm((value) => !value)}>
          {showForm ? 'फ़ॉर्म बंद करें' : 'नया लेख'}
        </Button>
      </div>
      {showForm && (
        <form
          onSubmit={create}
          className="mb-8 grid gap-4 rounded-card border border-border bg-surface p-5 shadow-card"
        >
          <FormField label="शीर्षक">
            <TextInput name="title" required maxLength={180} />
          </FormField>
          <FormField label="URL स्लग">
            <TextInput name="slug" required pattern="[a-z0-9-]+" maxLength={180} />
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
          <label className="text-sm font-semibold">
            श्रेणी
            <select
              name="categoryId"
              required
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
          <FormField label="सारांश">
            <TextArea name="excerpt" required maxLength={500} />
          </FormField>
          <FormField label="लेख (Markdown)">
            <TextArea name="body" required className="min-h-56 font-mono" />
          </FormField>
          <Button type="submit" loading={saving}>
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
                  {article.status === 'PUBLISHED' ? (
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
