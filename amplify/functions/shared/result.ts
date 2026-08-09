/**
 * The shape both write handlers return.
 *
 * Mirrors `ArticleMutationResult` in amplify/data/resource.ts. The codes come
 * from src/lib/domain/result-code.ts, which the browser also imports — one
 * definition, so the handler and the UI cannot drift apart on what 'CONFLICT'
 * means.
 */
import { CODE, type ResultCode } from '../../../src/lib/domain/result-code'

export { CODE }
export type { ResultCode }

export type ArticleResult = {
  ok: boolean
  code: string | null
  articleId: string | null
  slug: string | null
  status: string | null
}

export function ok(article: {
  id: string
  slug: string
  status: string
  code?: ResultCode
}): ArticleResult {
  return {
    ok: true,
    // Normally null. Carries DUPLICATE when an idempotent retry matched an
    // existing article — the write did not happen, but the caller's intent is
    // satisfied, so this is a success with a note rather than a failure.
    code: article.code ?? null,
    articleId: article.id,
    slug: article.slug,
    status: article.status,
  }
}

/**
 * A failure.
 *
 * Deliberately carries no free-text detail. Everything diagnostic goes to
 * CloudWatch via the structured logger; echoing an exception message to the
 * browser leaks table names and IAM shape to an attacker and tells the editor
 * nothing they can act on. The code is enough for the UI to choose its copy.
 */
export function fail(code: ResultCode): ArticleResult {
  return { ok: false, code, articleId: null, slug: null, status: null }
}
