'use client'

import { getCurrentUser } from 'aws-amplify/auth'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { FormField, TextArea, TextInput } from '@/components/forms/form-field'
import {
  userPoolDataClient,
  firstErrorMessage,
  readableAmplifyError,
} from '@/lib/amplify/browser-client'
import {
  availableActions,
  isArticleStatus,
  type ArticleStatus,
  type PublishAction,
} from '@/lib/domain/article-status'
import { resultMessage } from '@/lib/domain/result-code'
import { SLUG_PATTERN } from '@/lib/domain/slug'
import { canCreateCategory, canWriteArticles, isAdmin } from '@/lib/domain/staff-role'
// The Hindi dictionary directly, not useDictionary(). /admin is Hindi-only —
// there is no locale switcher on staff surfaces — so reading the context would
// buy nothing and would couple every staff component to <Providers>.
import { hi } from '@/lib/i18n/dictionaries/hi'
import { CategoryQuickCreate } from './category-quick-create'
import { useStaffGroups } from './use-staff-groups'
import type { Schema } from '@/../amplify/data/resource'

type Article = Schema['Article']['type']
type Category = Schema['Category']['type']

/**
 * The only Article fields this table needs.
 *
 * Without an explicit selection set Amplify requests EVERY scalar, which here
 * means `bodyMarkdown`, `bodyPlain`, `analysisMarkdown`, `conclusionMarkdown`,
 * `keyFacts`, `factualSummary` — plus `internalNotes` and `sourceContactNotes`,
 * which are editor-only fields with no business reaching a list view. For a
 * newsroom with long Devanagari articles that is megabytes of markdown fetched
 * and held in browser memory to render four columns.
 *
 * Note what this does NOT fix: DynamoDB reads whole items and Amplify's
 * generated resolver sets no ProjectionExpression, so the 1 MB Scan page cap
 * still applies to the untrimmed rows. That is what `truncated` below is for.
 */
const ARTICLE_LIST_FIELDS = ['id', 'title', 'contentType', 'status', 'revisionCount'] as const

type ArticleRow = Pick<Article, (typeof ARTICLE_LIST_FIELDS)[number]>

/**
 * The editor-facing verb for each transition, and the audit trail it writes.
 *
 * Hardcoded Hindi rather than dictionary lookups, matching the rest of this
 * file: /admin is Hindi-only by design, and the locale switcher is not offered
 * on staff surfaces. Error messages DO go through the dictionary, because those
 * strings are shared with reader-facing surfaces that are bilingual.
 */
const ACTION_LABELS: Record<PublishAction, string> = {
  SUBMIT_FOR_REVIEW: 'समीक्षा के लिए भेजें',
  RETURN_TO_DRAFT: 'ड्राफ़्ट में लौटाएँ',
  SCHEDULE: 'शेड्यूल करें',
  PUBLISH: 'प्रकाशित करें',
  UNPUBLISH: 'हटाएँ',
  ARCHIVE: 'संग्रह करें',
  RESTORE: 'बहाल करें',
}

const ACTION_SUMMARIES: Record<PublishAction, string> = {
  SUBMIT_FOR_REVIEW: 'डैशबोर्ड से समीक्षा हेतु भेजा गया',
  RETURN_TO_DRAFT: 'डैशबोर्ड से ड्राफ़्ट में लौटाया गया',
  SCHEDULE: 'डैशबोर्ड से शेड्यूल किया गया',
  PUBLISH: 'डैशबोर्ड से प्रकाशित',
  UNPUBLISH: 'डैशबोर्ड से हटाया गया',
  ARCHIVE: 'डैशबोर्ड से संग्रहित',
  RESTORE: 'डैशबोर्ड से बहाल किया गया',
}

/** The destructive-looking transitions get the outline treatment, not primary. */
const OUTLINE_ACTIONS: readonly PublishAction[] = ['UNPUBLISH', 'RETURN_TO_DRAFT', 'ARCHIVE']

const STATUS_LABELS: Record<ArticleStatus, string> = {
  DRAFT: 'ड्राफ़्ट',
  IN_REVIEW: 'समीक्षा में',
  SCHEDULED: 'शेड्यूल्ड',
  PUBLISHED: 'प्रकाशित',
  UNPUBLISHED: 'हटाया गया',
  ARCHIVED: 'संग्रहित',
}

/** Tone per status, from the existing status tokens — never a raw colour. */
const STATUS_TONES: Record<ArticleStatus, string> = {
  DRAFT: 'bg-bg-subtle text-fg-muted',
  IN_REVIEW: 'bg-warning-subtle text-warning',
  SCHEDULED: 'bg-info-subtle text-info',
  PUBLISHED: 'bg-success-subtle text-success',
  UNPUBLISHED: 'bg-danger-subtle text-danger',
  ARCHIVED: 'bg-bg-subtle text-fg-subtle',
}

/**
 * An article with no `status` attribute is a DRAFT.
 *
 * The field is Lambda-owned, so a freshly created article genuinely has no
 * status until the first transition writes one. The publish handler makes the
 * same inference; see the ConditionExpression note in
 * amplify/functions/publish-article/handler.ts.
 */
function statusOf(article: Pick<Article, 'status'>): ArticleStatus {
  return isArticleStatus(article.status) ? article.status : 'DRAFT'
}

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
  const [articles, setArticles] = useState<ArticleRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  // True when DynamoDB returned a partial page. See the note in load().
  const [truncated, setTruncated] = useState(false)
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
  const admin = isAdmin(groups)

  async function load() {
    setLoading(true)
    try {
      const [articleResult, categoryResult] = await Promise.all([
        userPoolDataClient.models.Article.list({ limit: 100, selectionSet: ARTICLE_LIST_FIELDS }),
        userPoolDataClient.models.Category.list({ limit: 200 }),
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
        // A truncated page is NOT an error: DynamoDB returns fewer items plus a
        // LastEvaluatedKey and AppSync reports `{ items, nextToken }` with empty
        // `errors`, so firstErrorMessage above cannot see it. Ignoring nextToken
        // is how a partial list came to be presented as the whole newsroom.
        setTruncated(Boolean(articleResult.nextToken))
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
    const contentType = String(form.get('contentType') ?? 'NEWS') as Article['contentType']
    try {
      const user = await getCurrentUser()
      const response = await userPoolDataClient.models.Article.create({
        slug: String(form.get('slug') ?? '').trim(),
        language: 'HI',
        contentType,
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
      const created = response.data
      if (!created) throw new Error('लेख सहेजा नहीं जा सका।')
      formElement.reset()
      // form.reset() restores DOM defaults but cannot touch React state, so
      // without this the next article silently inherits this category.
      setCategoryId('')
      setShowForm(false)
      // Prepend from the mutation's own response instead of refetching.
      //
      // This used to call load(), and that is the whole of the reported "saving a
      // long article does nothing" bug. load() Scans the base table with
      // limit: 100, but DynamoDB caps a Scan page at 1 MB, and publishing adds
      // `bodyPlain` (up to 20k chars, ~3 UTF-8 bytes per Devanagari character) to
      // every row — so a newsroom of long published articles returns only ~8-11
      // rows. A partial page is not an error, so nothing complained: the article
      // WAS written, the form closed, and it simply was not in the list. A
      // base-table Scan is unordered too, so whether the new row survived was
      // luck. runAction already patches state from its own response for exactly
      // this reason; create() had been left behind.
      // `title` and `contentType` come from what was just submitted, not from
      // the response: the row must render correctly even if the API echoes back a
      // narrower shape than the full model. Only `id` genuinely has to come from
      // the server. `status` is Lambda-owned and legitimately absent on a fresh
      // draft — statusOf() reads that absence as DRAFT.
      setArticles((current) => [
        {
          id: created.id,
          title,
          contentType,
          status: created.status ?? null,
          revisionCount: created.revisionCount ?? null,
        },
        ...current,
      ])
    } catch (caught) {
      setError(readableAmplifyError(caught))
    } finally {
      setSaving(false)
    }
  }
  /**
   * Run one transition from the state machine.
   *
   * Takes the full `PublishAction` union rather than just PUBLISH/UNPUBLISH.
   * Those two are `adminOnly` in the transition table, so restricting this
   * function to them left an editor with no reachable action at all: the whole
   * justification for the mutation being `allow.groups(STAFF)` is that editors
   * legitimately call SUBMIT_FOR_REVIEW and RETURN_TO_DRAFT, and neither had a
   * button. Which action is offered is decided by `availableActions` below, so
   * this function never has to know the rules twice.
   */
  async function runAction(articleId: string, action: PublishAction) {
    setSaving(true)
    setError('')
    try {
      const response = await userPoolDataClient.mutations.publishArticle({
        articleId,
        action,
        changeSummary: ACTION_SUMMARIES[action],
      })
      const failure = firstErrorMessage(response.errors)
      if (failure) throw new Error(failure)
      const result = response.data
      if (!result?.ok) {
        // The CODE, not the Lambda's generic `message`. A CONFLICT here means
        // "someone else moved this article", which needs a refresh — not the
        // "try again" that the fallback text used to suggest for a failure that
        // retrying could never fix.
        throw new Error(resultMessage(hi, result?.code, result?.message))
      }
      // Patch the one row that changed, from the mutation's own response.
      // Calling load() here refetched 100 articles and 200 categories to
      // reflect a single status flip, and set `loading`, which unmounts the
      // whole table on every publish.
      setArticles((current) =>
        current.map((item) =>
          item.id === articleId
            ? {
                ...item,
                // `?? null` rather than leaving the value possibly undefined:
                // exactOptionalPropertyTypes distinguishes "absent" from
                // "null", and Amplify's model type allows only the latter.
                status: isArticleStatus(result.status) ? result.status : (item.status ?? null),
                revisionCount: result.revisionNumber ?? item.revisionCount ?? null,
              }
            : item,
        ),
      )
    } catch (caught) {
      setError(readableAmplifyError(caught))
    } finally {
      setSaving(false)
    }
  }
  // `ready` is part of the gate so the role-dependent UI below never renders
  // from an empty group list and flashes a false "not allowed" at an editor.
  //
  // A table-shaped skeleton rather than a line of text: a one-line status
  // collapsed the page to nothing and then reflowed the whole layout when the
  // rows arrived, which is most of why this screen felt slow.
  if (loading || !ready)
    return (
      <div aria-busy="true" role="status" aria-label="लेख लोड हो रहे हैं">
        <div className="mb-5 flex justify-end">
          <div className="h-11 w-28 animate-pulse rounded-md bg-bg-subtle" />
        </div>
        <div className="overflow-hidden rounded-card border border-border">
          <div className="h-11 bg-bg-subtle" />
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex items-center gap-4 border-t border-border p-3">
              <div className="h-4 flex-1 animate-pulse rounded bg-bg-subtle" />
              <div className="h-4 w-16 animate-pulse rounded bg-bg-subtle" />
              <div className="h-6 w-20 animate-pulse rounded-full bg-bg-subtle" />
              <div className="h-8 w-24 animate-pulse rounded-md bg-bg-subtle" />
            </div>
          ))}
        </div>
      </div>
    )
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
      {truncated && (
        // DynamoDB returned a partial page. Silence here is what made a saved
        // article look lost, so the incompleteness is stated rather than implied.
        <p role="status" className="mb-4 rounded-card bg-warning-subtle p-3 text-sm text-warning">
          {`केवल पहले ${articles.length} लेख दिखाए जा रहे हैं — सूची अपूर्ण है। खोज का उपयोग करें या पुराने लेख सीधे खोलें।`}
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
            {articles.map((article) => {
              const status = statusOf(article)
              // The transition table is the single source of truth for what is
              // offered, so an admin and an editor each see exactly the actions
              // the handler will accept from them — and adding a transition
              // there gives it a button here for free.
              // SCHEDULE is withheld until there is a UI to pick a date.
              //
              // runAction sends only { articleId, action, changeSummary }, and
              // publish-article/handler.ts writes scheduledFor only
              // `if (nextStatus === 'SCHEDULED' && scheduledFor)`. So the button
              // moved an article to SCHEDULED with no date, where no reader can
              // see it and nothing will ever publish it — only an ADMIN pressing
              // PUBLISH could get it back out. Offering no button is strictly
              // better than offering that one; the transition itself is fine and
              // stays in the table for when a date picker exists.
              const actions = availableActions(status, admin).filter(
                (action) => action !== 'SCHEDULE',
              )
              return (
                <tr key={article.id} className="transition-colors hover:bg-bg-subtle">
                  <td className="p-3 font-semibold">{article.title}</td>
                  <td className="p-3">{article.contentType}</td>
                  <td className="p-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_TONES[status]}`}
                    >
                      {STATUS_LABELS[status]}
                    </span>
                  </td>
                  <td className="p-3">
                    {actions.length === 0 ? (
                      <span className="text-xs text-fg-muted">कोई कार्य उपलब्ध नहीं</span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {actions.map((action) => (
                          <Button
                            key={action}
                            type="button"
                            size="sm"
                            variant={OUTLINE_ACTIONS.includes(action) ? 'outline' : 'primary'}
                            loading={saving}
                            onClick={() => runAction(article.id, action)}
                          >
                            {ACTION_LABELS[action]}
                          </Button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
