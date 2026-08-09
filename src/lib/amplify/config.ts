import 'server-only'

import { createServerRunner } from '@aws-amplify/adapter-nextjs'
import { generateServerClientUsingCookies } from '@aws-amplify/adapter-nextjs/data'
import { Amplify } from 'aws-amplify'
import { generateClient } from 'aws-amplify/data'
import { cookies } from 'next/headers'

import type { Schema } from '@/../amplify/data/resource'
import outputs from '@/../amplify_outputs.json'

/**
 * Server-side Amplify configuration.
 *
 * `import 'server-only'` is the guard that matters. amplify_outputs.json holds
 * the User Pool ID, App Client ID, AppSync endpoint and the public API key,
 * and this module gates every server read. If an accidental import ever pulled
 * it into a client bundle, the build fails here rather than shipping those
 * identifiers to browsers — which is the entire reason the specification's
 * "no credentials in frontend bundles" requirement holds for an app whose
 * public reads use an API key.
 */

export const { runWithAmplifyServerContext } = createServerRunner({ config: outputs })

/**
 * Client for reads made ON BEHALF OF A SIGNED-IN ADMIN.
 *
 * Reads cookies, so any route calling this becomes dynamically rendered. That
 * is correct for /admin, which is dynamic anyway and must never be cached —
 * but it must NEVER be used on a public page, or the whole feed loses ISR.
 */
export function userServerClient() {
  return generateServerClientUsingCookies<Schema>({
    config: outputs,
    cookies,
    authMode: 'userPool',
  })
}

/*
 * ---------------------------------------------------------------------------
 * The public client.
 *
 * This deliberately uses the PLAIN `generateClient` rather than the Next.js
 * cookie adapter, because of a hard build-time constraint:
 *
 *   Error: `cookies` was called outside a request scope
 *          at Failed to collect page data for /article/[slug]
 *
 * `generateServerClientUsingCookies` calls `cookies()` unconditionally.
 * `generateStaticParams` and static prerendering run with NO request scope, so
 * a cookie-backed client makes a statically generated page impossible — and
 * opting those pages into dynamic rendering would disable ISR site-wide, which
 * is the single most expensive change this app could make on Amplify Hosting
 * compute.
 *
 * A module-scoped client is safe HERE specifically because API-key auth is
 * stateless: there is no session, no per-user credential, and therefore no
 * cross-request state that could leak between visitors. The same shortcut
 * would be a serious bug for the userPool client above, which is exactly why
 * that one keeps the cookie adapter.
 *
 * `ssr: false` is intentional — it stops the library installing the
 * cookie-based credential storage we are specifically avoiding.
 * ---------------------------------------------------------------------------
 */
Amplify.configure(outputs, { ssr: false })

const publicClient = generateClient<Schema>({ authMode: 'apiKey' })

/**
 * Client for PUBLIC reads on statically generated / ISR pages.
 *
 * `apiKey` is forced by the platform rather than chosen: Amplify rejects
 * identity-pool authorization on `a.handler.custom`, so the APPSYNC_JS content
 * queries cannot be granted to `allow.guest()`. See the long note in
 * amplify/data/resource.ts.
 *
 * The key reaches exactly two read-only queries. It has NO access to the
 * `Article` model itself — `npm run verify:backend` asserts that against the
 * deployed API by checking a model list comes back Unauthorized.
 */
export function publicServerClient() {
  return publicClient
}

export const amplifyOutputs = outputs
