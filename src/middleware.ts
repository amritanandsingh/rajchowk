import { fetchAuthSession } from 'aws-amplify/auth/server'
import { NextResponse, type NextRequest } from 'next/server'

import { runWithAmplifyServerContext } from '@/lib/amplify/config'

/**
 * Server-side gate on /admin.
 *
 * "Do not rely only on frontend route protection" — this is the second of
 * three layers, and it is worth being precise about what each one is for,
 * because only one of them is a security boundary:
 *
 *   1. The admin UI hides what you cannot do. Cosmetic. Anyone can edit their
 *      own JavaScript.
 *   2. THIS. Runs on the server before any admin HTML is generated, so an
 *      unauthenticated request never receives the dashboard markup at all. It
 *      is a real check — the token is verified below, not merely present — but
 *      its job is to send people somewhere sensible, not to protect data.
 *   3. `allow.group('ADMIN')` on every AppSync operation, plus the `isAdmin`
 *      re-check inside each Lambda. THIS is the boundary. Delete this
 *      middleware file entirely and no unauthorised person could still read a
 *      draft or publish anything — they would just see an empty dashboard
 *      shell instead of a redirect.
 *
 * Stating that ordering matters, because middleware is exactly where people
 * are tempted to put authorisation that then quietly becomes the only check.
 */

export async function middleware(request: NextRequest) {
  const response = NextResponse.next()

  const authorised = await runWithAmplifyServerContext({
    nextServerContext: { request, response },
    async operation(contextSpec) {
      try {
        /**
         * `forceRefresh: false` is deliberate. The middleware runs on every
         * admin navigation, and forcing a refresh would hit Cognito each time
         * — latency on every click, and a rate-limit risk for no benefit,
         * since an expired token fails this check anyway.
         *
         * `fetchAuthSession` VERIFIES the token; it does not merely decode it.
         * A hand-edited `cognito:groups` claim fails signature validation and
         * lands in the catch below.
         */
        const session = await fetchAuthSession(contextSpec, { forceRefresh: false })

        const groups = session.tokens?.idToken?.payload['cognito:groups']
        if (!Array.isArray(groups)) return false
        return groups.includes('ADMIN')
      } catch {
        // No session, an expired one, or a malformed token. All of them mean
        // "not signed in as an administrator", and none of them should log —
        // an unauthenticated hit on /admin is ordinary internet noise, and
        // logging it would bury the events that matter.
        return false
      }
    },
  })

  const { pathname, search } = request.nextUrl
  const isLoginPage = pathname === '/admin/login'

  if (authorised) {
    // An already-signed-in admin has no use for the sign-in form. Send them on
    // rather than making them work out that they are logged in already.
    if (isLoginPage) return NextResponse.redirect(new URL('/admin', request.url))
    return response
  }

  // Not authorised and heading to the login page: let it through, or this
  // redirects to itself forever.
  if (isLoginPage) return response

  const loginUrl = new URL('/admin/login', request.url)

  /**
   * Round-trip the intended destination so an editor who bookmarked
   * /admin/articles/new lands back there after signing in.
   *
   * Stored as a PATH ONLY and validated on the way out (see the login page):
   * echoing a caller-supplied absolute URL into a post-login redirect is a
   * textbook open-redirect, and a phishing link to
   * /admin/login?next=https://evil.example is exactly the shape it takes.
   */
  if (pathname !== '/admin') {
    loginUrl.searchParams.set('next', `${pathname}${search}`)
  }

  return NextResponse.redirect(loginUrl)
}

export const config = {
  /**
   * Everything under /admin, including /admin/login itself.
   *
   * Including the login page looks redundant given the early return above, but
   * it is what lets an ALREADY-signed-in admin land on /admin/login and be
   * bounced onward rather than shown a sign-in form they do not need. The
   * matcher must be a static string literal — Next parses it at build time and
   * cannot evaluate an expression here.
   */
  matcher: ['/admin/:path*'],
}
