/**
 * Copy published articles from a v2 (25-model) Article table into this MVP's.
 *
 * WHY THIS EXISTS. A production cutover replaces the AppSync API rather than
 * mutating it, so the MVP starts with an EMPTY Article table while the old
 * rows sit in an orphaned table under the previous API id. Nothing is lost,
 * but nothing is visible either. This moves the content across.
 *
 * It is a FIELD MAPPING, not a copy: the two schemas disagree about almost
 * everything. See docs/cutover.md for the table.
 *
 * Usage:
 *   npm run migrate:articles -- --from <v2ApiId> --to <mvpApiId> --dry-run
 *   npm run migrate:articles -- --from <v2ApiId> --to <mvpApiId>
 *   npm run migrate:articles -- ... --force      # overwrite ids that already exist
 *
 * Only PUBLISHED rows are migrated. A v2 draft has no equivalent worth moving:
 * its status vocabulary (IN_REVIEW/SCHEDULED/UNPUBLISHED/ARCHIVED) does not map
 * onto this schema's two states, and importing one as a DRAFT would silently
 * change what it meant.
 */
import {
  DynamoDBClient,
  DescribeTableCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'

import { parseArticleInput } from '../src/lib/domain/article'

const REGION = 'ap-south-1'

class CliError extends Error {}

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (name: string) => argv.includes(`--${name}`)

const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  // Matches the write path in amplify/functions/shared/ddb.ts: Amplify writes
  // absent rather than null, and sparse-index semantics depend on it.
  marshallOptions: { removeUndefinedValues: true },
})

/** The GSIs this schema declares. Their presence is what proves a table is an
 *  MVP Article table and not a v2 one — the guard that stops this writing
 *  MVP-shaped rows into the old schema and corrupting it. */
const MVP_INDEXES = [
  'articlesByFeedKeyAndPublishedAt',
  'articlesBySlug',
  'articlesByStatusKeyAndUpdatedAt',
]

async function assertIsMvpArticleTable(table: string): Promise<void> {
  try {
    const described = await client.send(new DescribeTableCommand({ TableName: table }))
    const indexes = (described.Table?.GlobalSecondaryIndexes ?? []).map((i) => i.IndexName)
    const missing = MVP_INDEXES.filter((i) => !indexes.includes(i))
    if (missing.length > 0) {
      throw new CliError(
        `${table} is not an MVP Article table — it is missing ${missing.join(', ')}.\n` +
          `Found: ${indexes.join(', ') || '(none)'}\n` +
          'Refusing to write. Check --to; writing MVP rows into a v2 table would corrupt it.',
      )
    }
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      throw new CliError(`Destination table ${table} does not exist.`)
    }
    throw error
  }
}

/** Scan every page. These tables are small; correctness beats cleverness — a
 *  single-page scan would silently migrate a prefix of a large table. */
async function scanAll(table: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = []
  let key: Record<string, unknown> | undefined
  do {
    const page = await client.send(new ScanCommand({ TableName: table, ExclusiveStartKey: key }))
    items.push(...((page.Items ?? []) as Record<string, unknown>[]))
    key = page.LastEvaluatedKey
  } while (key)
  return items
}

const str = (row: Record<string, unknown>, k: string): string =>
  typeof row[k] === 'string' ? (row[k] as string) : ''

/** UUIDs masquerading as names. v2 stored the author's Cognito sub in
 *  `authorDisplayName` for rows created by scripts, and rendering that as a
 *  byline looks like a bug to every reader. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve a human byline.
 *
 * Precedence: the v2 UserProfile's displayName, then authorDisplayName if it is
 * not obviously an id, then a generic fallback. Never a bare UUID.
 */
function resolveAuthorName(row: Record<string, unknown>, profiles: Map<string, string>): string {
  const fromProfile = profiles.get(str(row, 'authorProfileId'))
  if (fromProfile) return fromProfile

  const declared = str(row, 'authorDisplayName')
  if (declared && !UUID.test(declared)) return declared

  return 'संपादक'
}

async function main(): Promise<void> {
  const from = flag('from')
  const to = flag('to')
  const dryRun = has('dry-run')
  const force = has('force')

  if (!from || !to) {
    throw new CliError(
      'Usage: npm run migrate:articles -- --from <v2ApiId> --to <mvpApiId> [--dry-run] [--force]',
    )
  }
  if (from === to) throw new CliError('--from and --to are the same table.')

  const source = `Article-${from}-NONE`
  const destination = `Article-${to}-NONE`

  console.log(`from: ${source}`)
  console.log(`to:   ${destination}${dryRun ? '   (DRY RUN — nothing will be written)' : ''}`)
  console.log('')

  await assertIsMvpArticleTable(destination)

  // Byline lookup. Optional: a v2 export without profiles still migrates, it
  // just falls back to the rules in resolveAuthorName.
  const profiles = new Map<string, string>()
  try {
    for (const profile of await scanAll(`UserProfile-${from}-NONE`)) {
      const name = str(profile, 'displayName')
      if (name) profiles.set(str(profile, 'id'), name)
    }
    console.log(`Loaded ${profiles.size} author profile(s) for bylines.`)
  } catch {
    console.log('No v2 UserProfile table found; falling back to authorDisplayName.')
  }

  const existing = new Set((await scanAll(destination)).map((row) => str(row, 'id')))
  const rows = await scanAll(source)
  console.log(`Source holds ${rows.length} row(s); destination holds ${existing.size}.`)
  console.log('')

  let migrated = 0
  let skipped = 0

  for (const row of rows) {
    const id = str(row, 'id')
    const slug = str(row, 'slug')
    const label = slug || id

    if (str(row, 'status') !== 'PUBLISHED') {
      console.log(`  skip  ${label} — status ${str(row, 'status') || '(none)'}, not PUBLISHED`)
      skipped++
      continue
    }

    if (existing.has(id) && !force) {
      console.log(`  skip  ${label} — already present in the destination (--force to overwrite)`)
      skipped++
      continue
    }

    // The app's OWN validator, so nothing lands that the admin UI would refuse
    // to edit or the handler would refuse to save.
    const parsed = parseArticleInput({
      title: str(row, 'title'),
      summary: str(row, 'excerpt'),
      content: str(row, 'bodyMarkdown'),
      slug,
    })
    if (!parsed.ok) {
      console.log(
        `  SKIP  ${label} — fails validation: ${parsed.errors.map((e) => e.field).join(', ')}`,
      )
      skipped++
      continue
    }

    const now = new Date().toISOString()
    const publishedAt = str(row, 'publishedAt') || str(row, 'createdAt') || now

    const item = {
      // Same id and slug: the slug is a permanent public URL and the id keeps
      // the two databases talking about the same article.
      id,
      slug: parsed.value.slug || slug,
      title: parsed.value.title,
      summary: parsed.value.summary,
      content: parsed.value.content,

      status: 'PUBLISHED',
      statusKey: 'PUBLISHED',
      // Present because this row IS published. Omitted entirely for anything
      // else — the feed index is sparse, and null is not absent.
      feedKey: 'PUBLISHED',
      publishedAt,

      authorName: resolveAuthorName(row, profiles),
      authorSub: str(row, 'authorProfileId') || undefined,

      createdAt: str(row, 'createdAt') || publishedAt,
      updatedAt: str(row, 'updatedAt') || publishedAt,

      // Required. Without it Amplify's GraphQL layer treats the row as
      // untyped and Article.get() returns nothing, so the admin edit form
      // cannot find an article that plainly exists in the table.
      __typename: 'Article',
    }

    if (dryRun) {
      console.log(`  WOULD migrate ${label}`)
      console.log(`     title  ${item.title.slice(0, 60)}`)
      console.log(`     author ${item.authorName}   published ${item.publishedAt}`)
      console.log(`     body   ${item.content.length} chars`)
    } else {
      await client.send(new PutCommand({ TableName: destination, Item: item }))
      console.log(`  migrated ${label}  (author ${item.authorName})`)
    }
    migrated++
  }

  console.log('')
  console.log(`${dryRun ? 'Would migrate' : 'Migrated'}: ${migrated}   skipped: ${skipped}`)
  if (!dryRun && migrated > 0) {
    console.log('')
    console.log('The public feed is ISR-cached: allow up to 60 seconds, and note that')
    console.log('CloudFront serves one stale response after the window expires, so a')
    console.log('second refresh may be needed. The /article/<slug> page is immediate.')
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof CliError ? `\n${error.message}\n` : error)
  process.exit(1)
})
