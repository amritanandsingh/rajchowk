import { beforeAll, describe, expect, it, inject } from 'vitest'
import { clientFor, expectOk, wasRefused, refusalType, type Client } from './harness/clients'
import { makeCategory } from './harness/fixtures'
import { track } from './harness/ledger'
import type { Role, TestUser } from './harness/users'

/**
 * Two things that were established by reading the schema and are pinned here so
 * they cannot quietly change:
 *
 *   1. WHY /janmat, /promises AND /live CANNOT HOLD CONTENT.
 *      The field that makes each publicly visible is Lambda-writable only, and
 *      no Lambda exists that writes it. Articles have `publishArticle` to own
 *      `status`/`feedKey`; polls, live events and promises have no equivalent.
 *      So an admin CRUD screen alone cannot fix those three reported issues —
 *      a backend mutation has to exist first. These assertions are the evidence
 *      for that, and they will start failing the moment such a mutation lands,
 *      which is exactly when they should be revisited.
 *
 *   2. THE ARTICLE LIST TRUNCATES SILENTLY.
 *      The reported "saving a long article does nothing" was not a rejected
 *      write. `Article.list` Scans the base table, DynamoDB caps a Scan page at
 *      1 MB, and a truncated page carries NO `errors` — so the row was written
 *      and simply absent from the refreshed list.
 */

let users: Record<Role, TestUser>
let admin: Client
let categoryId: string

beforeAll(async () => {
  users = inject('testUsers')
  admin = clientFor(users.ADMIN)
  categoryId = (await makeCategory(admin)).id
})

describe('public-visibility fields are Lambda-owned', () => {
  it('refuses an ADMIN setting Poll.status', async () => {
    const poll = expectOk(
      await admin.models.Poll.create({
        question: 'क्या यह परीक्षण चुनाव है?',
        language: 'HI',
      }),
      'Poll.create',
    )
    track('Poll', { id: poll.id })

    // OPEN is what listPublicPolls requires. Nothing in the product can set it.
    const result = await admin.models.Poll.update({ id: poll.id, status: 'OPEN' })
    expect(wasRefused(result), 'ADMIN must NOT be able to open a poll directly').toBe(true)
    expect(refusalType(result)).toBe('Unauthorized')
  })

  it('refuses an ADMIN setting LiveEvent.feedKey', async () => {
    const event = expectOk(
      await admin.models.LiveEvent.create({
        slug: `it-event-${Date.now().toString(36)}`,
        title: 'परीक्षण लाइव कार्यक्रम',
        language: 'HI',
        startsAt: new Date(Date.UTC(2030, 0, 1)).toISOString(),
      }),
      'LiveEvent.create',
    )
    track('LiveEvent', { id: event.id })

    // list-public-live-events.js queries the sparse `feedKey` index; without it
    // the event can never appear on /live.
    const result = await admin.models.LiveEvent.update({
      id: event.id,
      feedKey: 'PUBLISHED#HI',
    })
    expect(wasRefused(result), 'ADMIN must NOT be able to set a live-event feed key').toBe(true)
    expect(refusalType(result)).toBe('Unauthorized')
  })

  it('refuses an ADMIN setting PromiseTrackerEntry.publicKey, but allows status and isPublished', async () => {
    const promise = expectOk(
      await admin.models.PromiseTrackerEntry.create({
        slug: `it-promise-${Date.now().toString(36)}`,
        title: 'परीक्षण वादा',
        language: 'HI',
        status: 'ANNOUNCED',
        party: 'परीक्षण दल',
        politician: 'परीक्षण नेता',
        promiseText: 'यह एक परीक्षण वादा है।',
      }),
      'PromiseTrackerEntry.create',
    )
    track('PromiseTrackerEntry', { id: promise.id })

    // list-public-promises.js requires publicKey === 'PUBLIC#' + language.
    const locked = await admin.models.PromiseTrackerEntry.update({
      id: promise.id,
      publicKey: 'PUBLIC#HI',
    })
    expect(wasRefused(locked), 'ADMIN must NOT be able to set publicKey').toBe(true)
    expect(refusalType(locked)).toBe('Unauthorized')

    // But these two carry NO field-level override, which is why promises are the
    // cheapest of the three to make manageable — only publicKey needs a Lambda.
    const allowed = await admin.models.PromiseTrackerEntry.update({
      id: promise.id,
      status: 'IN_PROGRESS',
      isPublished: true,
    })
    expect(wasRefused(allowed), 'status/isPublished should be staff-writable').toBe(false)
  })
})

describe('the article list truncates before it reaches its limit', () => {
  it('accepts a large article body', async () => {
    // Settles the question directly rather than by inference. An earlier
    // diagnosis blamed DynamoDB's 400 KB per-item limit for the reported bug;
    // this establishes what actually happens at size.
    const body = 'क'.repeat(90_000) // ~270 KB as UTF-8: Devanagari is 3 bytes/char.
    const created = expectOk(
      await admin.models.Article.create({
        slug: `it-large-${Date.now().toString(36)}`,
        language: 'HI',
        contentType: 'NEWS',
        title: 'बड़ा परीक्षण लेख',
        excerpt: 'बड़ा सार',
        bodyMarkdown: body,
        categoryId,
        authorProfileId: users.ADMIN.sub,
        authorDisplayName: 'परीक्षण लेखक',
      }),
      'Article.create (large body)',
    )
    track('Article', { id: created.id })
    expect(created.id).toBeTruthy()
  })

  it('returns nextToken well below the requested limit once rows are large', async () => {
    // THE PROOF FOR ISSUE #2. Four ~270 KB rows exceed the 1 MB Scan page, so a
    // request for 100 comes back short WITH a nextToken and WITHOUT any error —
    // which is exactly how a freshly saved article went missing from the table
    // while the write had in fact succeeded.
    const body = 'ख'.repeat(90_000)
    for (let i = 0; i < 4; i += 1) {
      const created = expectOk(
        await admin.models.Article.create({
          slug: `it-bulk-${i}-${Date.now().toString(36)}`,
          language: 'HI',
          contentType: 'NEWS',
          title: `थोक परीक्षण लेख ${i}`,
          excerpt: 'सार',
          bodyMarkdown: body,
          categoryId,
          authorProfileId: users.ADMIN.sub,
          authorDisplayName: 'परीक्षण लेखक',
        }),
        `Article.create (bulk ${i})`,
      )
      track('Article', { id: created.id })
    }

    const listed = await admin.models.Article.list({ limit: 100 })

    // The critical assertion: no error at all, despite an incomplete answer.
    expect(listed.errors ?? []).toEqual([])
    expect(listed.nextToken, 'expected a truncated page').toBeTruthy()
    expect(listed.data.length).toBeLessThan(100)
  })
})
