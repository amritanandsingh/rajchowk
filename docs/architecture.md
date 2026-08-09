# Architecture

## Request path

Public pages are rendered by Next.js on Amplify Hosting and use static generation or 60-second ISR. Server reads use AppSync API-key authorization and only call purpose-built public queries. Those resolvers hard-code publish/visibility states and return allowlisted fields, so drafts, moderation fields, subscriber data and internal ownership data cannot be selected by an anonymous client.

Authenticated browser actions use Cognito user-pool authorization. Mutations that require atomic counters, idempotency, rate limiting or auditing run through Lambda handlers and DynamoDB transactions. Editor and admin operations are additionally protected by Cognito group rules in the schema; the dashboard guard is user experience, not the security boundary.

### The two browser clients

`src/lib/amplify/browser-client.ts` exports two data clients, and picking the wrong one produces `Unauthorized` at runtime with nothing wrong in the schema:

- `browserDataClient` (`identityPool`) — only for operations that declare `allow.guest()`: the newsletter mutations and `searchContent`.
- `adminDataClient` (`userPool`) — everything a signed-in member of staff does: `Category`, `Article`, `publishArticle`, `moderateContent`.

The reason is a default that is invisible in the schema text: **`allow.authenticated()` and `allow.group(...)` both resolve to the Cognito user pool, never the identity pool**, while the API's `defaultAuthorizationMode` is `identityPool`. A client created without an explicit `authMode` therefore signs with SigV4, carries no user-pool token, matches no rule on those models, and is refused — which is how `/admin/articles` came to show an `Unauthorized` article table and an empty category dropdown at the same time. An operation intended for both audiences must list `allow.guest()`, `allow.authenticated('identityPool')` and `allow.authenticated()` explicitly, as the newsletter and search mutations do.

Amplify v6 resolves with `{ data, errors }` rather than throwing, so every call must check `errors`; `firstErrorMessage` exists for that. An unchecked list call renders an empty collection while the API is refusing every request, which is indistinguishable from an empty database.

## Data and media

- DynamoDB tables are on-demand. Durable editorial and account tables have point-in-time recovery; production tables also have deletion protection.
- Rate-limit records live in a separate TTL table and store HMAC-derived identifiers, not raw IP addresses.
- Uploaded media is private by default and public editorial media is read through narrowly scoped S3 paths. Next Image remote hosts are restricted to the deployed bucket and approved YouTube thumbnail origins.
- High-volume analytics rows expire through DynamoDB TTL.

## Content lifecycle

Articles move through draft, review, scheduled/published and archived states. Publishing creates revisions, search documents/tokens and audit records. Public listing/detail resolvers only expose published, currently visible content. Comments, questions and reports enter moderation workflows; only approved records reach public reads.

## Caching and security headers

Amplify Hosting does not provide on-demand ISR invalidation for this design, so public freshness is bounded by the route revalidation TTL. The global CSP is compatible with static/ISR Next.js output; development alone permits `unsafe-eval` for Next Fast Refresh. HSTS, clickjacking protection, MIME sniffing protection, referrer policy, permissions policy and no-index rules for account/admin/auth routes are configured in `next.config.ts`.
