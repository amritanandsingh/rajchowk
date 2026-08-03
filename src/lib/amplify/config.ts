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
 * `import 'server-only'` is the guard that matters: amplify_outputs.json holds
 * the User Pool ID, App Client ID, Identity Pool ID, AppSync endpoint and the
 * public API key, and this module gates every server read. It must never be
 * pulled into a client bundle by an accidental import.
 */

export const { runWithAmplifyServerContext } = createServerRunner({ config: outputs })

/**
 * Client for reads made ON BEHALF OF A SIGNED-IN USER.
 *
 * Reads cookies, so any route calling this becomes dynamically rendered. That
 * is correct for /admin, /account and /auth — they are dynamic anyway — but it
 * must never be used on a public ISR page.
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
 * cookie adapter, and the reason is a hard build-time constraint that only
 * showed up when the production build ran:
 *
 *   Error: `cookies` was called outside a request scope
 *          at Failed to collect page data for /news/[slug]
 *
 * `generateServerClientUsingCookies` calls `cookies()` unconditionally.
 * `generateStaticParams` and static prerendering run with NO request scope, so
 * any cookie-backed client makes a statically generated page impossible — and
 * opting those pages into dynamic rendering would disable ISR site-wide, which
 * is the single most expensive thing this app could do on Amplify Hosting
 * compute.
 *
 * A module-scoped client is safe HERE, specifically because API-key auth is
 * stateless: there is no session, no per-user credential, and therefore no
 * cross-request state that could leak between visitors. The same shortcut
 * would be a serious bug for the userPool client above, which is why that one
 * keeps the cookie adapter.
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
 * Uses `apiKey`, which is forced by the platform rather than chosen: Amplify
 * rejects identity-pool auth on `a.handler.custom`, so the APPSYNC_JS content
 * queries cannot grant `allow.guest()`. See the long note in
 * amplify/data/resource.ts.
 *
 * The key reaches the read-only content queries plus READ on Category, Tag and
 * ArticleRedirect. It has no access to Article, Comment, AudienceQuestion,
 * Vote or UserProfile — verified against the deployed backend by
 * `npm run verify:backend`, which asserts that a model list returns
 * `Unauthorized`.
 */
export function publicServerClient() {
  return publicClient
}

export const amplifyOutputs = outputs
