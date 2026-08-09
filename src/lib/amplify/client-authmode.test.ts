import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Architecture test: every component must sign its requests with the auth
 * provider its operation actually requires.
 *
 * This exists because the same defect shipped twice.
 *
 * `allow.authenticated()`, `allow.group(...)` and `allow.owner*(...)` ALL resolve
 * to the Cognito user pool. The schema default is `identityPool`, so a client
 * created without an explicit authMode — or with the guest one — signs SigV4,
 * matches none of those rules, and AppSync answers `Unauthorized` before any
 * resolver or Lambda runs. Nothing throws: Amplify v6 resolves
 * `{ data: null, errors }`, so the feature just silently does nothing.
 *
 *   1st occurrence (fixed in ce29d4a): /admin/articles — an empty category
 *      dropdown and an "Unauthorized" article table.
 *   2nd occurrence: five MEMBER-facing forms — castVote, submitComment,
 *      submitQuestion, toggleQuestionUpvote and EventRegistration.create. These
 *      are not staff operations, so the client then named `adminDataClient`
 *      looked like the wrong tool — yet every one of them is user-pool-only. No
 *      signed-in member could vote, comment, ask a question, upvote or register.
 *
 * Reviewing this by eye clearly does not work, so it is asserted instead. The
 * expected client is derived from the SCHEMA rather than from a hand-kept list,
 * so it cannot drift: an operation is guest-reachable if and only if its
 * authorization rules literally contain `allow.guest()`.
 */

const REPO_ROOT = join(import.meta.dirname, '../../..')
const SCHEMA_PATH = join(REPO_ROOT, 'amplify/data/resource.ts')
const COMPONENT_DIRS = ['src/components/forms', 'src/components/admin', 'src/components/auth']

/** Operation name -> true when its rules include `allow.guest()`. */
function guestReachableOperations(): Map<string, boolean> {
  const source = readFileSync(SCHEMA_PATH, 'utf8')
  const lines = source.split('\n')
  const result = new Map<string, boolean>()

  // Custom queries and mutations are declared as `    <name>: a` followed by
  // `.query()` / `.mutation()` and a `.authorization(...)` before the next
  // sibling at the same indentation.
  const declaration = /^ {4}(\w+): a$/
  for (let i = 0; i < lines.length; i += 1) {
    const match = declaration.exec(lines[i] ?? '')
    if (!match) continue
    const name = match[1]
    if (!name) continue

    let block = ''
    for (let j = i + 1; j < lines.length; j += 1) {
      if (declaration.test(lines[j] ?? '')) break
      block += `${lines[j] ?? ''}\n`
    }

    // Only custom operations; models are handled by their own rules and are
    // covered below via the `.models.` usage check.
    if (!/\.(query|mutation)\(\)/.test(block)) continue
    if (!block.includes('.authorization(')) continue

    result.set(name, block.includes('allow.guest()'))
  }

  return result
}

function sourceFiles(): string[] {
  const files: string[] = []
  for (const dir of COMPONENT_DIRS) {
    const abs = join(REPO_ROOT, dir)
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!/\.tsx?$/.test(entry.name)) continue
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue
      files.push(join(abs, entry.name))
    }
  }
  return files
}

const OPERATIONS = guestReachableOperations()

describe('Amplify client auth mode', () => {
  it('parsed the schema at all', () => {
    // A silently-empty parse would make every assertion below vacuous, which is
    // exactly the failure mode this whole file exists to prevent.
    expect(OPERATIONS.size).toBeGreaterThan(15)
    // Spot-check both sides of the split so a regex change cannot invert it.
    expect(OPERATIONS.get('submitQuestion')).toBe(false)
    expect(OPERATIONS.get('castVote')).toBe(false)
    expect(OPERATIONS.get('submitComment')).toBe(false)
    expect(OPERATIONS.get('toggleQuestionUpvote')).toBe(false)
    expect(OPERATIONS.get('ensureUserProfile')).toBe(false)
    expect(OPERATIONS.get('newsletterSubscribe')).toBe(true)
    expect(OPERATIONS.get('searchContent')).toBe(true)
  })

  it.each(sourceFiles())('%s uses the client its operations require', (file) => {
    const source = readFileSync(file, 'utf8')
    const where = relative(REPO_ROOT, file)

    const called = [...source.matchAll(/\.(?:mutations|queries)\.(\w+)\(/g)]
      .map((match) => match[1])
      .filter((name): name is string => Boolean(name))

    // A direct `.models.X` call is authorized by that model's own rules, which in
    // this schema are always group- or owner-based, i.e. always user pool.
    const touchesModels = /\.models\.\w+\./.test(source)

    const needsUserPool = touchesModels || called.some((name) => OPERATIONS.get(name) === false)

    if (!needsUserPool) return

    const offenders = called.filter((name) => OPERATIONS.get(name) === false)
    const reason = touchesModels
      ? 'it calls .models.* directly (model rules are group/owner based)'
      : `these operations are not guest-reachable: ${offenders.join(', ')}`

    expect(
      source.includes('userPoolDataClient'),
      `${where} must import userPoolDataClient because ${reason}`,
    ).toBe(true)

    // The inverse matters just as much: using the guest client for one of these
    // is precisely the bug, and importing both is how a half-done migration hides.
    expect(
      source.includes('guestDataClient'),
      `${where} must NOT use guestDataClient (identityPool) — ${reason}`,
    ).toBe(false)
  })
})
