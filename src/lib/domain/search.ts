/**
 * Search term normalisation — the single definition, shared by every caller.
 *
 * Pure module, same discipline as article.ts: no React, no next/*, no DOM
 * globals. Three places need to agree about what a search term is — the page
 * that reads `?q=`, the input that types one, and the data layer that sends it
 * to AppSync — and when they disagree the failure is silent. An input capped
 * at 80 while the query caps at 100 means a term the reader can type but never
 * match; a page that forgets to normalise means a decomposed Devanagari word
 * that returns nothing while an identical-looking one returns results.
 *
 * The resolver keeps its own copy of these bounds, because it is the layer
 * that actually protects DynamoDB and a URL is not a form. Two independent
 * clamps, exactly as `MAX_PAGE` in the data layer duplicates the resolver's.
 */

export const SEARCH_TERM_LIMITS = {
  /** One character matches nearly every article and costs a full partition
   *  read to prove it. Two is the shortest term worth a query. */
  min: 2,
  /**
   * Counted in UTF-16 code units, like ARTICLE_LIMITS — so this over-counts a
   * rendered Devanagari term, which is why it is generous. Nobody searching in
   * good faith types 80 units; a longer one is a probe.
   */
  max: 80,
} as const

/**
 * NFC, trim, cap.
 *
 * NFC is the load-bearing part. Article text is NFC-normalised on write
 * (`normalizeArticleInput`), and DynamoDB's `contains` compares bytes, so a
 * term typed with decomposed matras matches nothing at all — not fewer
 * results, none. The APPSYNC_JS runtime has no `String.normalize`, so this is
 * the last place the correction can be made before the term hits the index.
 *
 * The trailing trim is not redundant: slicing at `max` can leave the whitespace
 * that the first trim was never given a chance to see.
 */
export function normalizeSearchTerm(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.normalize('NFC').trim().slice(0, SEARCH_TERM_LIMITS.max).trim()
}

/** Whether a normalised term is worth a round trip. Callers short-circuit on
 *  this rather than letting the resolver reject it — a one-character term is
 *  not an error worth a network hop and a CloudWatch line. */
export function isSearchable(term: string): boolean {
  return term.length >= SEARCH_TERM_LIMITS.min
}
