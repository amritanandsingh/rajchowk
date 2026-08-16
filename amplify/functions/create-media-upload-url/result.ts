/**
 * The shape the presign handler returns.
 *
 * Mirrors `MediaUploadResult` in amplify/data/resource.ts. A sibling of
 * shared/result.ts rather than an addition to it: that module's `ok()` takes
 * an article's id, slug and status, and widening it to cover two unrelated
 * result shapes would mean every caller passing nulls for the half it does not
 * use. Same discriminated-result idea, same codes, different payload.
 *
 * The codes come from src/lib/domain/result-code.ts, which the browser also
 * imports — one definition, so the handler and the UI cannot drift apart.
 */
import { CODE, type ResultCode } from '../../../src/lib/domain/result-code'

export { CODE }
export type { ResultCode }

export type MediaUploadResult = {
  ok: boolean
  code: string | null
  /** Presigned PUT target. Short-lived; see EXPIRES_IN_SECONDS in the handler. */
  uploadUrl: string | null
  /** The public CDN URL the editor writes into the article's Markdown. */
  mediaUrl: string | null
}

export function ok(upload: { uploadUrl: string; mediaUrl: string }): MediaUploadResult {
  return { ok: true, code: null, uploadUrl: upload.uploadUrl, mediaUrl: upload.mediaUrl }
}

/**
 * A failure.
 *
 * Carries no free-text detail and, critically, no URL — a failed request must
 * not hand back a partially-formed target. Everything diagnostic goes to
 * CloudWatch via the structured logger.
 */
export function fail(code: ResultCode): MediaUploadResult {
  return { ok: false, code, uploadUrl: null, mediaUrl: null }
}
