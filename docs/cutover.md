# Production cutover: replacing v2 with this MVP

The procedure for making `main` — and therefore www.rajchowk.in — serve this
application instead of the 25-model v2 platform.

**This was performed on 2026-08-09** (Amplify job 12). The document has been
rewritten against what actually happened, because the first version predicted
something different and got the central mechanic wrong. What follows is
observed, not assumed.

---

## What a cutover actually does

The intuition is that CloudFormation reconciles the stack and **deletes** the
tables the new schema no longer declares. That is not what happens for a change
of this size.

Amplify **replaces the AppSync API**. The API id changes
(`chrtndf7ozentinkoxedkcltni` → `2be6l54s7jajzctnucrmlzmjqq`), and because
Amplify table names embed that id, the new schema gets **brand-new, empty
tables**. The old ones are **retained and orphaned** — still present, still
holding data, no longer managed by any stack.

|                 | Prediction                                            | Observed                                                                                                                       |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| v2 tables       | deleted; disable protection first or the deploy fails | **retained and orphaned.** Protection was never disabled and the deploy succeeded.                                             |
| Cognito pool    | destroyed with its users                              | **retained.** Same pool id, both users intact.                                                                                 |
| Cognito groups  | —                                                     | **pruned to those the new schema declares.** `EDITOR`/`MODERATOR`/`MEMBER` disappeared; every membership in them went with it. |
| Article content | migrated by hand                                      | **not carried over.** New table starts empty; the old rows sit in the orphaned table.                                          |
| S3 media bucket | destroyed                                             | retained and orphaned, same as the tables.                                                                                     |

So the cutover is **not destructive in the way it looks** — but it is not
seamless either. Immediately afterwards the site is live and completely empty,
and nobody can administer it.

### Consequences worth planning for

1. **The live feed is empty** until content is migrated. Readers see the empty
   state, not an error.
2. **Nobody is an administrator.** Group memberships in pruned groups are gone,
   and a user who was `ADMIN` in the old schema keeps it only because this
   schema also declares `ADMIN`.
3. **The orphaned tables keep billing** and are the only copy of everything the
   MVP schema does not model — polls, comments, questions, promises.

---

## Before you start

Confirm which stack you are looking at. Multiple 26-table sets exist in this
account and transposing them costs an afternoon:

```bash
DS=$(aws cloudformation list-stack-resources --region ap-south-1 \
  --stack-name amplify-d1z2jyqeifr0gd-main-branch-29b529b51d \
  --query "StackResourceSummaries[?LogicalResourceId=='data7552DF31'].PhysicalResourceId" --output text)
aws cloudformation describe-stack-resources --region ap-south-1 --stack-name "$DS" \
  --query "StackResources[?ResourceType=='AWS::AppSync::GraphQLApi'].PhysicalResourceId" --output text
```

Whatever that prints is production **right now**. It changes on every cutover.

## 1. Export the content first

Orphaning means the data survives, but do not rely on that — a later cleanup
deletes those tables, and a JSON export is readable without a restore.

```bash
PROD_API=<current production api id>
mkdir -p backup
for t in Article ArticleRevision Category UserProfile ArticleSource ArticleTag Tag; do
  aws dynamodb scan --region ap-south-1 --table-name "${t}-${PROD_API}-NONE" \
    --output json > "backup/v2-${t}-$(date +%F).json"
done
```

Confirm the published rows are in there before continuing:

```bash
node -p "require('./backup/v2-Article-$(date +%F).json').Items
  .filter(i=>i.status?.S==='PUBLISHED')
  .map(i=>({slug:i.slug.S, len:(i.bodyMarkdown?.S||'').length}))"
```

`backup/` is gitignored. Keep it somewhere durable.

## 2. Verify the branch builds

A build that fails after the backend phase leaves the stack changed and the
frontend stale.

```bash
npm run verify        # verify:lock first — a drifted lockfile fails the Amplify build
npx playwright test
```

## 3. Merge

```bash
git checkout main && git pull
git merge 3.0.0
git push origin main
```

`3.0.0` carries a `-s ours` merge of `main`, which is what makes this land the
**complete** MVP. Git does not re-apply a reverted merge, and `main` contains a
revert of an earlier MVP merge — without that commit you would get a handful of
files on top of the v2 source tree. **If `git diff --stat` shows only a few
files, stop and do not push.**

Watch it:

```bash
aws amplify list-jobs --app-id d1z2jyqeifr0gd --branch-name main --region ap-south-1 \
  --max-results 1 --query 'jobSummaries[0].{id:jobId,status:status}'
```

## 4. Re-grant `ADMIN`

Do this immediately — until it is done nobody can publish, and the site is live.

The pool survives, so accounts still exist. What may not survive is group
membership: only groups this schema declares are kept.

```bash
POOL=$(aws cloudformation describe-stacks --region ap-south-1 \
  --stack-name amplify-d1z2jyqeifr0gd-main-branch-29b529b51d \
  --query 'Stacks[0].Outputs[?OutputKey==`userPoolId`].OutputValue' --output text)

aws cognito-idp list-users-in-group --user-pool-id "$POOL" \
  --group-name ADMIN --region ap-south-1 --query 'Users[].Username' --output text

npm run admin -- --create --email you@example.com --user-pool-id "$POOL" --region ap-south-1 --yes
npm run admin -- --grant  --email you@example.com --user-pool-id "$POOL" --region ap-south-1 --yes
```

Prefer `--create` in production: it is the path where the password never reaches
your terminal. `--bootstrap` also works on an existing account — it sets a
password and grants the group in one step — but prints the password to stdout.

## 5. Migrate the content

```bash
NEW_API=$(aws cloudformation describe-stack-resources --region ap-south-1 \
  --stack-name "$DS" --query "StackResources[?ResourceType=='AWS::AppSync::GraphQLApi'].PhysicalResourceId" \
  --output text | sed 's|.*/||')

npm run migrate:articles -- --from "$PROD_API" --to "$NEW_API" --dry-run
npm run migrate:articles -- --from "$PROD_API" --to "$NEW_API"
```

`scripts/migrate-v2-articles.ts` does the field mapping, validates each row with
the application's own `parseArticleInput`, and refuses to write into a table
that lacks this schema's GSIs. Only `PUBLISHED` rows move — v2's other statuses
(`IN_REVIEW`, `SCHEDULED`, `UNPUBLISHED`, `ARCHIVED`) have no honest equivalent
in a two-state model.

Two details it handles that a hand-written script gets wrong:

- **`__typename: 'Article'`** — without it Amplify's GraphQL layer treats the
  row as untyped, `Article.get()` returns nothing, and the admin edit form
  cannot find an article that plainly exists in the table.
- **`feedKey` present only for published rows** — the feed index is sparse, and
  writing `null` is not the same as omitting the attribute. A `null` would put
  the row in the index.

It also refuses to use `authorDisplayName` when it holds a raw UUID, which v2
did for script-created rows, and resolves the byline from the v2 `UserProfile`
instead.

## 6. Verify

```bash
npm run verify:backend       # the public API key must NOT reach the Article model
curl -sL https://www.rajchowk.in/ | grep -o 'article/[a-z0-9-]*'
curl -sL -o /dev/null -w '%{http_code}\n' https://www.rajchowk.in/article/<slug>
```

Then sign in at `/admin/login`, publish a test article, confirm it reaches the
feed, and delete it.

> The feed takes up to 60 seconds — the ISR window — and CloudFront serves one
> stale response after that expires, so it can need a second refresh. Not a
> failed cutover. `/article/<slug>` is immediate.

## 7. Afterwards

- **Decide what to do with the orphaned tables.** They bill indefinitely and no
  stack manages them. They are also the only remaining copy of the data this
  schema does not model. Keep them until the exports are somewhere durable, then
  delete deliberately — nothing will do it for you.
- **Delete the preview branch** if production now serves the same application,
  so nobody publishes into the wrong one:
  `aws amplify delete-branch --app-id <id> --branch-name mvp --region ap-south-1`
- **Tear down sandboxes** that are still running (`npm run sandbox:delete`).
- Re-check deletion protection on the new `Article` table: it is set from
  `isProduction` in `amplify/backend.ts`, but verify rather than assume —
  `describe-table` has disagreed with that setting before.

---

## If a future cutover fails partway

CloudFormation rolls back on failure, but a rollback that cannot restore a
deleted resource leaves the stack in `UPDATE_ROLLBACK_FAILED`.

1. Do **not** retry the deploy.
2. `aws cloudformation describe-stack-events --stack-name <stack> --max-items 30`
   and find the _first_ failure — everything after it is noise.
3. Restore any lost table from point-in-time recovery **under a new name**, then
   copy rows across. PITR cannot restore over an existing table.
4. Reach for `continue-update-rollback --resources-to-skip` only once you know
   which resource is wedged.
