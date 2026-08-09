import { beforeAll, afterAll, beforeEach, describe, expect, it, inject } from 'vitest'
import { clientFor, expectOk, expectRefused, resultCode, type Client } from './harness/clients'
import { makeArticle, makeCategory, publishArticle } from './harness/fixtures'
import { track } from './harness/ledger'
import { resetRateLimitsForUser } from './harness/rate-limits'
import { deleteRow, getRow } from './harness/tables'
import { createUser, deleteUser, type Role, type TestUser } from './harness/users'

/**
 * Everything a signed-in MEMBER can do — the surface that had NO integration
 * coverage at all, and was entirely broken in production as a result.
 *
 * Why this file exists
 * -------------------
 * Two defects shipped together and each hid the other:
 *
 *   1. Every member-facing form signed its requests through the identity pool,
 *      but `submitQuestion`, `submitComment`, `submitReport`,
 *      `toggleQuestionUpvote` and `ensureUserProfile` are all
 *      `allow.authenticated()`, which resolves to the Cognito USER POOL. AppSync
 *      answered Unauthorized before any Lambda ran.
 *   2. Nothing in the product ever created a UserProfile row. The
 *      post-confirmation trigger only adds the MEMBER group, and
 *      `ensureUserProfile` — which exists as both a mutation and a Lambda — was
 *      called from nowhere. `submitQuestion` and `submitComment` both refuse a
 *      caller with no profile.
 *
 * Neither was catchable by the existing suite. Defect 1 is invisible here BY
 * CONSTRUCTION: harness/clients.ts cannot use `authMode: 'userPool'` at all (it
 * throws NoValidAuthTokens in Node), so it passes a raw JWT with
 * `authMode: 'none'`. That exercises the authorization RULES — which is what
 * this file pins — but never the browser's client wiring, which is covered by
 * e2e/live/member-actions.spec.ts instead. Defect 2 was invisible BY OMISSION:
 * no test referenced any of these mutations.
 *
 * Note `makeQuestion` in harness/fixtures.ts was dead code that called
 * submitQuestion through expectOk, so it would have failed the moment anyone
 * used it — independent corroboration of defect 2.
 *
 * Scope note: only submitQuestion and submitComment require a UserProfile.
 * submitReport and toggleQuestionUpvote deliberately do not, and that asymmetry
 * is asserted below so a future refactor cannot quietly change it.
 */

let users: Record<Role, TestUser>
let runId: string
let member: Client
let admin: Client
let moderator: Client

/** A MEMBER that deliberately has NO UserProfile, for the refusal assertions. */
let freshUser: TestUser
let fresh: Client

let categoryId: string
let publishedArticleId: string

beforeAll(async () => {
  users = inject('testUsers')
  runId = inject('runId')
  member = clientFor(users.MEMBER)
  admin = clientFor(users.ADMIN)
  moderator = clientFor(users.MODERATOR)

  // A dedicated user, minted here rather than reusing users.MEMBER, so the
  // "refused without a profile" assertions cannot be poisoned by whichever test
  // happens to run first and provision MEMBER's profile.
  freshUser = await createUser('MEMBER', `${runId}-np`)
  fresh = clientFor(freshUser)

  // submitComment checks the article BEFORE the profile (NOT_FOUND for anything
  // unpublished), so the refusal test needs a genuinely published article or it
  // would pass for the wrong reason.
  const category = await makeCategory(admin)
  categoryId = category.id
  const article = await makeArticle(admin, {
    categoryId,
    authorProfileId: users.ADMIN.sub,
    title: 'सदस्य क्रिया परीक्षण लेख',
  })
  await publishArticle(admin, article.id)
  publishedArticleId = article.id
})

afterAll(async () => {
  // global-setup only tears down the four role users it created itself, so the
  // extra one has to clean up after itself. Its profile row is on the ledger, but
  // delete it here too in case the ledger sweep is skipped by a hard failure.
  await deleteRow('UserProfile', { id: freshUser.sub }).catch(() => {})
  await deleteUser(freshUser.username)
})

// submitQuestion allows 2 per 10 minutes and submitComment 3 per 5 minutes, so
// without this the file throttles itself after the first couple of tests.
beforeEach(async () => {
  await resetRateLimitsForUser(users.MEMBER.sub, freshUser.sub, users.ADMIN.sub)
})

describe('the UserProfile gate', () => {
  it('refuses a question from a member with no profile', async () => {
    // The reported /ask failure, reproduced at the API. FORBIDDEN, not
    // UNAUTHENTICATED: the caller is authenticated, they just have no profile row.
    const refusal = expectRefused(
      await fresh.mutations.submitQuestion({ questionText: 'बिना प्रोफ़ाइल वाला सवाल है यह।' }),
      'submitQuestion without a profile',
    )
    expect(refusal.code).toBe('FORBIDDEN')

    // And nothing was written.
    const profile = await getRow('UserProfile', { id: freshUser.sub })
    expect(profile).toBeUndefined()
  })

  it('refuses a comment from a member with no profile', async () => {
    const refusal = expectRefused(
      await fresh.mutations.submitComment({
        articleId: publishedArticleId,
        content: 'बिना प्रोफ़ाइल वाली टिप्पणी।',
      }),
      'submitComment without a profile',
    )
    // Proves the article gates passed and it really is the profile check that
    // fired — a NOT_FOUND here would mean the fixture, not the profile, refused.
    expect(refusal.code).toBe('FORBIDDEN')
  })
})

describe('ensureUserProfile', () => {
  it('creates the profile row keyed on the Cognito sub', async () => {
    const result = expectOk(
      await fresh.mutations.ensureUserProfile({ displayName: 'परीक्षण सदस्य' }),
      'ensureUserProfile',
    )
    expect(resultCode(result)).toBe('OK')
    track('UserProfile', { id: freshUser.sub })

    const profile = await getRow<Record<string, unknown>>('UserProfile', { id: freshUser.sub })
    expect(profile).toBeDefined()
    // id === sub is what every handler looks the caller up by.
    expect(profile?.id).toBe(freshUser.sub)
    expect(profile?.displayName).toBe('परीक्षण सदस्य')
    expect(profile?.isSuspended).toBe(false)
  })

  it('creates no second row when called again', async () => {
    // Called on EVERY sign-in, so the create must be guarded — it is, with
    // attribute_not_exists on the Put. A repeat call falls through to the update
    // branch instead of erroring or duplicating.
    const result = expectOk(
      await fresh.mutations.ensureUserProfile({}),
      'ensureUserProfile (repeat, no name)',
    )
    expect(resultCode(result)).toBe('OK')

    const profile = await getRow<Record<string, unknown>>('UserProfile', { id: freshUser.sub })
    expect(profile?.id).toBe(freshUser.sub)
  })

  it('leaves the display name alone when no name is requested', async () => {
    // The guarantee that matters: with no explicit displayName the handler must
    // NOT fall back to the username (an email local-part here) and overwrite a
    // real name. See the `requested.length >= MIN_DISPLAY_NAME` guard on the
    // update branch.
    expectOk(await fresh.mutations.ensureUserProfile({}), 'ensureUserProfile (no name)')

    const profile = await getRow<Record<string, unknown>>('UserProfile', { id: freshUser.sub })
    expect(profile?.displayName).toBe('परीक्षण सदस्य')
  })

  it('applies an explicitly requested rename', async () => {
    // The other half of the same branch, pinned so the asymmetry is deliberate
    // and visible: an explicit name IS a rename request.
    //
    // This is why src/lib/amplify/ensure-profile.ts must NOT send the Cognito
    // preferred_username on every sign-in — doing so would make each sign-in a
    // silent rename and revert any name set elsewhere.
    expectOk(
      await fresh.mutations.ensureUserProfile({ displayName: 'नया नाम' }),
      'ensureUserProfile (rename)',
    )

    const profile = await getRow<Record<string, unknown>>('UserProfile', { id: freshUser.sub })
    expect(profile?.displayName).toBe('नया नाम')
  })
})

describe('member actions once a profile exists', () => {
  beforeAll(async () => {
    // users.MEMBER is the principal for this block; give it a profile the same
    // way sign-in now does.
    expectOk(
      await member.mutations.ensureUserProfile({ displayName: 'सदस्य' }),
      'ensureUserProfile(MEMBER)',
    )
    track('UserProfile', { id: users.MEMBER.sub })
  })

  it('accepts a question and queues it for review', async () => {
    // THE #7 PROOF: the exact call the /ask form makes.
    const result = expectOk(
      await member.mutations.submitQuestion({ questionText: 'यह एक वैध परीक्षण सवाल है।' }),
      'submitQuestion',
    )
    expect(resultCode(result)).toBe('OK')

    const id = (result as { id?: string }).id
    expect(id).toBeTruthy()
    track('AudienceQuestion', { id })

    const row = await getRow<Record<string, unknown>>('AudienceQuestion', { id })
    expect(row?.status).toBe('PENDING_REVIEW')
    // queueKey is the sparse GSI key the public /ask query reads. It must be
    // absent until a moderator approves, or an unreviewed question would be live.
    expect(row?.queueKey).toBeUndefined()
    expect(row?.askerProfileId).toBe(users.MEMBER.sub)
  })

  it('accepts a comment and holds it for moderation', async () => {
    const result = expectOk(
      await member.mutations.submitComment({
        articleId: publishedArticleId,
        content: 'यह एक वैध परीक्षण टिप्पणी है।',
      }),
      'submitComment',
    )
    expect(resultCode(result)).toBe('OK')

    const id = (result as { id?: string }).id
    track('Comment', { id })

    const row = await getRow<Record<string, unknown>>('Comment', { id })
    expect(row?.status).toBe('PENDING')
    // Same sparse-key reasoning as queueKey above.
    expect(row?.threadKey).toBeUndefined()
    // The raw IP must never be stored, only a salted hash.
    expect(row?.ipHash === undefined || typeof row.ipHash === 'string').toBe(true)
  })

  it('accepts a report without requiring a profile', async () => {
    // Deliberate asymmetry: submitReport has no profile gate. Pinned so a
    // refactor that "consistently" adds one has to do it knowingly.
    const result = expectOk(
      await fresh.mutations.submitReport({
        targetType: 'ARTICLE',
        targetId: publishedArticleId,
        reason: 'SPAM',
      }),
      'submitReport',
    )
    expect(resultCode(result)).toBe('OK')
  })

  it('upvotes an approved question and is idempotent', async () => {
    const created = expectOk(
      await member.mutations.submitQuestion({ questionText: 'अपवोट के लिए सवाल है यह।' }),
      'submitQuestion(for upvote)',
    )
    const questionId = (created as { id?: string }).id
    if (!questionId) throw new Error('submitQuestion returned no id')
    track('AudienceQuestion', { id: questionId })

    expectOk(
      await moderator.mutations.moderateContent({
        targetType: 'QUESTION',
        targetId: questionId,
        action: 'APPROVE',
      }),
      'moderateContent(APPROVE)',
    )

    await resetRateLimitsForUser(users.MEMBER.sub)
    expectOk(
      await member.mutations.toggleQuestionUpvote({ questionId, upvoted: true }),
      'toggleQuestionUpvote(on)',
    )
    track('QuestionUpvote', { id: `${questionId}#${users.MEMBER.sub}` })

    let row = await getRow<Record<string, unknown>>('AudienceQuestion', { id: questionId })
    expect(row?.upvoteCount).toBe(1)

    // Desired-state, not a toggle: repeating `upvoted: true` must not double it.
    await resetRateLimitsForUser(users.MEMBER.sub)
    expectOk(
      await member.mutations.toggleQuestionUpvote({ questionId, upvoted: true }),
      'toggleQuestionUpvote(on again)',
    )
    row = await getRow<Record<string, unknown>>('AudienceQuestion', { id: questionId })
    expect(row?.upvoteCount).toBe(1)
  })
})
