import { randomUUID } from 'node:crypto'
import { Logger } from '@aws-lambda-powertools/logger'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import {
  ALLOWED_IMAGE_TYPES,
  isAllowedImageType,
  mediaKeyFor,
  validateUpload,
} from '../../../src/lib/domain/media'
import type { Schema } from '../../data/resource'
import { CODE, fail, ok } from './result'
import { callerFrom, isAdmin } from '../shared/identity'

const logger = new Logger({ serviceName: 'create-media-upload-url' })

type Result = Schema['createMediaUploadUrl']['returnType']

/**
 * Mint a short-lived, tightly-scoped URL an administrator can PUT one image to.
 *
 * WHY A PRESIGNED URL RATHER THAN `uploadData()` FROM THE BROWSER.
 *
 * Amplify Storage's browser client uploads with identity-pool credentials.
 * Using it would mean introducing an identity-pool client to a codebase whose
 * browser layer deliberately has none, and granting a standing S3 permission
 * to a principal for the whole session. This instead follows the doctrine the
 * rest of the system already follows — every privileged write goes through a
 * Lambda that re-derives the caller from the verified JWT — and the permission
 * it hands out is a single object key, for a few minutes.
 *
 * WHAT THIS FUNCTION DOES NOT DO: it never sees the file. Signing is local
 * arithmetic; the bytes go from the browser straight to S3. So the declared
 * content type is not verified against the file's actual magic numbers, and it
 * cannot be here. The controls that make that acceptable are downstream: the
 * object is served from a different origin than the app, and the CloudFront
 * response carries `X-Content-Type-Options: nosniff`, so a mislabelled file is
 * inert rather than executable. SVG — the one accepted-looking format that is
 * a script container — is refused outright below.
 */

/**
 * Five minutes. Long enough for a slow phone upload on a bad connection, short
 * enough that a URL leaked from browser history or a proxy log is worthless by
 * the time anyone finds it.
 */
const EXPIRES_IN_SECONDS = 300

const s3 = new S3Client({ maxAttempts: 3, requestHandler: { requestTimeout: 3_000 } })

function requiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(
      `Missing environment variable ${key}. Check grantMediaBucket() in amplify/backend.ts`,
    )
  }
  return value
}

export const handler: Schema['createMediaUploadUrl']['functionHandler'] = async (event) => {
  const caller = callerFrom(event.identity)

  // Two independent guards, in this order. AppSync has already enforced
  // `allow.group('ADMIN')` on the field, so neither should ever fire; they are
  // the second of two checks, and the one that catches a mutation added to the
  // schema without its authorization rule.
  if (!caller) return fail(CODE.UNAUTHENTICATED) as Result
  if (!isAdmin(caller)) {
    logger.warn('non-admin reached createMediaUploadUrl', { actorSub: caller.sub })
    return fail(CODE.FORBIDDEN) as Result
  }

  const articleId = String(event.arguments.articleId ?? '')
  const contentType = String(event.arguments.contentType ?? '')
  const byteSize = Number(event.arguments.byteSize ?? 0)

  const errors = validateUpload({ contentType, byteSize })
  if (errors.length > 0) {
    // No per-field detail in the response: the browser ran the same
    // `validateUpload` before asking, so it already has it.
    logger.info('upload rejected', { contentType, byteSize })
    return fail(CODE.INVALID_INPUT) as Result
  }

  // Narrowing for the type checker; validateUpload has already established it.
  if (!isAllowedImageType(contentType)) return fail(CODE.INVALID_INPUT) as Result

  /**
   * The key is built HERE, from the article id and a fresh uuid — never from
   * anything resembling a caller-supplied path or the uploaded filename. A
   * filename is attacker-controlled and routinely carries `../` or a second
   * extension. `mediaKeyFor` returns null rather than sanitising if the result
   * would not match the one legal shape, so a malformed article id cannot
   * produce a signable key.
   */
  const key = mediaKeyFor(articleId, randomUUID(), ALLOWED_IMAGE_TYPES[contentType])
  if (!key) {
    logger.warn('refused to sign a key outside the allowed shape', { articleId })
    return fail(CODE.INVALID_INPUT) as Result
  }

  logger.appendKeys({ actorSub: caller.sub, articleId })

  try {
    const bucket = requiredEnv('MEDIA_BUCKET_NAME')
    const cdnDomain = requiredEnv('MEDIA_CDN_DOMAIN')

    /**
     * `ContentType` and `ContentLength` are part of the signature, not hints.
     * A signed URL therefore accepts exactly the file that was described: the
     * browser cannot use a URL issued for a 200 KB JPEG to upload a 40 MB
     * anything, which is what stops the size limit from being purely advisory.
     */
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: byteSize,
      }),
      { expiresIn: EXPIRES_IN_SECONDS },
    )

    logger.info('upload url issued', { key, contentType, byteSize })

    return ok({
      // The CDN URL, never the bucket URL. The bucket is private — an S3 URL
      // would 403 for every reader, and publishing one would be a promise the
      // infrastructure deliberately does not keep.
      mediaUrl: `https://${cdnDomain}/${key}`,
      uploadUrl,
    }) as Result
  } catch (error) {
    // Message only, never the full error object: an SDK error carries the
    // bucket name and role shape, and neither belongs in a browser.
    logger.error('presign failed', { reason: error instanceof Error ? error.message : 'unknown' })
    return fail(CODE.INTERNAL) as Result
  }
}
