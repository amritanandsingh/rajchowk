/**
 * Article validation — the single definition, shared by both sides.
 *
 * Pure module: imported by the Lambdas in amplify/ by relative path, so no
 * React, no next/*, no DOM globals, no `@/` aliases.
 *
 * WHY ONE MODULE AND NOT TWO. The obvious alternative is a zod schema in the
 * form and an ad-hoc `if (!title) return 400` in the handler. That drifts: the
 * form starts accepting a 300-character title the handler rejects, and the
 * editor sees a generic failure after typing an entire article. Here the
 * browser check and the authoritative check are literally the same function,
 * so they cannot disagree.
 *
 * The client-side call is a CONVENIENCE — it exists to give fast, per-field
 * feedback. The call inside the Lambda is the one that decides, and it runs
 * against arguments that have crossed the network and cannot be trusted no
 * matter what the form did.
 */

/**
 * Bounds.
 *
 * Counted in JS string length (UTF-16 code units), which for Devanagari
 * over-counts a rendered character: "क्या" is 4 code units for 2 visible
 * glyphs, and combining matras inflate it further. The limits below are
 * therefore generous by Latin standards on purpose — a 200-unit ceiling would
 * cut a legitimate Hindi headline well before it looked long.
 */
export const ARTICLE_LIMITS = {
  title: { min: 4, max: 300 },
  summary: { min: 10, max: 600 },
  // DynamoDB's hard item ceiling is 400 KB for the whole row. 200 000 UTF-16
  // units is ~400 KB at worst-case 2 bytes each for Devanagari, so this is the
  // limit that keeps a save from failing with an opaque ValidationException
  // from DynamoDB instead of a readable message.
  content: { min: 20, max: 200_000 },
} as const

export type ArticleField = keyof typeof ARTICLE_LIMITS

/** A validation failure, keyed by field so the form can place it. */
export type ArticleFieldError = { field: ArticleField | 'slug'; message: string }

export type ArticleInput = {
  title: string
  summary: string
  content: string
  slug?: string | null | undefined
}

/** Hindi messages: every consumer of these is an admin surface, which is
 *  Hindi-only. See src/lib/i18n/hi.ts for the rest of the copy. */
const FIELD_LABELS: Record<ArticleField, string> = {
  title: 'शीर्षक',
  summary: 'सारांश',
  content: 'लेख',
}

/**
 * Normalise before validating.
 *
 * Trimming is not cosmetic here: a title of "   " passes a naive
 * `!title` check, produces an empty slug, and lands in the feed as a blank
 * headline. Normalising to NFC matters for Devanagari specifically — the same
 * word can arrive decomposed or precomposed depending on the input method, and
 * two visually identical titles would otherwise produce two different slugs.
 */
export function normalizeArticleInput(input: ArticleInput): ArticleInput {
  return {
    title: input.title.normalize('NFC').trim(),
    summary: input.summary.normalize('NFC').trim(),
    // Content keeps its internal whitespace — Markdown is whitespace-sensitive
    // and re-indenting a fenced code block would change what it means. Only
    // the leading/trailing padding goes.
    content: input.content.normalize('NFC').trim(),
    slug: input.slug?.trim().toLowerCase() ?? null,
  }
}

/**
 * Validate a normalised article.
 *
 * Returns every error rather than the first, so the form can mark all the
 * offending fields in one pass instead of making the editor discover them one
 * submit at a time.
 *
 * Callers must normalise first — validating raw input would reject a title
 * that is perfectly valid once trimmed. `validateArticle(normalizeArticleInput(x))`
 * is the intended shape, and `parseArticleInput` below packages it.
 */
export function validateArticle(input: ArticleInput): ArticleFieldError[] {
  const errors: ArticleFieldError[] = []

  for (const field of ['title', 'summary', 'content'] as const) {
    const value = input[field]
    const { min, max } = ARTICLE_LIMITS[field]
    const label = FIELD_LABELS[field]

    if (value.length === 0) {
      errors.push({ field, message: `${label} आवश्यक है।` })
      continue
    }
    if (value.length < min) {
      errors.push({ field, message: `${label} कम से कम ${min} अक्षर का होना चाहिए।` })
      continue
    }
    if (value.length > max) {
      errors.push({ field, message: `${label} अधिकतम ${max} अक्षर का हो सकता है।` })
    }
  }

  // An empty/absent slug is valid — it means "derive one". Only a slug the
  // editor actually typed, in the wrong shape, is an error.
  if (input.slug) {
    // Imported lazily-shaped to keep this module's dependency graph flat; see
    // the note at the top about Lambda bundling.
    const ok = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) && input.slug.length <= 80
    if (!ok) {
      errors.push({
        field: 'slug',
        message: 'URL में केवल छोटे अंग्रेज़ी अक्षर, अंक और हाइफ़न चलेंगे (अधिकतम 80)।',
      })
    }
  }

  return errors
}

export type ParseResult =
  { ok: true; value: ArticleInput } | { ok: false; errors: ArticleFieldError[] }

/**
 * Normalise then validate — the form of this that callers should reach for.
 *
 * The handler uses the normalised `value` for the write, which is what keeps
 * a trailing-newline title out of the database even though it validated fine.
 */
export function parseArticleInput(input: ArticleInput): ParseResult {
  const value = normalizeArticleInput(input)
  const errors = validateArticle(value)
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value }
}
