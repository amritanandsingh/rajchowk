import { beforeAll, beforeEach, describe, expect, it, inject } from 'vitest'
import { anonymousClient, clientFor, expectOk, resultCode, type Client } from './harness/clients'
import { counterOf, makePoll, openPoll, trackVote } from './harness/fixtures'
import { resetRateLimitsForUser } from './harness/rate-limits'
import { getRow } from './harness/tables'
import type { Role, TestUser } from './harness/users'

/**
 * Janmat vote integrity — the definition-of-done item that matters most.
 *
 * "A user cannot vote twice" is enforced by the PRIMARY KEY
 * (`${pollId}#${userSub}`) plus a DynamoDB conditional write inside a
 * TransactWriteItems. Nothing below mocks any of that: these calls hit the
 * deployed AppSync API, the real Lambda, and the real table.
 *
 * Every test builds its OWN poll, so vitest's `retry: 1` cannot make a
 * "votes once" assertion fail against a vote left by the first attempt.
 */

let users: Record<Role, TestUser>
let member: Client
let admin: Client

beforeAll(() => {
  users = inject('testUsers')
  member = clientFor(users.MEMBER)
  admin = clientFor(users.ADMIN)
})

// Every test here votes as the same MEMBER, so the real budget (10 per 60 s)
// would throttle the suite after a handful of tests. Reset the counters instead
// of raising the limits — rate-limit.test.ts is where tripping them is the point.
beforeEach(async () => {
  await resetRateLimitsForUser(users.MEMBER.sub, users.ADMIN.sub)
})

describe('casting a vote', () => {
  it('records a first vote and increments both counters', async () => {
    const poll = await makePoll(admin)
    trackVote(poll.id, users.MEMBER.sub)

    const result = expectOk(
      await member.mutations.castVote({ pollId: poll.id, pollOptionId: poll.optionIds[0]! }),
      'castVote',
    )

    expect(resultCode(result)).toBe('OK')
    expect((result as { ok: boolean }).ok).toBe(true)

    // The Vote row is the authoritative record; the counters are projections.
    const vote = await getRow<Record<string, unknown>>('Vote', {
      id: `${poll.id}#${users.MEMBER.sub}`,
    })
    expect(vote?.pollOptionId).toBe(poll.optionIds[0])
    expect(vote?.userSub).toBe(users.MEMBER.sub)
    // Written by raw SDK, so this is the __typename invariant in production.
    expect(vote?.__typename).toBe('Vote')

    expect(await counterOf('PollOption', poll.optionIds[0]!, 'voteCount')).toBe(1)
    expect(await counterOf('Poll', poll.id, 'totalVotes')).toBe(1)
  })

  it('stores an explanation when the reader gives one', async () => {
    const poll = await makePoll(admin)
    trackVote(poll.id, users.MEMBER.sub)

    expectOk(
      await member.mutations.castVote({
        pollId: poll.id,
        pollOptionId: poll.optionIds[0]!,
        explanation: 'क्योंकि यह ज़रूरी है।',
      }),
      'castVote with explanation',
    )

    const vote = await getRow<Record<string, unknown>>('Vote', {
      id: `${poll.id}#${users.MEMBER.sub}`,
    })
    expect(vote?.explanation).toBe('क्योंकि यह ज़रूरी है।')
  })

  it('never stores a raw IP alongside the vote', async () => {
    const poll = await makePoll(admin)
    trackVote(poll.id, users.MEMBER.sub)
    await member.mutations.castVote({ pollId: poll.id, pollOptionId: poll.optionIds[0]! })

    const vote = await getRow<Record<string, unknown>>('Vote', {
      id: `${poll.id}#${users.MEMBER.sub}`,
    })
    // ipHash may be absent (AppSync does not always populate sourceIp), but if
    // present it must be a hash, never a dotted quad or a colonned v6 address.
    if (vote?.ipHash) {
      expect(String(vote.ipHash)).not.toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
      expect(String(vote.ipHash)).not.toContain(':')
    }
  })
})

describe('voting twice — the core guarantee', () => {
  it('treats an identical repeat vote as idempotent and does NOT double-count', async () => {
    const poll = await makePoll(admin)
    trackVote(poll.id, users.MEMBER.sub)
    const option = poll.optionIds[0]!

    const first = expectOk(
      await member.mutations.castVote({ pollId: poll.id, pollOptionId: option }),
      'first vote',
    )
    expect(resultCode(first)).toBe('OK')

    const second = expectOk(
      await member.mutations.castVote({ pollId: poll.id, pollOptionId: option }),
      'repeat vote',
    )
    // A retry from a flaky mobile connection must look like success, not an
    // error the reader cannot act on.
    expect(resultCode(second)).toBe('OK')
    expect((second as { changed?: boolean }).changed).toBe(false)

    // And crucially the counters have not moved.
    expect(await counterOf('PollOption', option, 'voteCount')).toBe(1)
    expect(await counterOf('Poll', poll.id, 'totalVotes')).toBe(1)
  })

  it('refuses a DIFFERENT option when the poll does not allow changes', async () => {
    const poll = await makePoll(admin, { allowVoteChange: false })
    trackVote(poll.id, users.MEMBER.sub)

    expectOk(
      await member.mutations.castVote({ pollId: poll.id, pollOptionId: poll.optionIds[0]! }),
      'first vote',
    )

    const changed = expectOk(
      await member.mutations.castVote({ pollId: poll.id, pollOptionId: poll.optionIds[1]! }),
      'attempted change',
    )

    expect(resultCode(changed)).toBe('ALREADY_VOTED')
    expect(await counterOf('PollOption', poll.optionIds[0]!, 'voteCount')).toBe(1)
    expect((await counterOf('PollOption', poll.optionIds[1]!, 'voteCount')) ?? 0).toBe(0)
    expect(await counterOf('Poll', poll.id, 'totalVotes')).toBe(1)
  })
})

describe('changing a vote', () => {
  it('moves the option counters but leaves Poll.totalVotes UNCHANGED', async () => {
    // The number of voters has not changed, only their distribution. Bumping
    // totalVotes here is the classic way these counters drift apart.
    const poll = await makePoll(admin, { allowVoteChange: true, maxVoteChanges: 2 })
    trackVote(poll.id, users.MEMBER.sub)

    expectOk(
      await member.mutations.castVote({ pollId: poll.id, pollOptionId: poll.optionIds[0]! }),
      'first vote',
    )
    expect(await counterOf('Poll', poll.id, 'totalVotes')).toBe(1)

    const changed = expectOk(
      await member.mutations.castVote({ pollId: poll.id, pollOptionId: poll.optionIds[1]! }),
      'change vote',
    )

    expect(resultCode(changed)).toBe('OK')
    expect((changed as { changed?: boolean }).changed).toBe(true)

    expect(await counterOf('PollOption', poll.optionIds[0]!, 'voteCount')).toBe(0)
    expect(await counterOf('PollOption', poll.optionIds[1]!, 'voteCount')).toBe(1)
    // The invariant.
    expect(await counterOf('Poll', poll.id, 'totalVotes')).toBe(1)
  })

  it('caps the number of changes', async () => {
    const poll = await makePoll(admin, { allowVoteChange: true, maxVoteChanges: 1, optionCount: 3 })
    trackVote(poll.id, users.MEMBER.sub)

    await member.mutations.castVote({ pollId: poll.id, pollOptionId: poll.optionIds[0]! })
    const firstChange = expectOk(
      await member.mutations.castVote({ pollId: poll.id, pollOptionId: poll.optionIds[1]! }),
      'first change',
    )
    expect(resultCode(firstChange)).toBe('OK')

    const secondChange = expectOk(
      await member.mutations.castVote({ pollId: poll.id, pollOptionId: poll.optionIds[2]! }),
      'second change',
    )
    expect(resultCode(secondChange)).toBe('CHANGE_LIMIT')

    // The counters reflect the last ALLOWED state.
    expect(await counterOf('PollOption', poll.optionIds[1]!, 'voteCount')).toBe(1)
    expect((await counterOf('PollOption', poll.optionIds[2]!, 'voteCount')) ?? 0).toBe(0)
  })
})

describe('rejected votes', () => {
  it('refuses an option belonging to a DIFFERENT poll', async () => {
    // Without this check a caller could add a vote to an option in another,
    // still-open poll.
    const [pollA, pollB] = await Promise.all([makePoll(admin), makePoll(admin)])
    trackVote(pollA.id, users.MEMBER.sub)

    const result = expectOk(
      await member.mutations.castVote({ pollId: pollA.id, pollOptionId: pollB.optionIds[0]! }),
      'cross-poll vote',
    )

    expect(resultCode(result)).toBe('INVALID_OPTION')
    expect((await counterOf('PollOption', pollB.optionIds[0]!, 'voteCount')) ?? 0).toBe(0)
    expect((await counterOf('Poll', pollA.id, 'totalVotes')) ?? 0).toBe(0)
  })

  it('refuses a poll that is not open', async () => {
    const poll = await makePoll(admin, { open: false })
    const result = expectOk(
      await member.mutations.castVote({ pollId: poll.id, pollOptionId: poll.optionIds[0]! }),
      'vote on draft poll',
    )
    expect(resultCode(result)).toBe('POLL_CLOSED')
  })

  it('refuses a poll whose closing time has passed', async () => {
    const poll = await makePoll(admin, { closesAt: '2020-01-01T00:00:00.000Z' })
    await openPoll(poll.id, 'OPEN')

    const result = expectOk(
      await member.mutations.castVote({ pollId: poll.id, pollOptionId: poll.optionIds[0]! }),
      'vote on expired poll',
    )
    expect(resultCode(result)).toBe('POLL_CLOSED')
  })

  it('refuses a poll that does not exist', async () => {
    const result = expectOk(
      await member.mutations.castVote({
        pollId: '00000000-0000-4000-8000-000000000000',
        pollOptionId: '00000000-0000-4000-8000-000000000001',
      }),
      'vote on missing poll',
    )
    expect(resultCode(result)).toBe('NOT_FOUND')
  })

  it('does not let an ANONYMOUS caller vote at all', async () => {
    const poll = await makePoll(admin)
    const anonymous = anonymousClient()

    // castVote grants only allow.authenticated(), so the API key cannot even
    // reach the field.
    const result = await anonymous.mutations.castVote({
      pollId: poll.id,
      pollOptionId: poll.optionIds[0]!,
    })

    expect(result.errors?.length ?? 0).toBeGreaterThan(0)
    expect((await counterOf('Poll', poll.id, 'totalVotes')) ?? 0).toBe(0)
  })
})

describe('vote privacy', () => {
  it('exposes NO GraphQL read for votes, to any principal', async () => {
    // "Individual users' votes must never be publicly readable" is satisfied by
    // removing the operations entirely, so the generated client has no method
    // to call — a stronger guarantee than an auth rule that could regress.
    for (const [label, client] of [
      ['anonymous', anonymousClient()],
      ['member', member],
      ['admin', admin],
    ] as const) {
      const voteModel = (client.models as Record<string, Record<string, unknown>>).Vote
      expect(typeof voteModel?.get, label).not.toBe('function')
      expect(typeof voteModel?.list, label).not.toBe('function')
    }
  })
})
