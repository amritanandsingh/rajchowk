/**
 * Devanagari text normalisation for search.
 *
 * THE RULE: this module is imported by BOTH the write path (publish-article,
 * building the index) and the query path (search-content). Its output must be
 * byte-identical on both, or indexed documents become permanently unreachable.
 * Never fork this logic, and never "fix" one caller without the other.
 *
 * Each transformation below exists because Hindi readers genuinely type the
 * same word more than one way:
 *  - ज़रूरी / जरूरी          (nukta, routinely omitted)
 *  - संबंध / सम्बन्ध          (anusvara vs conjunct nasal, both standard)
 *  - क़िला / क़िला            (precomposed vs base+nukta — same grapheme, two encodings)
 *  - "Delhi में फैसला"       (code-mixed headlines are the norm, not the exception)
 */

/** Zero-width joiner and non-joiner. Invisible, inserted inconsistently by
 *  different keyboards, and therefore undebuggable by eye. */
const ZERO_WIDTH = /[‌‍﻿]/g

/** U+093C DEVANAGARI SIGN NUKTA. */
const NUKTA = /़/g

/** Danda, double danda, and general punctuation. */
const PUNCTUATION = /[।॥.,;:!?'"“”‘’()[\]{}<>/\\|@#$%^&*_+=~`—–-]/g

/** Devanagari digits ०-९ (U+0966–U+096F) → ASCII. */
const DEVANAGARI_DIGITS = /[०-९]/g

/**
 * Precomposed nukta letters (U+0958–U+095F).
 *
 * These are singleton decompositions that Unicode EXCLUDES from recomposition,
 * so NFC leaves them exactly as they are — क़ typed one way stays U+0958 while
 * the same grapheme typed another way stays क + U+093C. Normalising them by
 * hand to base + nukta is what makes the two encodings comparable; the nukta
 * is then stripped along with every other one.
 */
const PRECOMPOSED_NUKTA: Record<string, string> = {
  क़: 'क़', // क़
  ख़: 'ख़', // ख़
  ग़: 'ग़', // ग़
  ज़: 'ज़', // ज़
  ड़: 'ड़', // ड़
  ढ़: 'ढ़', // ढ़
  फ़: 'फ़', // फ़
  य़: 'य़', // य़
}

/**
 * Conjunct nasal → anusvara.
 *
 * सम्बन्ध and संबंध are the same word and both spellings are in everyday use.
 * Folding toward anusvara (the shorter form) is arbitrary but consistent,
 * which is the only property that matters.
 */
const CONJUNCT_NASALS: ReadonlyArray<readonly [RegExp, string]> = [
  [/म्(?=[प-भ])/g, 'ं'], // म् before प-भ
  [/न्(?=[त-ध])/g, 'ं'], // न् before त-ध
  [/ण्(?=[ट-ढ])/g, 'ं'], // ण् before ट-ढ
  [/ञ्(?=[च-झ])/g, 'ं'], // ञ् before च-झ
  [/ङ्(?=[क-घ])/g, 'ं'], // ङ् before क-घ
]

/** Postpositions and function words. Deliberately short — over-aggressive
 *  stopword removal makes short headline queries return nothing. */
const STOPWORDS = new Set([
  'का',
  'के',
  'की',
  'को',
  'में',
  'से',
  'पर',
  'और',
  'है',
  'हैं',
  'था',
  'थे',
  'थी',
  'यह',
  'वह',
  'कि',
  'ने',
  'ही',
  'भी',
  'तो',
  'एक',
  'हो',
  'गया',
  'लिए',
  'a',
  'an',
  'the',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'and',
  'is',
  'are',
  'was',
  'were',
])

/**
 * Normalise a string into its search form.
 *
 * Order matters: precomposed letters must be expanded before the nukta is
 * stripped, and NFC must run first so combining marks are in a known order.
 */
export function normalizeForSearch(input: string): string {
  if (!input) return ''

  let text = input.normalize('NFC')

  for (const [precomposed, expanded] of Object.entries(PRECOMPOSED_NUKTA)) {
    text = text.split(precomposed).join(expanded)
  }

  text = text.replace(ZERO_WIDTH, '')
  text = text.replace(NUKTA, '')

  for (const [pattern, replacement] of CONJUNCT_NASALS) {
    text = text.replace(pattern, replacement)
  }

  text = text.replace(DEVANAGARI_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0966))

  // Devanagari is caseless, so this only affects the Latin portion — which
  // matters, because headlines are routinely code-mixed.
  text = text.toLowerCase()

  text = text.replace(PUNCTUATION, ' ')

  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Split normalised text into search tokens.
 *
 * Hindi is space-delimited, so unlike Thai or Japanese no segmenter is needed.
 * That single fact is what makes DynamoDB-backed search viable here at all.
 */
export function tokenize(input: string, options: { maxTokens?: number } = {}): string[] {
  const { maxTokens = 60 } = options
  const normalized = normalizeForSearch(input)
  if (!normalized) return []

  const seen = new Set<string>()
  const tokens: string[] = []

  for (const token of normalized.split(' ')) {
    // Single characters are noise: they match nearly everything and blow up
    // the inverted index.
    if (token.length < 2) continue
    if (STOPWORDS.has(token)) continue
    if (seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
    if (tokens.length >= maxTokens) break
  }

  return tokens
}

export function isStopword(token: string): boolean {
  return STOPWORDS.has(normalizeForSearch(token))
}

/**
 * Strip markdown to plain text for excerpts, reading time and the search index.
 *
 * Deliberately a lightweight pass rather than a full parse: it runs on the
 * publish path where a heavyweight AST walk would add cold-start weight for no
 * benefit, and imprecision here costs an approximate word count, nothing more.
 */
export function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^\s{0,3}::+[a-z]+\{[^}]*\}\s*$/gim, ' ') // ::youtube{...} directives
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}([*+-]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/^\s{0,3}([-*_]\s*){3,}$/gm, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Word count for Devanagari and Latin.
 *
 * Both scripts are space-delimited, so a whitespace split is correct for both.
 */
export function countWords(plainText: string): number {
  const trimmed = plainText.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

/**
 * Reading time in minutes.
 *
 * 200 wpm, not the 265 wpm figure used for English. Devanagari carries more
 * information per word and readers of long-form Hindi measurably read it
 * slower; using the Latin default understates every article by ~25%.
 */
export function readingMinutes(plainText: string, wordsPerMinute = 200): number {
  const words = countWords(plainText)
  if (words === 0) return 0
  return Math.max(1, Math.ceil(words / wordsPerMinute))
}

/**
 * Truncate without splitting a grapheme cluster.
 *
 * Slicing Devanagari by UTF-16 code unit can cut a consonant away from its
 * matra and produce a visibly broken cluster. Intl.Segmenter is the only
 * correct way to do this.
 */
export function truncateGraphemes(input: string, maxGraphemes: number, ellipsis = '…'): string {
  if (!input) return ''

  const segmenter = new Intl.Segmenter('hi', { granularity: 'grapheme' })
  const graphemes = [...segmenter.segment(input)].map((segment) => segment.segment)

  if (graphemes.length <= maxGraphemes) return input
  return graphemes.slice(0, maxGraphemes).join('').trimEnd() + ellipsis
}

/**
 * URL slug from a title.
 *
 * Devanagari is NOT transliterated. A romanised slug requires a transliteration
 * table that will mangle names, and percent-encoded Devanagari in a URL is
 * ugly and breaks when pasted into WhatsApp. Instead the slug keeps Devanagari
 * characters as-is — they are valid in an IRI path segment, every modern
 * browser displays them correctly, and Google indexes them fine. Callers that
 * need a purely ASCII slug pass an explicit `slugOverride` in the editor.
 */
export function slugify(title: string, options: { maxLength?: number } = {}): string {
  const { maxLength = 80 } = options

  const slug = title
    .normalize('NFC')
    .replace(ZERO_WIDTH, '')
    .toLowerCase()
    // Devanagari punctuation lives INSIDE the U+0900-U+097F block, so the
    // keep-filter below would happily preserve it. Strip it explicitly first:
    // U+0964 danda, U+0965 double danda, U+0970 abbreviation sign,
    // U+0971 high spacing dot.
    .replace(/[।॥॰ॱ]/g, ' ')
    // ASCII digits read better in a URL than २०२६.
    .replace(DEVANAGARI_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0966))
    .replace(/[\s ]+/g, '-')
    // Keep Devanagari letters, matras and marks (U+0900-U+0963, U+0972-U+097F),
    // ASCII alphanumerics, and hyphens.
    .replace(/[^ऀ-ॣॲ-ॿa-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')

  if (slug.length <= maxLength) return slug

  // Cut at a word boundary rather than mid-word.
  const cut = slug.slice(0, maxLength)
  const lastHyphen = cut.lastIndexOf('-')
  return (lastHyphen > maxLength * 0.6 ? cut.slice(0, lastHyphen) : cut).replace(/-+$/, '')
}
