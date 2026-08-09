'use client'

import { useState, type KeyboardEvent } from 'react'
import { FormField, TextArea, TextInput } from '@/components/forms/form-field'
import { Button } from '@/components/ui/button'
import {
  userPoolDataClient,
  firstErrorMessage,
  readableAmplifyError,
} from '@/lib/amplify/browser-client'
import { isSlug, MAX_SLUG_LENGTH, slugify } from '@/lib/domain/slug'
import type { Schema } from '@/../amplify/data/resource'

type Category = Schema['Category']['type']

/**
 * Create a category without leaving the article form.
 *
 * This exists because `Article.categoryId` is required and nothing else in the
 * product can create a Category — on a fresh deployment the dropdown is empty,
 * so no article can be saved at all.
 *
 * IT RENDERS INSIDE THE ARTICLE <form>, and that constrains the markup in four
 * ways that are easy to undo by accident:
 *
 *   1. No nested <form> — HTML forbids it. Hence <fieldset>.
 *   2. Every button is type="button". `Button` sets no default type, so an
 *      omitted one submits the ARTICLE.
 *   3. No `required` / `pattern` / `type="number"` on these inputs. Constraint
 *      validation is form-wide, so a half-typed field here would block the
 *      article submit with an unrelated browser-language message. Validation is
 *      in JS instead.
 *   4. Enter is intercepted, or implicit submission fires the article form.
 *
 * The parent is expected to append the returned category to its own list rather
 * than refetch — see the comment on `onCreated` in admin-articles.tsx.
 */
export function CategoryQuickCreate({ onCreated }: { onCreated: (category: Category) => void }) {
  const [open, setOpen] = useState(false)
  const [nameHi, setNameHi] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [descriptionHi, setDescriptionHi] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function close() {
    setOpen(false)
    setNameHi('')
    setNameEn('')
    setSlug('')
    setSlugEdited(false)
    setDescriptionHi('')
    setError('')
  }

  async function submit() {
    const hi = nameHi.trim()
    const en = nameEn.trim()
    const finalSlug = slugify(slug || en)
    if (!hi || !en) {
      setError('हिंदी और अंग्रेज़ी नाम दोनों ज़रूरी हैं।')
      return
    }
    if (!isSlug(finalSlug)) {
      // slugify() returns '' for Devanagari by design: the slug becomes a
      // permanent public URL, so it has to be typed, not transliterated.
      setError('स्लग अंग्रेज़ी अक्षरों और अंकों में लिखें, जैसे rajniti।')
      return
    }
    setSaving(true)
    setError('')
    try {
      // A duplicate slug would collide on /category/<slug>. This is a UX guard,
      // not a constraint — `slug` is a GSI key, not a unique key — but it
      // catches the realistic case of two editors adding the same topic.
      const existing = await userPoolDataClient.models.Category.categoryBySlug(
        { slug: finalSlug },
        { limit: 1 },
      )
      const lookupError = firstErrorMessage(existing.errors)
      if (lookupError) throw new Error(lookupError)
      if (existing.data.length) {
        setError('यह स्लग पहले से मौजूद है। दूसरा स्लग चुनें।')
        return
      }
      const created = await userPoolDataClient.models.Category.create({
        slug: finalSlug,
        nameHi: hi,
        nameEn: en,
        // 100 is the schema default. There is no input for it because
        // type="number" inside the article form is a validation hazard;
        // reordering belongs on a dedicated category screen.
        displayOrder: 100,
        // Explicit, not defaulted: the article form only lists active
        // categories, so a category created here must be immediately usable.
        isActive: true,
        // Conditional spread, not `descriptionHi: x || undefined` —
        // exactOptionalPropertyTypes rejects an explicit undefined.
        ...(descriptionHi.trim() ? { descriptionHi: descriptionHi.trim() } : {}),
        // publishedArticleCount is deliberately absent: its field-level auth
        // grants read only (the publish Lambda owns it), and including it fails
        // the whole mutation. `id` is absent for the same class of reason — the
        // client refuses a caller-supplied id.
      })
      const createError = firstErrorMessage(created.errors)
      if (createError) throw new Error(createError)
      if (!created.data) throw new Error('श्रेणी नहीं बनी। कृपया फिर से कोशिश करें।')
      onCreated(created.data)
      close()
    } catch (caught) {
      setError(readableAmplifyError(caught))
    } finally {
      setSaving(false)
    }
  }

  // Without this, Enter in any of these inputs implicitly submits the ARTICLE.
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void submit()
  }

  if (!open) {
    return (
      <div className="-mt-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          + नई श्रेणी
        </Button>
      </div>
    )
  }

  return (
    <fieldset className="grid gap-4 rounded-card border border-border-strong bg-bg-subtle p-4">
      <legend className="px-2 text-sm font-bold">नई श्रेणी जोड़ें</legend>
      <FormField label="नाम (हिंदी)">
        <TextInput
          value={nameHi}
          onChange={(event) => setNameHi(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={60}
          autoComplete="off"
        />
      </FormField>
      <FormField label="Name (English)" hint="स्लग इसी नाम से बनता है।">
        <TextInput
          value={nameEn}
          onChange={(event) => {
            setNameEn(event.target.value)
            if (!slugEdited) setSlug(slugify(event.target.value))
          }}
          onKeyDown={onKeyDown}
          maxLength={60}
          autoComplete="off"
        />
      </FormField>
      {/* Not "URL स्लग" — the article form has a field by that name a few rows
          up, and two identically-labelled slug boxes on one screen is a trap. */}
      <FormField label="श्रेणी का स्लग" hint={`सार्वजनिक पता: /category/${slug || '…'}`}>
        <TextInput
          value={slug}
          onChange={(event) => {
            setSlugEdited(true)
            // Lowercased but not slugified on every keystroke, or a hyphen
            // typed mid-word would be swallowed as the user types.
            setSlug(event.target.value.toLowerCase())
          }}
          onBlur={() => setSlug(slugify(slug))}
          onKeyDown={onKeyDown}
          maxLength={MAX_SLUG_LENGTH}
          autoComplete="off"
        />
      </FormField>
      <FormField label="विवरण (हिंदी, वैकल्पिक)">
        <TextArea
          value={descriptionHi}
          onChange={(event) => setDescriptionHi(event.target.value)}
          maxLength={300}
          className="min-h-20"
        />
      </FormField>
      {error && (
        <p role="alert" className="rounded-md bg-danger-subtle p-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="button" size="sm" loading={saving} onClick={() => void submit()}>
          श्रेणी सहेजें
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={close}>
          रद्द करें
        </Button>
      </div>
    </fieldset>
  )
}
