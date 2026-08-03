import { randomUUID } from 'node:crypto'
import { expectOk, type Client } from './clients'
import { track } from './ledger'
import { getRow } from './tables'

/**
 * Fixture builders.
 *
 * Every fixture gets a fresh random id, which is what makes the suite safe
 * under vitest's `retry: 1`. A shared fixture would break the vote tests
 * outright: the second attempt would find an existing Vote row and "cannot vote
 * twice" would fail for the wrong reason.
 *
 * Everything created is recorded in the ledger, so teardown can delete it even
 * for models whose GraphQL mutations are disabled.
 */

const short = (): string => randomUUID().slice(0, 8)

export type ArticleFixture = { id: string; slug: string; categoryId: string }

export async function makeCategory(admin: Client): Promise<{ id: string; slug: string }> {
  const slug = `it-cat-${short()}`
  const created = expectOk(
    await admin.models.Category.create({
      slug,
      nameHi: 'परीक्षण श्रेणी',
      nameEn: 'Test Category',
      displayOrder: 900,
      // Kept inactive so a fixture can never surface in a real listing if
      // cleanup is ever missed.
      isActive: false,
    }),
    'Category.create',
  )

  track('Category', { id: created.id })
  return { id: created.id, slug }
}

/**
 * An article in DRAFT.
 *
 * Note `status` is never supplied: the field is Lambda-owned and unwritable
 * through GraphQL, so a freshly created article has no status at all. Absent is
 * treated as DRAFT everywhere, which is the safe default.
 */
export async function makeArticle(
  admin: Client,
  options: { categoryId: string; authorProfileId: string; title?: string; allowComments?: boolean } ,
): Promise<ArticleFixture> {
  const slug = `it-article-${short()}`
  const created = expectOk(
    await admin.models.Article.create({
      slug,
      language: 'HI',
      contentType: 'NEWS',
      title: options.title ?? 'परीक्षण लेख',
      excerpt: 'परीक्षण सार',
      bodyMarkdown: 'परीक्षण सामग्री यहाँ है।',
      factualSummary: 'क्या हुआ इसका सार।',
      categoryId: options.categoryId,
      authorProfileId: options.authorProfileId,
      authorDisplayName: 'परीक्षण लेखक',
      ...(options.allowComments === undefined ? {} : { allowComments: options.allowComments }),
    }),
    'Article.create',
  )

  track('Article', { id: created.id })
  return { id: created.id, slug, categoryId: options.categoryId }
}

export type PollFixture = { id: string; optionIds: string[] }

export async function makePoll(
  admin: Client,
  options: {
    optionCount?: number
    allowVoteChange?: boolean
    maxVoteChanges?: number
    closesAt?: string
    open?: boolean
  } = {},
): Promise<PollFixture> {
  const { optionCount = 3, allowVoteChange = false, open = true } = options

  const poll = expectOk(
    await admin.models.Poll.create({
      question: 'क्या यह परीक्षण काम करता है?',
      language: 'HI',
      allowVoteChange,
      maxVoteChanges: options.maxVoteChanges ?? 1,
      ...(options.closesAt ? { closesAt: options.closesAt } : {}),
    }),
    'Poll.create',
  )
  track('Poll', { id: poll.id })

  const optionIds: string[] = []
  for (let index = 0; index < optionCount; index += 1) {
    const option = expectOk(
      await admin.models.PollOption.create({
        pollId: poll.id,
        label: `विकल्प ${index + 1}`,
        displayOrder: index,
      }),
      'PollOption.create',
    )
    track('PollOption', { id: option.id })
    optionIds.push(option.id)
  }

  // `status` is Lambda-owned, so a poll cannot be opened through GraphQL. The
  // raw write is the only way, and it mirrors what an admin mutation would do.
  if (open) await openPoll(poll.id)

  return { id: poll.id, optionIds }
}

/**
 * Set a poll's status directly.
 *
 * There is deliberately no GraphQL path for this — `status` carries
 * field-level read-only auth — so the fixture uses the same privileged route a
 * Lambda would.
 */
export async function openPoll(pollId: string, status: 'OPEN' | 'CLOSED' = 'OPEN'): Promise<void> {
  const { ddb, tableFor } = await import('./tables')
  const { UpdateCommand } = await import('@aws-sdk/lib-dynamodb')

  await ddb.send(
    new UpdateCommand({
      TableName: await tableFor('Poll'),
      Key: { id: pollId },
      UpdateExpression: 'SET #status = :status, totalVotes = if_not_exists(totalVotes, :zero)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status, ':zero': 0 },
    }),
  )
}

/** A question in PENDING_REVIEW, created through the real submit mutation. */
export async function makeQuestion(
  member: Client,
  options: { text?: string } = {},
): Promise<{ id: string }> {
  const data = expectOk(
    await member.mutations.submitQuestion({
      questionText: options.text ?? `यह एक परीक्षण सवाल है ${short()}`,
    }),
    'submitQuestion',
  )

  const id = (data as { id?: string }).id
  if (!id) throw new Error(`submitQuestion returned no id: ${JSON.stringify(data)}`)

  track('AudienceQuestion', { id })
  return { id }
}

/** Approve a question so it becomes publicly visible and upvotable. */
export async function approveQuestion(moderator: Client, questionId: string): Promise<void> {
  expectOk(
    await moderator.mutations.moderateContent({
      targetType: 'QUESTION',
      targetId: questionId,
      action: 'APPROVE',
    }),
    'moderateContent(QUESTION, APPROVE)',
  )
}

/** Publish an article, which also writes its feed keys and search index. */
export async function publishArticle(admin: Client, articleId: string): Promise<void> {
  expectOk(
    await admin.mutations.publishArticle({ articleId, action: 'PUBLISH' }),
    'publishArticle(PUBLISH)',
  )
  // The revision and search rows are derived writes; record them for cleanup.
  track('SearchDocument', { id: articleId })
}

/** Read a Lambda-owned counter straight from the table. */
export async function counterOf(
  model: string,
  id: string,
  attribute: string,
): Promise<number | undefined> {
  const row = await getRow<Record<string, unknown>>(model, { id })
  const value = row?.[attribute]
  return typeof value === 'number' ? value : undefined
}

/** A Vote row's primary key is deterministic — the whole idempotency design. */
export const voteId = (pollId: string, userSub: string): string => `${pollId}#${userSub}`
export const upvoteId = (questionId: string, userSub: string): string => `${questionId}#${userSub}`

/** Record vote/upvote rows for cleanup — they cannot be deleted via GraphQL. */
export function trackVote(pollId: string, userSub: string): void {
  track('Vote', { id: voteId(pollId, userSub) })
}

export function trackUpvote(questionId: string, userSub: string): void {
  track('QuestionUpvote', { id: upvoteId(questionId, userSub) })
}
