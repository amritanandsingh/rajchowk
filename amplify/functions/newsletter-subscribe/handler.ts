import { randomBytes } from 'node:crypto'
import { Logger } from '@aws-lambda-powertools/logger'
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import { UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { Schema } from '../../data/resource'
import { ddb, isConditionalCheckFailed, tableName } from '../shared/ddb'
import { hashIp, sha256Hex, signUnsubscribe } from '../shared/hash'
import { enforceRateLimit, ipSubject, RATE_LIMITS } from '../shared/rate-limit'
import { CODE } from '../shared/result'

const logger = new Logger()
const ses = new SESv2Client({})

type Result = Schema['newsletterSubscribe']['returnType']

/**
 * Double opt-in newsletter subscription.
 *
 * THE INVARIANT: every code path returns this identical response. Success,
 * invalid address, already subscribed, previously unsubscribed, hard-bounced,
 * rate-limited, internal error — all of them. The endpoint therefore cannot be
 * used to test whether an address is on the list, which is the standard
 * enumeration attack against a subscribe form.
 *
 * Note in particular that a rate-limited caller gets this too: a 429 would
 * itself be an oracle, since it only fires after a real attempt.
 */
const GENERIC_RESPONSE = {
  ok: true,
  code: CODE.OK,
  message: 'यदि यह पता मान्य है, तो पुष्टिकरण ईमेल भेज दिया गया है।',
} as const

/** Deliberately conservative. SES rejects the rest anyway. */
const EMAIL_PATTERN = /^[^\s@,;:<>()[\]\\]+@[^\s@,;:<>()[\]\\]+\.[a-z]{2,}$/i
const MAX_EMAIL_LENGTH = 254

export const handler: Schema['newsletterSubscribe']['functionHandler'] = async (event) => {
  const identity = event.identity as { sourceIp?: string[] } | undefined
  const sourceIp = identity?.sourceIp?.[0]
  const ipSalt = process.env.RATE_LIMIT_IP_SALT
  const ipHash = sourceIp && ipSalt ? hashIp(sourceIp, ipSalt) : undefined

  // Rate limit FIRST, on the IP, before parsing anything: this endpoint is
  // unauthenticated and is the one most worth flooding.
  const limited = await enforceRateLimit(RATE_LIMITS.newsletter(ipSubject(sourceIp)))
  if (!limited.allowed) {
    logger.warn('newsletter subscribe rate limited')
    return GENERIC_RESPONSE as Result
  }

  const email = String(event.arguments.email ?? '')
    .trim()
    .toLowerCase()
  const language = event.arguments.language === 'EN' ? 'EN' : 'HI'
  const source = String(event.arguments.source ?? 'web').slice(0, 64)

  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    logger.info('invalid address rejected')
    return GENERIC_RESPONSE as Result
  }

  // The primary key IS the email hash. Consequences, all deliberate: subscribe
  // is naturally idempotent, no index on the address exists so nothing can
  // enumerate the list, and the unsubscribe link carries a hash not an address.
  const id = sha256Hex(email)
  logger.appendKeys({ subscriberId: id })

  const TABLE = tableName('NEWSLETTER_TABLE_NAME')
  const tokenTtlHours = Number(process.env.NEWSLETTER_TOKEN_TTL_HOURS ?? 24)
  const tokenSecret = process.env.NEWSLETTER_TOKEN_SECRET
  const siteUrl = process.env.SITE_URL ?? 'http://localhost:3000'
  const fromAddress = process.env.NEWSLETTER_FROM_ADDRESS
  const configurationSet = process.env.SES_CONFIGURATION_SET

  if (!tokenSecret || !fromAddress) {
    logger.error('newsletter secrets are not configured')
    return GENERIC_RESPONSE as Result
  }

  // The RAW token exists only in the outgoing email. Only its hash is stored,
  // so a database read cannot be turned into a confirmed subscription.
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const nowIso = now.toISOString()
  const expiresIso = new Date(now.getTime() + tokenTtlHours * 3_600_000).toISOString()

  let status: string
  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression:
          'SET #typename = :typename, createdAt = if_not_exists(createdAt, :now), ' +
          'updatedAt = :now, email = :email, #language = :language, #source = :source, ' +
          '#status = if_not_exists(#status, :pending), tokenHash = :tokenHash, ' +
          'tokenExpiresAt = :expires, consentIpHash = :ipHash, ' +
          'attemptCount = if_not_exists(attemptCount, :zero) + :one',
        // Never resurrect someone who opted out or hard-bounced. Silently.
        ConditionExpression: 'attribute_not_exists(#status) OR #status IN (:pending, :confirmed)',
        ExpressionAttributeNames: {
          '#typename': '__typename',
          '#status': 'status',
          '#language': 'language',
          '#source': 'source',
        },
        ExpressionAttributeValues: {
          ':typename': 'NewsletterSubscription',
          ':now': nowIso,
          ':email': email,
          ':language': language,
          ':source': source,
          ':pending': 'PENDING',
          ':confirmed': 'CONFIRMED',
          ':tokenHash': sha256Hex(token),
          ':expires': expiresIso,
          ':ipHash': ipHash ?? null,
          ':zero': 0,
          ':one': 1,
        },
        ReturnValues: 'ALL_NEW',
      }),
    )
    status = String(result.Attributes?.status ?? 'PENDING')
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      logger.info('suppressed address, not re-subscribing')
      return GENERIC_RESPONSE as Result
    }
    logger.error('subscription upsert failed', { error: error as Error })
    return GENERIC_RESPONSE as Result
  }

  // Already confirmed: send nothing. Re-sending a confirmation is an
  // enumeration oracle via mailbox side-effects, and it annoys real subscribers.
  if (status === 'CONFIRMED') {
    logger.info('already confirmed, no email sent')
    return GENERIC_RESPONSE as Result
  }

  const verifyUrl = `${siteUrl}/newsletter/verify?id=${id}&t=${encodeURIComponent(token)}`
  const unsubscribeUrl = `${siteUrl}/api/newsletter/unsubscribe?id=${id}&s=${signUnsubscribe(id, tokenSecret)}`

  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: fromAddress,
        Destination: { ToAddresses: [email] },
        ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
        Content: {
          Simple: {
            Subject: { Data: 'राज चौक — अपना ईमेल सत्यापित करें', Charset: 'UTF-8' },
            Body: {
              Html: { Data: verifyHtml(verifyUrl, unsubscribeUrl), Charset: 'UTF-8' },
              Text: { Data: verifyText(verifyUrl, unsubscribeUrl), Charset: 'UTF-8' },
            },
            // RFC 8058. Required by Gmail and Yahoo bulk-sender rules since
            // 2024; without it deliverability degrades regardless of content.
            Headers: [
              { Name: 'List-Unsubscribe', Value: `<${unsubscribeUrl}>` },
              { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
            ],
          },
        },
      }),
    )
    logger.info('verification email sent')
  } catch (error) {
    // Still the generic response. The alarm on this Lambda's error metric is
    // what surfaces an SES outage — the caller must learn nothing.
    logger.error('SES send failed', { error: error as Error })
  }

  return GENERIC_RESPONSE as Result
}

function verifyHtml(verifyUrl: string, unsubscribeUrl: string): string {
  return `<!doctype html>
<html lang="hi"><body style="margin:0;padding:24px;background:#fbfaf7;font-family:'Noto Sans Devanagari',Arial,sans-serif;color:#1c1e26">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e4e8;border-radius:8px;padding:28px">
<h1 style="margin:0 0 16px;font-size:22px">राज चौक न्यूज़लेटर</h1>
<p style="margin:0 0 20px;line-height:1.7">सदस्यता की पुष्टि करने के लिए नीचे दिए बटन पर क्लिक करें।</p>
<p style="margin:0 0 24px"><a href="${verifyUrl}" style="display:inline-block;background:#1e2a53;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:700">ईमेल सत्यापित करें</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#5c6070;line-height:1.7">यह लिंक 24 घंटे में समाप्त हो जाएगा। यदि आपने सदस्यता नहीं ली है, तो इस ईमेल को अनदेखा करें — बिना पुष्टि के कोई ईमेल नहीं भेजा जाएगा।</p>
<p style="margin:16px 0 0;font-size:12px;color:#5c6070"><a href="${unsubscribeUrl}" style="color:#5c6070">सदस्यता समाप्त करें</a></p>
</div></body></html>`
}

function verifyText(verifyUrl: string, unsubscribeUrl: string): string {
  return [
    'राज चौक न्यूज़लेटर',
    '',
    'सदस्यता की पुष्टि करने के लिए यह लिंक खोलें:',
    verifyUrl,
    '',
    'यह लिंक 24 घंटे में समाप्त हो जाएगा।',
    'यदि आपने सदस्यता नहीं ली है, तो इस ईमेल को अनदेखा करें।',
    '',
    `सदस्यता समाप्त करें: ${unsubscribeUrl}`,
  ].join('\n')
}
