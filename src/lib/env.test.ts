import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Public environment validation.
 *
 * `env.ts` validates at MODULE LOAD, which is the point — a misconfigured
 * deployment should fail at boot with a readable message rather than quietly
 * emit wrong canonical URLs for a week. That also means every test here has to
 * reset the module registry and re-import.
 */

const BASE = {
  NEXT_PUBLIC_SITE_URL: 'https://rajchowk.in',
  NEXT_PUBLIC_SITE_NAME: 'राज चौक',
  NEXT_PUBLIC_DEFAULT_LOCALE: 'hi',
  NEXT_PUBLIC_AWS_REGION: 'ap-south-1',
  NEXT_PUBLIC_ENV: 'production',
}

/** Load a fresh copy of the module under a given environment. */
async function loadEnv(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules()
  for (const [key, value] of Object.entries({ ...BASE, ...overrides })) {
    if (value === undefined) vi.stubEnv(key, '')
    else vi.stubEnv(key, value)
  }
  return import('./env')
}

beforeEach(() => {
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('valid configuration', () => {
  it('parses a well-formed environment', async () => {
    const { env } = await loadEnv()
    expect(env.NEXT_PUBLIC_SITE_URL).toBe('https://rajchowk.in')
    expect(env.NEXT_PUBLIC_DEFAULT_LOCALE).toBe('hi')
    expect(env.NEXT_PUBLIC_ENV).toBe('production')
  })

  it('applies defaults for the optional variables', async () => {
    const { env } = await loadEnv({
      NEXT_PUBLIC_SITE_NAME: undefined,
      NEXT_PUBLIC_DEFAULT_LOCALE: undefined,
      NEXT_PUBLIC_AWS_REGION: undefined,
      NEXT_PUBLIC_ENV: undefined,
    })
    expect(env.NEXT_PUBLIC_SITE_NAME).toBe('राज चौक')
    expect(env.NEXT_PUBLIC_DEFAULT_LOCALE).toBe('hi')
    expect(env.NEXT_PUBLIC_AWS_REGION).toBe('ap-south-1')
    expect(env.NEXT_PUBLIC_ENV).toBe('development')
  })

  it('omits the optional CDN host rather than defaulting it', async () => {
    const { env } = await loadEnv()
    expect(env.NEXT_PUBLIC_MEDIA_CDN_HOST).toBeUndefined()
  })
})

describe('rejected configuration', () => {
  it('rejects a trailing slash on the site URL', async () => {
    // A trailing slash produces "https://rajchowk.in//news/x" in every
    // canonical, OG url and sitemap entry — a duplicate-content bug that is
    // invisible until Search Console complains.
    await expect(loadEnv({ NEXT_PUBLIC_SITE_URL: 'https://rajchowk.in/' })).rejects.toThrow(
      /must not end with a slash/,
    )
  })

  it('rejects a value that is not an absolute URL', async () => {
    await expect(loadEnv({ NEXT_PUBLIC_SITE_URL: 'rajchowk.in' })).rejects.toThrow(
      /absolute URL/,
    )
    await expect(loadEnv({ NEXT_PUBLIC_SITE_URL: 'not a url' })).rejects.toThrow()
  })

  it('rejects an unsupported locale', async () => {
    await expect(loadEnv({ NEXT_PUBLIC_DEFAULT_LOCALE: 'fr' })).rejects.toThrow()
  })

  it('rejects an unknown environment name', async () => {
    await expect(loadEnv({ NEXT_PUBLIC_ENV: 'prod' })).rejects.toThrow()
  })

  it('names the offending variable in the error', async () => {
    // The message is read by whoever is staring at a failed deploy.
    await expect(loadEnv({ NEXT_PUBLIC_SITE_URL: 'nope' })).rejects.toThrow(
      /Invalid public environment configuration/,
    )
  })
})

describe('isProduction', () => {
  it('is true only for the production environment', async () => {
    expect((await loadEnv({ NEXT_PUBLIC_ENV: 'production' })).isProduction).toBe(true)
    for (const value of ['development', 'sandbox', 'staging']) {
      expect((await loadEnv({ NEXT_PUBLIC_ENV: value })).isProduction, value).toBe(false)
    }
  })
})

describe('absoluteUrl', () => {
  it('joins a site-relative path', async () => {
    const { absoluteUrl } = await loadEnv()
    expect(absoluteUrl('/news/x')).toBe('https://rajchowk.in/news/x')
  })

  it('adds the missing leading slash', async () => {
    const { absoluteUrl } = await loadEnv()
    expect(absoluteUrl('news/x')).toBe('https://rajchowk.in/news/x')
  })

  it('defaults to the site root', async () => {
    const { absoluteUrl } = await loadEnv()
    expect(absoluteUrl()).toBe('https://rajchowk.in/')
  })

  it('never emits a doubled slash', async () => {
    const { absoluteUrl } = await loadEnv()
    for (const path of ['/', '/news', 'news', '/news/']) {
      expect(absoluteUrl(path)).not.toMatch(/(?<!:)\/\//)
    }
  })

  it('preserves a Devanagari slug without escaping it', async () => {
    // Devanagari is valid in an IRI path and stays readable when pasted into
    // WhatsApp, which is how most of this audience shares links.
    const { absoluteUrl } = await loadEnv()
    expect(absoluteUrl('/news/दिल्ली-में-फैसला')).toBe('https://rajchowk.in/news/दिल्ली-में-फैसला')
  })
})
