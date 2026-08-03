/**
 * Bounded polling for eventually-consistent reads.
 *
 * DynamoDB global secondary indexes are eventually consistent, and several
 * assertions in this suite read a GSI immediately after a write — approving a
 * comment and then expecting it in the public feed, for instance. A fixed
 * `sleep(500)` is the wrong tool: it is simultaneously too slow when the index
 * is fast and too flaky when it is not.
 *
 * These helpers retry with a short backoff and, crucially, report the LAST
 * OBSERVED VALUE when they give up — a bare timeout tells you nothing about
 * whether the value was wrong or simply absent.
 */

export type EventuallyOptions = {
  /** Maximum attempts, including the first. */
  attempts?: number
  /** Delay after the first failure, doubling up to a cap. */
  delayMs?: number
  maxDelayMs?: number
  /** Included in the failure message. */
  label?: string
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/**
 * Poll `read` until `predicate` holds, then return the value.
 *
 * Throws with the last observed value if it never does.
 */
export async function eventually<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: EventuallyOptions = {},
): Promise<T> {
  const { attempts = 12, delayMs = 150, maxDelayMs = 1500, label = 'condition' } = options

  let last: T | undefined
  let lastError: unknown
  let wait = delayMs

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      last = await read()
      if (predicate(last)) return last
    } catch (error) {
      // A read can legitimately fail while a row is still propagating.
      lastError = error
    }

    if (attempt < attempts) {
      await sleep(wait)
      wait = Math.min(wait * 2, maxDelayMs)
    }
  }

  const observed =
    last === undefined
      ? `never read successfully (last error: ${(lastError as Error)?.message ?? 'none'})`
      : `last observed: ${JSON.stringify(last)}`

  throw new Error(`eventually(${label}) gave up after ${attempts} attempts — ${observed}`)
}

/** Poll until a value is present. */
export async function eventuallyDefined<T>(
  read: () => Promise<T | undefined | null>,
  options: EventuallyOptions = {},
): Promise<T> {
  const value = await eventually(read, (candidate) => candidate !== undefined && candidate !== null, {
    ...options,
    label: options.label ?? 'value present',
  })
  return value as T
}

/** Poll until a numeric value equals `expected` — for counter assertions. */
export async function eventuallyEquals(
  read: () => Promise<number | undefined>,
  expected: number,
  options: EventuallyOptions = {},
): Promise<void> {
  await eventually(read, (value) => value === expected, {
    ...options,
    label: options.label ?? `value === ${expected}`,
  })
}

/**
 * Poll until a list contains an item matching `match`.
 *
 * Used for "the approved comment appears in the public feed".
 */
export async function eventuallyContains<T>(
  read: () => Promise<T[]>,
  match: (item: T) => boolean,
  options: EventuallyOptions = {},
): Promise<T> {
  const list = await eventually(read, (items) => items.some(match), {
    ...options,
    label: options.label ?? 'list contains item',
  })
  return list.find(match) as T
}

/**
 * Assert a list does NOT contain a match, and keeps not containing it.
 *
 * This is the shape needed for negative visibility assertions — "a pending
 * comment is absent". A single read could pass simply because the index has not
 * caught up yet, which would make the test pass for the wrong reason, so this
 * re-reads a few times and fails if the item ever shows up.
 */
export async function consistentlyExcludes<T>(
  read: () => Promise<T[]>,
  match: (item: T) => boolean,
  options: { checks?: number; delayMs?: number; label?: string } = {},
): Promise<void> {
  const { checks = 3, delayMs = 400, label = 'item' } = options

  for (let check = 1; check <= checks; check += 1) {
    const items = await read()
    const found = items.find(match)
    if (found) {
      throw new Error(
        `consistentlyExcludes(${label}) failed on check ${check}: found ${JSON.stringify(found)}`,
      )
    }
    if (check < checks) await sleep(delayMs)
  }
}
