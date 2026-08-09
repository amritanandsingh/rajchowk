import * as z from 'zod'

/**
 * Public environment, validated once at module load.
 *
 * A misconfigured deployment fails here — at build or first boot, with a
 * message naming the variable — rather than silently producing wrong canonical
 * URLs, a broken sitemap and Open Graph tags pointing at localhost. That
 * failure is loud on purpose: the alternative is a site that looks fine and is
 * quietly unindexable.
 *
 * ONLY `NEXT_PUBLIC_*` belongs here. Server secrets are never read from the
 * environment in the Next.js app at all — this MVP has none, and if one is
 * ever needed it belongs in Amplify secret management, consumed inside
 * `amplify/` via `secret('NAME')`.
 *
 * `process.env.NEXT_PUBLIC_*` must be referenced by its full literal name for
 * Next's build-time inlining to work. Destructuring `process.env` compiles to
 * `undefined` in the browser bundle — which is why the object below is written
 * out longhand rather than looped over.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z
    .url({ error: 'NEXT_PUBLIC_SITE_URL must be an absolute URL, e.g. https://rajchowk.in' })
    // A trailing slash produces `https://rajchowk.in//article/x` in every
    // canonical link, which search engines treat as a separate URL.
    .refine((value) => !value.endsWith('/'), {
      error: 'NEXT_PUBLIC_SITE_URL must not end with a slash',
    }),
  NEXT_PUBLIC_SITE_NAME: z.string().min(1).default('राज चौक'),
  NEXT_PUBLIC_AWS_REGION: z.string().min(1).default('ap-south-1'),
  NEXT_PUBLIC_ENV: z
    .enum(['development', 'sandbox', 'staging', 'production'])
    .default('development'),
})

export type PublicEnv = z.infer<typeof publicEnvSchema>

function loadPublicEnv(): PublicEnv {
  const raw = {
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    NEXT_PUBLIC_SITE_NAME: process.env.NEXT_PUBLIC_SITE_NAME,
    NEXT_PUBLIC_AWS_REGION: process.env.NEXT_PUBLIC_AWS_REGION,
    NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV,
  }

  // Strip absent keys so zod applies its defaults rather than failing on an
  // explicit `undefined` — `exactOptionalPropertyTypes` is on, and the two are
  // not the same thing to it.
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

/**
 * Absolute URL for a site-relative path.
 *
 * Used for canonicals, Open Graph tags and the sitemap — everywhere a relative
 * URL is invalid rather than merely unusual.
 */
export function absoluteUrl(path = '/'): string {
  return `${env.NEXT_PUBLIC_SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}
