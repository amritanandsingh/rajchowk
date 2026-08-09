import * as z from 'zod'

/**
 * Public environment. Validated once at module load so a misconfigured
 * deployment fails at build/boot with a readable message instead of producing
 * subtly wrong canonical URLs and metadata at runtime.
 *
 * Only NEXT_PUBLIC_* belongs here. Server secrets are never read from the
 * environment in the Next.js app — they live in Amplify secret management and
 * are consumed inside `amplify/` via `secret('NAME')`.
 *
 * Note that `process.env.NEXT_PUBLIC_*` must be referenced by its full literal
 * name for Next's build-time inlining to work; destructuring `process.env`
 * would silently produce undefined in the browser bundle.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z
    .url({ error: 'NEXT_PUBLIC_SITE_URL must be an absolute URL, e.g. https://rajchowk.in' })
    // A trailing slash here produces `https://rajchowk.in//news/x` in canonicals.
    .refine((value) => !value.endsWith('/'), {
      error: 'NEXT_PUBLIC_SITE_URL must not end with a slash',
    }),
  NEXT_PUBLIC_SITE_NAME: z.string().min(1).default('राज चौक'),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(['hi', 'en']).default('hi'),
  NEXT_PUBLIC_AWS_REGION: z.string().min(1).default('ap-south-1'),
  NEXT_PUBLIC_ENV: z
    .enum(['development', 'sandbox', 'staging', 'production'])
    .default('development'),
  NEXT_PUBLIC_MEDIA_CDN_HOST: z.string().min(1).optional(),
})

export type PublicEnv = z.infer<typeof publicEnvSchema>

function loadPublicEnv(): PublicEnv {
  const raw = {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
    NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
    NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION,
    NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
    NEXT_PUBLIC_MEDIA_CDN_HOST: process.env.NEXT_PUBLIC_MEDIA_CDN_HOST,
  }

  // Strip keys that are absent so zod applies its defaults rather than failing
  // on an explicit `undefined` (exactOptionalPropertyTypes is on).
  const defined = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== undefined && value !== ''),
  )

  const parsed = publicEnvSchema.safeParse(defined)
  if (!parsed.success) {
    throw new Error(`Invalid public environment configuration:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

export const env: PublicEnv = loadPublicEnv()

export const isProduction = env.NEXT_PUBLIC_ENV === 'production'

/** Absolute URL for a site-relative path. Used for canonicals, OG tags,
 *  JSON-LD `@id`s, sitemaps and RSS — everywhere a relative URL is invalid. */
export function absoluteUrl(path = '/'): string {
  return `${env.NEXT_PUBLIC_SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}
