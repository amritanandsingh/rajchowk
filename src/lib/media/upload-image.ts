'use client'

import { firstErrorMessage, userPoolDataClient } from '@/lib/amplify/browser-client'
import { validateUpload } from '@/lib/domain/media'
import { resultMessage } from '@/lib/domain/result-code'

/**
 * Upload one article image, in two hops.
 *
 * A separate module from browser-client.ts on purpose. That file is wholly
 * replaced by a `vi.mock` factory in article-form.test.tsx, and every export
 * added to it has to be hand-stubbed there or the import fails at collection
 * time. Keeping this here means the form's tests mock ONE small module with an
 * obvious shape instead of growing the Amplify stub.
 *
 * WHY TWO HOPS. The mutation returns a signed URL rather than accepting the
 * file, so the bytes never pass through AppSync or a Lambda — no 6 MB payload
 * limit, no base64 inflation, no compute time proportional to file size. The
 * PUT goes straight to S3 from the browser, and `connect-src` in the CSP
 * already permits `https://*.amazonaws.com`, so this needs no policy change.
 */

export type UploadResult =
  { ok: true; mediaUrl: string } | { ok: false; message: string; sessionExpired?: true }

/** Thrown by the mutation call when the Cognito session is gone. Re-thrown so
 *  the caller can navigate rather than render a message beside a control that
 *  will keep failing — the same treatment save/publish already give it. */
export async function uploadArticleImage(articleId: string, file: File): Promise<UploadResult> {
  /**
   * Validate before asking for anything. This is the SAME function the Lambda
   * runs, so the two cannot disagree about what is acceptable — and failing
   * here means a 40 MB file never leaves the machine.
   */
  const errors = validateUpload({ contentType: file.type, byteSize: file.size })
  if (errors.length > 0) {
    return { ok: false, message: errors.map((error) => error.message).join(' ') }
  }

  const issued = await userPoolDataClient.mutations.createMediaUploadUrl({
    articleId,
    contentType: file.type,
    byteSize: file.size,
  })

  // The v6 client resolves with `{ data, errors }` rather than throwing, so an
  // unchecked `data` would render success over a refused request.
  const transportError = firstErrorMessage(issued.errors)
  if (transportError) return { ok: false, message: transportError }

  const result = issued.data
  if (!result?.ok || !result.uploadUrl || !result.mediaUrl) {
    return { ok: false, message: resultMessage(result?.code) }
  }

  /**
   * `Content-Type` must match what was signed, byte for byte. It is part of
   * the signature, not a hint: S3 rejects the PUT outright if it differs,
   * which is what stops a URL issued for a small JPEG being reused for
   * something else.
   */
  const put = await fetch(result.uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  })

  if (!put.ok) {
    // The S3 error body is XML and says nothing an editor can act on; the
    // status is what a developer needs from a bug report.
    return { ok: false, message: `चित्र अपलोड नहीं हो सका (${put.status})।` }
  }

  return { ok: true, mediaUrl: result.mediaUrl }
}

/**
 * Splice a Markdown image into `content` at the caret.
 *
 * Pure and exported so it can be tested without a DOM: the interesting cases
 * are all about offsets, and driving them through a real textarea would test
 * jsdom's selection model more than this logic.
 *
 * Blank lines around the image are not cosmetic — Markdown needs the image to
 * be its own block, or it renders inline inside the surrounding paragraph.
 * They are added only where one is not already present, so repeated inserts do
 * not accumulate vertical space.
 */
export function insertImageMarkdown(
  content: string,
  caret: number,
  image: { url: string; alt: string },
): { text: string; caretAfter: number } {
  const at = Math.max(0, Math.min(caret, content.length))
  const before = content.slice(0, at)
  const after = content.slice(at)

  const leading =
    before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const trailing =
    after.length === 0 || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'

  const snippet = `${leading}![${image.alt}](${image.url})${trailing}`

  return { text: `${before}${snippet}${after}`, caretAfter: at + snippet.length }
}
