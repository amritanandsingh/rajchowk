# राज चौक

A minimal editorial publishing platform. Anyone can read published articles without an account; an authenticated administrator writes and publishes them. Everything — Cognito, DynamoDB, AppSync, IAM — is defined in this repository and provisioned by AWS Amplify Gen 2.

Built with Next.js 15 (App Router), TypeScript and AWS Amplify Gen 2, in **ap-south-1 (Mumbai)**.

---

## ⚠️ Deployment isolation — read before deploying

**This application is live in production.** Branch `main` of the Amplify app `rajchowk` (`d1z2jyqeifr0gd`) serves www.rajchowk.in, cut over from the previous 25-model platform on 2026-08-09 (Amplify job 12). [docs/cutover.md](docs/cutover.md) records what that actually did.

### Which API is production

**Do not hard-code this.** The AppSync API id changes on any cutover, and Amplify table names embed it, so a stale id points at an orphaned table that still answers queries. Several 26-table sets exist in this account.

```bash
DS=$(aws cloudformation list-stack-resources --region ap-south-1 \
  --stack-name amplify-d1z2jyqeifr0gd-main-branch-29b529b51d \
  --query "StackResourceSummaries[?LogicalResourceId=='data7552DF31'].PhysicalResourceId" --output text)
aws cloudformation describe-stack-resources --region ap-south-1 --stack-name "$DS" \
  --query "StackResources[?ResourceType=='AWS::AppSync::GraphQLApi'].PhysicalResourceId" --output text
```

As of the cutover:

|                                  | AppSync API                  | Note                                             |
| -------------------------------- | ---------------------------- | ------------------------------------------------ |
| **Production** (www.rajchowk.in) | `2be6l54s7jajzctnucrmlzmjqq` | this schema                                      |
| Orphaned v2 backend              | `chrtndf7ozentinkoxedkcltni` | retained by the cutover; **still billing**       |
| Orphaned sandbox                 | `74t4otovdvf5rgctcj74cqsq4i` | `amplify-rajchowk-amritsingh-sandbox-3d81aa0f0f` |

### What protects production

One guard remains in code, and it fails the deploy rather than warning:

| Guard                                      | Where                | Overridden by        |
| ------------------------------------------ | -------------------- | -------------------- |
| Refuses to synthesise outside `ap-south-1` | `amplify/backend.ts` | `ALLOW_ANY_REGION=1` |

A second guard once refused any deploy to `main`. It was removed at cutover — see the comment at the top of `amplify/backend.ts`. Now that `main` **is** this application, a check blocking the MVP from `main` would block every release.

> Two earlier claims in this file were wrong and are corrected here. Deletion protection was reported as `false` on production; that reading came from the **sandbox** tables — it is `true` in production. And a cutover was described as deleting the old tables; it does not. Amplify replaces the AppSync API and the old tables are **orphaned**, which is why the v2 data survived and why it is still costing money.

There is a quieter hazard worth keeping. `ampx sandbox` derives its stack name from `package.json` `name`, so this package is deliberately named **`rajchowk-mvp`**, not `rajchowk` — the latter resolves to the old sandbox stack holding the 25-model schema. The `sandbox` scripts also pin `--identifier mvp`. Do not run a bare `ampx sandbox`. (The product name readers see comes from `NEXT_PUBLIC_SITE_NAME`, not this field.)

### Do not remove the `-s ours` merge on `3.0.0`

`main` contains a revert of an earlier MVP merge (PR #4, whose build failed on `npm ci` — see _Known behaviour_). Git does not re-apply a reverted merge, so `3.0.0` carries a `-s ours` merge of `main` that records the revert as an ancestor while keeping the MVP tree intact. Without it a merge to `main` lands three stray files on top of the v2 source tree instead of the whole application.

---

## Architecture

```
Reader (anonymous, no account)
   │
   └─► Next.js on Amplify Hosting SSR
          │  /         dynamic — reads ?q= for search
          │  /article/ ISR, revalidate 60s
          │  /about    static — copy only, no data
          │  server-only Amplify client, API-key auth
          └─► AppSync ── listPublishedArticles / searchPublishedArticles
                 │        / getPublishedArticleBySlug
                 │        (APPSYNC_JS resolvers — no Lambda, no cold start)
                 └─► DynamoDB Article
                        ├─ GSI articlesByFeedKeyAndPublishedAt  (sparse — feed AND search)
                        └─ GSI articlesBySlug                   (the article page)

Administrator (Cognito, ADMIN group)
   │
   └─► /admin ── dynamic, session in cookies
          ├─ middleware.ts verifies the session and the cognito:groups claim
          ├─► AppSync listArticlesForAdmin      (allow.group ADMIN)
          └─► AppSync saveArticle / setArticleStatus  (allow.group ADMIN)
                 └─► Lambda re-verifies the claim, holds scoped table IAM
                        └─► DynamoDB Article
```

### How a draft stays private

Amplify model-level auth cannot express _"guests may read rows WHERE status == PUBLISHED"_. Granting `allow.guest().to(['read'])` on `Article` would let anyone call `listArticles({ filter: { status: { eq: 'DRAFT' } } })`. So the capability is **removed rather than filtered**, in four layers:

1. `Article` carries **no public authorization rule at all** — `listArticles` does not exist for an anonymous caller.
2. `disableOperations(['create','update','delete','subscriptions'])` deletes every write mutation from the schema. There is no unchecked path to article creation because there is no path at all except the two Lambdas.
3. The whole public surface is APPSYNC_JS custom queries returning purpose-built types with an **explicit field allowlist** — `authorSub` and `content` are absent from the feed by construction, not by filtering.
4. `status`, `feedKey`, `statusKey`, `publishedAt` and the author fields are field-level `.to(['read'])` — a **write lock**. Only a Lambda holding scoped table IAM can set them.

`npm run verify:backend` asserts this against a live deployment by checking that the public API key gets `Unauthorized` on the model.

### Index design

`feedKey` holds the literal `'PUBLISHED'` or is **absent**. That makes `articlesByFeedKeyAndPublishedAt` a **sparse index**: drafts have no entry in it at all, and unpublishing _removes_ the index entry rather than relying on a filter to hide it. The feed is one `Query`, newest-first, never a `Scan`. `statusKey` is always present so the admin dashboard can enumerate drafts — also a Query, because Amplify's generated `Article.list()` is a Scan that would drag every article's full Markdown body through it.

Trade-off, stated because §6 of the specification asks for it: the feed index has a single partition. At MVP scale that is the right call — it is what buys correctly ordered pagination for one RCU-cheap query. A site doing serious volume would shard the partition key (`PUBLISHED#<bucket>`) and merge at read time.

### Idempotency

**Writes.** The browser generates one UUIDv4 per form mount and sends it as `id`. Create is a conditional `PutItem` on `attribute_not_exists(id)`, so a double-clicked submit fails the condition and the handler returns the article that already exists. Enforced at the database, not by hoping a disabled button won the race.

**Infrastructure.** Table and pool names are derived by Amplify from stable logical IDs; no `tableName` is set anywhere. Deploy #2 and #3 update the same table. **Never rename the `Article` model** — CloudFormation cannot rename a table in place, so it would replace it and lose every row.

---

## AWS resources this repository creates

| Resource                        | Why it exists                                                                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cognito user pool** + client  | Administrator identity. Self sign-up is **disabled** (`allowAdminCreateUserOnly`) — no reader needs an account. 12-character password policy, optional TOTP.                                                |
| **Cognito group `ADMIN`**       | The only capability in the system. Created empty; membership is granted out-of-band (see _Admin setup_).                                                                                                    |
| **Cognito identity pool**       | Created by `defineAuth`. Guest identities are **disabled** — anonymous reads use an API key from the server, never browser IAM credentials.                                                                 |
| **AppSync GraphQL API**         | 3 queries, 2 mutations. Query depth capped at 4; introspection disabled in production.                                                                                                                      |
| **API key**                     | The only credential an anonymous read uses. Reaches exactly two read-only queries; never enters a browser bundle (all public reads are `server-only`). **Expires after 365 days — rotation is a redeploy.** |
| **DynamoDB table `Article`**    | On-demand billing, point-in-time recovery on. Three GSIs (feed, slug, admin list). Deletion protection is _requested_ for production in `backend.ts` — see the caveat under "Deployment isolation".         |
| **Lambda `save-article`**       | Create/update. Scoped IAM: `GetItem`, `PutItem`, `UpdateItem`, `Query` on the table and `/index/*` only.                                                                                                    |
| **Lambda `set-article-status`** | Publish/unpublish. Scoped IAM: `GetItem`, `UpdateItem` only.                                                                                                                                                |
| **Amplify Hosting SSR**         | Next.js compute + CDN.                                                                                                                                                                                      |

| **S3 bucket** (article images) | Private. No public policy, no ACLs, no identity-pool access rules — see `amplify/storage/resource.ts`. Reached by exactly two principals: the presign Lambda (`s3:PutObject` on `articles/*`) and the CloudFront distribution (read, via OAC). |
| **CloudFront distribution** | Serves article images so the bucket can stay private. Origin Access Control, `nosniff` response header, immutable caching (keys carry a uuid, so a changed image is a new key and nothing is ever invalidated). |
| **Lambda `create-media-upload-url`** | Issues a 5-minute presigned PUT for one object. Scoped IAM: `s3:PutObject` on `articles/*` only. |

Not created, deliberately: no SES, no OpenSearch, no Redis, no VPC, no always-on compute, no image resizing.

> **This list gained S3 on the image-upload change.** It previously read "no S3", which was true and is no longer. What has not changed is the reason that line existed: nothing here is public, nothing is always on, and the bucket has no access rules of its own. Adding a _second_ bucket, or opening this one, is the thing to argue about.

---

## Local development

Requires Node `22.22.2` and npm `10.9+` (see `.nvmrc`).

**Without an AWS account** — the full quality gate runs on a fresh clone:

```bash
npm ci
npm run ci:outputs      # writes a secret-free placeholder amplify_outputs.json
npm run verify          # fixture check, format, lint, types, 241 tests, production build
npm run e2e:install     # one-time browser download
npm run e2e             # 26 end-to-end checks against an unreachable backend
```

`amplify_outputs.json` is gitignored but is a _static import_, so without that placeholder nothing compiles. The e2e suite deliberately runs against the dead placeholder endpoint — that is how the "never show a blank screen" requirement is actually tested.

**With an AWS account:**

```bash
cp .env.example .env.local
export AWS_REGION=ap-south-1

npm run sandbox:once                                # NOT `ampx sandbox` — see the warning above
npm run admin -- --create --email you@example.com   # Cognito emails a temporary password
npm run admin -- --grant  --email you@example.com   # the account is powerless until this runs
npm run verify:backend                              # asserts a guest CANNOT read the model
npm run dev
```

---

## Deployment

The Amplify app already exists and is connected to this GitHub repository. Deploying is: create a branch, push.

```bash
# One-time, and programmatic — no console visit required.
aws amplify create-branch \
  --app-id d1z2jyqeifr0gd \
  --branch-name mvp \
  --region ap-south-1 \
  --framework 'Next.js - SSR' \
  --enable-auto-build

git push origin HEAD:mvp
```

Amplify runs the committed `amplify.yml`: the backend phase deploys the stack and generates `amplify_outputs.json`, then the frontend phase runs format, lint, typecheck, tests and build before publishing `.next`.

Set these in the branch environment (Amplify Console → Hosting → Environment variables):

```
NEXT_PUBLIC_SITE_URL   = https://mvp.d1z2jyqeifr0gd.amplifyapp.com   # no trailing slash
NEXT_PUBLIC_SITE_NAME  = राज चौक
NEXT_PUBLIC_AWS_REGION = ap-south-1
NEXT_PUBLIC_ENV        = staging
```

No secrets. There are none.

### One-time actions that cannot live in this repository

1. **Creating the Amplify branch** — the command above. The app and its GitHub connection already exist.
2. **Creating the first administrator** — see below. Cognito cannot bootstrap its own first admin, by design.
3. **CDK bootstrap** in `ap-south-1` — already done for account `338605123781`.

The region is _not_ on this list: it is fixed by the Amplify app and additionally asserted at synth time.

---

## Admin setup

There is **no in-app path to become an administrator**, and that is the design rather than a gap: every route that could grant `ADMIN` is itself behind `allow.group('ADMIN')`, so the first admin cannot be created from inside the application. The only principal who can is one holding AWS credentials.

```bash
npm run admin -- --create --email you@example.com   # Cognito generates and emails a temporary password
npm run admin -- --grant  --email you@example.com   # add the ADMIN group
npm run admin -- --list   --email you@example.com   # read-only
npm run admin -- --revoke --email you@example.com   # refuses to remove the last admin without --yes
```

**No password appears in source, in the script, or in shell history.** `--create` asks Cognito to generate one and email it; the operator sets a real password at first sign-in through the `CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED` flow the sign-in form implements.

Creating an account grants **no capability at all** until `--grant` runs — an authenticated Cognito user with no group cannot read a draft or publish anything. After a group change, sign out and back in: Cognito issues the `cognito:groups` claim at sign-in, so an existing session will not see it.

### `--bootstrap`, for a preview branch or sandbox

Cognito's invitation email is sent from `no-reply@verificationemail.com` and routinely lands in spam, which is the usual reason a first sign-in stalls. On a throwaway environment that is pure friction, so:

```bash
npm run admin -- --bootstrap --email you@example.com
```

It creates the account with `MessageAction: SUPPRESS` (**no email at all**), generates a 20-character password satisfying the pool policy, sets it as _permanent_ so there is no change-password challenge, grants `ADMIN`, and prints the password **once**.

The trade is explicit: that password is written to stdout, so it lives in your terminal scrollback. **Use `--create` for anything that matters** — it is the only path where the password never touches this machine. `--bootstrap` also refuses to run against a pool that already has an administrator unless you pass `--yes`, so it cannot be used to quietly reset a colleague's account.

To target a pool other than the one in `amplify_outputs.json` — a deployed branch, say, when your local outputs point at a sandbox — name it explicitly:

```bash
npm run admin -- --bootstrap --email you@example.com \
  --user-pool-id ap-south-1_XXXXXXXXX --region ap-south-1 --yes
```

Find a branch's pool id with:

```bash
aws cloudformation describe-stacks --region ap-south-1 \
  --stack-name amplify-<appId>-<branch>-branch-<hash> \
  --query 'Stacks[0].Outputs[?OutputKey==`userPoolId`].OutputValue' --output text
```

---

## Writing and publishing an article

The admin UI is **Hindi-only** by design, so the labels are worth having to hand.

| Step | Where                               | What                                                                   |
| ---- | ----------------------------------- | ---------------------------------------------------------------------- |
| 1    | `/admin/login`                      | **ईमेल** = email, **पासवर्ड** = password, then **साइन इन करें**        |
| 2    | `/admin`                            | Dashboard: **ड्राफ़्ट** (drafts) above, **प्रकाशित** (published) below |
| 3    | **नया लेख** → `/admin/articles/new` | The create form                                                        |

On the form:

- **शीर्षक** — headline (4–300 characters)
- **सारांश** — summary shown on the feed (10–600)
- **लेख** — the body, in **Markdown**: `## subheading`, `**bold**`, `- list item`, `[text](https://…)`
- **URL (वैकल्पिक)** — optional slug. Left blank it is derived from the headline; a purely Devanagari headline has no ASCII form, so it becomes `lekh-<8 hex>`. Type something here for a readable URL — and note the slug is **permanent**, since changing it would break every inbound link.

Then either **ड्राफ़्ट सहेजें** (save a draft — visible under ड्राफ़्ट, _not_ on the public feed) or **सहेजें और प्रकाशित करें** (save and publish in one step).

From the dashboard: **प्रकाशित करें** publishes a draft, **फ़ीड से हटाएँ** unpublishes, **संपादित करें** edits.

> **A published article now appears on `/` immediately.** This used to say "up to 60 seconds", which was the ISR window. It no longer applies: `/` reads `?q=` for search, and `searchParams` is a dynamic API, so the route is server-rendered per request rather than prerendered. `revalidate = 60` is still exported and is now inert — it would only apply if the route were ever served statically again.
>
> This is a smaller change than it sounds. Amplify was already serving `/` from Lambda with `cache-control: no-store`, re-rendering every request; the TTL was buying nothing in production. The article is reachable at `/article/<slug>` immediately, as before, and that route is still ISR at 60s.

---

## Environment variables

| Variable                    | Kind                         | Notes                                                                                                     |
| --------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`      | **Public frontend**          | Absolute, no trailing slash. Validated at module load.                                                    |
| `NEXT_PUBLIC_SITE_NAME`     | **Public frontend**          | Defaults to राज चौक.                                                                                      |
| `NEXT_PUBLIC_AWS_REGION`    | **Public frontend**          | Defaults to `ap-south-1`.                                                                                 |
| `NEXT_PUBLIC_ENV`           | **Public frontend**          | `development` \| `sandbox` \| `staging` \| `production`.                                                  |
| `AWS_PROFILE`, `AWS_REGION` | **Server-side / local only** | Credentials come from `~/.aws`, never a file.                                                             |
| `ALLOW_ANY_REGION`          | **Synth-time**               | Escape hatch for the region guard. Unset everywhere by default.                                           |
| —                           | **Secrets**                  | **None.** Cognito and AppSync credentials exist only in the generated, gitignored `amplify_outputs.json`. |

Everything prefixed `NEXT_PUBLIC_` is inlined into the browser bundle and is world-readable. `src/lib/env.ts` validates all four with zod at module load, so a misconfiguration fails the build with a message naming the variable rather than producing silently wrong canonical URLs.

---

## Verification

### Public feed access

Open `/` signed out. Articles appear newest-first with no account and no Cognito cookie. `curl -s https://<host>/ | grep -c 'article/'` works from a clean session.

### Admin authentication

Visit `/admin` signed out → redirected to `/admin/login`. The dashboard markup is never generated, not merely hidden — `curl -s https://<host>/admin | grep 'संपादकीय डैशबोर्ड'` returns nothing.

### Admin authorization

Sign in as a Cognito user **without** the `ADMIN` group: sign-in succeeds, the group check fails, the account is signed straight back out with an explicit message. This is the check that proves authentication ≠ authorization.

```bash
npm run verify:backend    # asserts the public API key CANNOT read the Article model
```

### Article creation and DynamoDB persistence

Create a draft at `/admin/articles/new` → it appears under **ड्राफ़्ट** and **not** on `/`, and searching a word from its title finds nothing (the feed index is sparse, so a draft has no entry for search to reach). Publish it → it appears on `/` on the next request and at `/article/<slug>`, and is now findable by title or summary. Then confirm the row:

```bash
# The table is Article-<appsyncApiId>-NONE.
#
# The apiId is NOT the hostname prefix of the GraphQL URL — they are different
# identifiers (e.g. url o567hvi… but apiId 32mz5fa…), and this account holds
# three Article-* tables, so guessing picks the wrong one. Look it up:
API_ID=$(aws appsync list-graphql-apis --region ap-south-1 \
  --query "graphqlApis[?uris.GRAPHQL=='$(node -p "require('./amplify_outputs.json').data.url")'].apiId" \
  --output text)

aws dynamodb scan --region ap-south-1 \
  --table-name "Article-${API_ID}-NONE" \
  --projection-expression "id,slug,#s,feedKey" \
  --expression-attribute-names '{"#s":"status"}' \
  --max-items 5
```

A published row carries `status: PUBLISHED` **and** `feedKey: PUBLISHED`; a draft has `status: DRAFT` and **no `feedKey` attribute at all** — that absence is the sparse index doing its job.

Unpublish it → it disappears from `/` and `/article/<slug>` shows the not-found page. Double-click **सहेजें और प्रकाशित करें** → exactly one row.

### Redeployment idempotency

```bash
npm run verify:backend    # note the AppSync endpoint and user pool id
npm run sandbox:once      # deploy again
npm run verify:backend    # both values must be IDENTICAL
```

A changed value means the deployment replaced infrastructure instead of updating it. `aws dynamodb list-tables --region ap-south-1` must show exactly one `Article-*` table for this stack — never `Article-1`, `Article-2`.

**Verified on 2026-08-09** against sandbox stack `amplify-rajchowkmvp-mvp-sandbox-7883fdb38b`. Four consecutive deploys — the first a create, the second and third byte-identical no-ops, the fourth carrying a real schema change — all resolved to the same physical resources:

|                    | Deploy 1               | 2    | 3    | 4 (schema changed) |
| ------------------ | ---------------------- | ---- | ---- | ------------------ |
| User pool          | `ap-south-1_ggPSke9sA` | same | same | same               |
| AppSync endpoint   | `o567hvi…`             | same | same | same               |
| `Article-*` tables | 1                      | 1    | 1    | 1                  |

Deploy 2 completed in 6.8s because CloudFormation had nothing to change — which is what idempotent looks like.

### Isolation from the existing production stack

```bash
aws cloudformation describe-stacks --region ap-south-1 \
  --stack-name amplify-d1z2jyqeifr0gd-main-branch-29b529b51d \
  --query 'Stacks[0].StackStatus'
```

Must still be `UPDATE_COMPLETE` with its 25 tables intact.

---

## Testing

241 unit and component tests, plus 42 end-to-end checks across desktop and mobile viewports. `npm run test` runs the first two; `npm run e2e` runs the third.

| Requirement                                   | Where                                                                                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Article validation                            | `src/lib/domain/article.test.ts` — bounds, trimming, NFC normalisation, slug shape                                                                                   |
| Article creation logic                        | `amplify/functions/save-article/handler.test.ts`                                                                                                                     |
| **Unauthorized users cannot create articles** | Same file — unauthenticated and authenticated-non-admin both refused **before any write**                                                                            |
| Admin authorization                           | `amplify/functions/shared/identity.test.ts` — including near-miss group names                                                                                        |
| Published article retrieval                   | `amplify/data/resolvers/public-reads.test.ts` — a draft and a missing article produce a byte-identical error, closing the enumeration oracle                         |
| Public feed behaviour                         | Same file — server-set partition key, limit clamping, field allowlist                                                                                                |
| Reusable UI/business logic                    | `article-form.test.tsx` (validation, duplicate submission, expired session), `article-list.test.tsx` (empty vs error), `safe-href.test.ts`, `article-status.test.ts` |

The e2e suite runs against a deliberately **unreachable** backend, which is what proves the degraded path: the feed renders its empty state rather than a stack trace, and `/admin` still redirects.

---

## Security notes

- Least-privilege IAM: each Lambda gets only the DynamoDB actions it uses, scoped to the table and `/index/*`. `grantReadWriteData` is deliberately avoided — it misses secondary indexes. Verified on the deployed role: `save-article` holds exactly `GetItem`, `PutItem`, `UpdateItem`, `Query` and nothing else.
- **No `allow.resource()` on the schema.** Adding it attaches `appsync:GraphQL` on `Query/*`, `Mutation/*` and `Subscription/*` to the named functions — so `save-article` could have invoked `setArticleStatus`, collapsing the privilege separation the schema exists to enforce. Neither handler calls the API, so the grant is absent. See the comment at the foot of `amplify/data/resource.ts`.
- Backend authorization is independent of the frontend: AppSync enforces `allow.group('ADMIN')`, and each handler re-derives the predicate from the verified claim. Deleting `middleware.ts` would remove a redirect, not a boundary.
- Markdown is sanitised on the hast tree. `rehype-raw` is banned by ESLint, `dangerouslySetInnerHTML` is banned outright, and `react-markdown` never produces an HTML string.
- No secret is logged. Handler errors log `error.message` only; the browser receives a stable code, never AWS detail.
- Security headers on every response: CSP with `frame-ancestors 'none'` and `object-src 'none'`, HSTS with preload, `nosniff`, `X-Frame-Options: DENY`, a restrictive `Permissions-Policy`, and Trusted Types in report-only.
- `/admin/*` additionally sends `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`.

**Known advisories.** `npm audit` reports 17 high-severity findings, all in `@aws-amplify/backend-cli`'s development-only GraphQL codegen chain (`immutable`, `lodash`, `brace-expansion` under `aws-cdk-lib`). None are in the runtime dependency tree — verified with `npm ls <pkg> --omit=dev` — and none process untrusted input; they parse our own schema at build time. Fixing them requires major-version bumps to Amplify's own tooling.

---

## Known behaviour worth knowing about

**Article images are uploaded by presigned URL, and three things about that are deliberate.**

The editor asks `createMediaUploadUrl` for a signed PUT and sends the file straight to S3. The bytes never pass through AppSync or a Lambda, so there is no 6 MB payload ceiling and no compute time proportional to file size. The object key is derived **server-side** from the article id plus a fresh uuid — there is no filename, key or path argument on the mutation, because a filename is attacker-controlled and is exactly how a traversal would arrive.

- **The handler never sees the file.** A declared content type is therefore not checked against the file's magic bytes, and it cannot be. What makes that survivable is downstream: images are served from a different origin than the app, and CloudFront sends `X-Content-Type-Options: nosniff`, so a mislabelled file is inert rather than executable. **SVG is refused outright** — it is the one image-shaped format that is a script container, and `src/lib/domain/media.ts` says so at the point of refusal.
- **Nothing is garbage-collected.** Deleting an article, or removing an image from its Markdown, leaves the object in the bucket. Only incomplete multipart uploads expire (7 days). This is the first resource here with unbounded growth; a cleanup job would be expressible because everything is grouped under `articles/<id>/`, but none exists.
- **Nothing is resized.** A 5 MB photo is served at 5 MB to every reader. The 5 MB cap in `MEDIA_LIMITS` is the only thing standing between an article and a very slow page. Image optimisation is the obvious next step and was left out on purpose.

Rendering an image needed **three** changes to `src/lib/markdown/sanitize-schema.ts`, and they only work together: `img` in `tagNames`, `img: ['src','alt','title']` in `attributes`, and **`src: ['http','https']` in `protocols`**. That last one is easy to miss — the schema replaces `defaultSchema.protocols` wholesale rather than merging, so omitting `src` does not inherit the default, it means `src` has no protocol allowlist at all. `src/lib/markdown/markdown-content.test.tsx` covers it.

**Search matches titles and summaries, case-sensitively, and never article bodies.** `searchPublishedArticles` is the feed resolver with one extra filter clause — the same sparse `articlesByFeedKeyAndPublishedAt` index, the same hard-coded `PUBLISHED` partition key, so a draft is as unsearchable as it is unlistable.

Two limits fall out of that, both deliberate:

- **No body search.** The index projects `title` and `summary` but not `content`. Searching the body would mean a base-table read per candidate row. Adding `content` to the projection is not an option either — DynamoDB cannot alter a GSI's projection in place, so it would mean deleting and recreating the index, taking the live feed down.
- **`contains` is case-sensitive** and DynamoDB has no `lower()`. Devanagari is caseless, so Hindi search is unaffected; a code-mixed Latin headline will miss on the wrong case ("Modi" vs "modi"). The fix is a lowercased `searchText` attribute written by the save Lambda — which would have to join the same GSI projection, so it carries the same rebuild cost.

The one thing that is _not_ optional: **DynamoDB applies a filter AFTER `limit`**, so the resolver's limit is how many index items it reads, not how many match. A single-shot search returns zero results with a non-null `nextToken` whenever the matches sit past the first page read. `searchPublishedArticles` in `src/lib/amplify/queries.ts` loops until it has a full page of matches or hits a five-round-trip ceiling; `src/lib/amplify/queries.test.ts` is the regression test. Do not collapse that loop into one call.

**A drifted lockfile broke a `main` deployment (2026-08-09, Amplify job 10).** `npm ci` refused the committed `package-lock.json` with 89 `Missing:` entries and 2 `Invalid:` version conflicts, failing the build before any code compiled.

The lockfile was _internally inconsistent_: `@aws-amplify/data-construct` and `@aws-amplify/graphql-api-construct` have a nested `@aws-amplify/plugin-types` that pins `@aws-cdk/toolkit-lib@1.19.0`, but the lockfile emitted no node satisfying that pin — only the hoisted `1.32.0`. (`zod@3.24.2` vs `3.25.17` had the same shape.) `npm install` accepts its own output; `npm ci`, which installs the lock exactly as written, does not.

Why every local gate passed anyway: `format`, `lint`, `typecheck`, `test` and `build` all run against an **already-populated `node_modules`**. None of them installs from the lock, so none of them can see the drift. The only check that can is `npm ci` itself.

The guard is **`npm run verify:lock`** (`npm ci --dry-run`), the first step of `npm run verify`. It existed in this repository before, was dropped when the MVP `package.json` was written, and the documented failure recurred verbatim. Do not remove it.

### Never delete `package-lock.json`

This is the part that is genuinely surprising, so it is worth stating flatly: **a from-scratch resolution of this dependency set is broken with the current registry state.** Deleting the lock and reinstalling reproduces the identical 89 + 2 failures — measured for **both** this `package.json` and the v2 one, so it is a property of the Amplify dependency graph rather than of this project.

| Starting point                                        | `@aws-cdk/toolkit-lib` nodes | `npm ci`                |
| ----------------------------------------------------- | ---------------------------- | ----------------------- |
| no lockfile → `npm install`                           | 8                            | ✗ 89 missing, 2 invalid |
| no lockfile → `npm install --package-lock-only`       | 8                            | ✗ same                  |
| **existing lock → `npm install --package-lock-only`** | **16**                       | **✓ passes**            |

To repair a drifted lock, run the repair **with the old lock still in place** — npm uses it as a base and fills in the missing nodes:

```bash
npm install --package-lock-only --include=dev --include=optional   # do NOT delete the lock first
npm run verify:lock                                               # must exit 0 before committing
```

Sanity check, faster than a full install:

```bash
node -e "const l=require('./package-lock.json');console.log(Object.keys(l.packages).filter(k=>k.includes('@aws-cdk/toolkit-lib')).length)"
# 16 = good.  8 = broken.
```

If the lockfile is ever lost, recover it from git history and repair it — do not regenerate it from nothing.

**`notFound()` responds HTTP 200, not 404.** On Next.js 15.5.22, a page calling `notFound()` renders the not-found UI but returns a 200 status. Reproduced against a minimal `next.config.ts` and Next's own default not-found page, so it is framework behaviour rather than anything in this codebase — and it is unaffected by ISR, `force-dynamic`, or removing `generateStaticParams`. Next's _routing-level_ 404 (a URL matching no route at all) is correct; only `notFound()` called from inside a page is affected.

The practical risk is soft-404 indexing. Both Next and `generateMetadata` emit `noindex` for the not-found case, so crawlers do not index unknown slugs. `e2e/public.spec.ts` asserts every emitted `robots` meta says `noindex`, precisely so this protection cannot be dropped silently, and asserts separately that a genuine unmatched route still returns 404. Revisit when the framework sets the status correctly.

**Colour tokens are contrast-tested, not eyeballed.** `--fg-subtle` was originally `oklch(0.58 …)` and measured **4.10:1** against `--bg` — below the 4.5:1 that WCAG AA requires for the `text-xs` bylines and footer it is used for. The axe check in `e2e/public.spec.ts` caught it; it is now `0.52` (5.28 / 5.51 / 4.98 against `bg` / `surface` / `bg-subtle`). Do not lighten it without re-measuring against all three surfaces in both themes.
