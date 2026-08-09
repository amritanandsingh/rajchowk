# Production cutover: replacing v2 with this MVP

This is the procedure for making `main` — and therefore www.rajchowk.in — serve
this application instead of the 25-model v2 platform.

**It destroys the v2 backend.** Read the whole document before running anything.
A guard in `amplify/backend.ts` used to refuse this; it was removed deliberately,
and this runbook is what replaced it.

---

## What you are about to do

Amplify Gen 2 gives each branch one backend stack. `main`'s stack currently
contains 26 DynamoDB tables, a Cognito user pool, an S3 media bucket and 14
Lambdas. This repository declares **one** table, no storage and two Lambdas.

Merging therefore does not _add_ an application — CloudFormation reconciles the
stack against the new definition and **deletes everything not declared here**.

| Destroyed                                            | Preserved                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| 25 DynamoDB tables and their contents                | 1 published article, if you export and re-import it (steps 1 and 6) |
| The production Cognito pool **and every user in it** | Nothing else                                                        |
| The S3 media bucket                                  | —                                                                   |
| 12 Lambdas, the SES wiring, the rate-limit table     | —                                                                   |

There is no partial version of this. If you want a reversible option, do not
run this — deploy the MVP on its own branch and repoint the domain instead.

---

## Before you start

Confirm you are pointed at production and not the sandbox. Both stacks have 26
tables and getting them backwards is the easiest mistake here:

```bash
aws cloudformation describe-stack-resources --region ap-south-1 \
  --stack-name amplify-d1z2jyqeifr0gd-main-branch-29b529b51d-data7552DF31-15LNEGO7RSON4 \
  --query "StackResources[?ResourceType=='AWS::AppSync::GraphQLApi'].PhysicalResourceId" --output text
```

Expect `…/apis/chrtndf7ozentinkoxedkcltni`. If you see `74t4otovdvf5rgctcj74cqsq4i`
you are looking at `amplify-rajchowk-amritsingh-sandbox-3d81aa0f0f`. Stop and
re-derive the name.

Everything below uses `PROD_API=chrtndf7ozentinkoxedkcltni`.

---

## 1. Export the content — do this first, every time

Point-in-time recovery covers you until step 3, but a JSON export costs seconds
and does not require a restore to read.

```bash
PROD_API=chrtndf7ozentinkoxedkcltni
mkdir -p backup
for t in Article ArticleRevision Category UserProfile ArticleSource ArticleTag Tag; do
  aws dynamodb scan --region ap-south-1 \
    --table-name "${t}-${PROD_API}-NONE" --output json \
    > "backup/v2-${t}-$(date +%F).json"
done
```

Check the published article is actually in there before continuing:

```bash
node -p "require('./backup/v2-Article-$(date +%F).json').Items
  .filter(i=>i.status?.S==='PUBLISHED')
  .map(i=>({slug:i.slug.S, len:(i.bodyMarkdown?.S||'').length}))"
```

`backup/` is gitignored. Keep it somewhere durable — it is the only copy.

## 2. Verify the branch will actually build

A failed cutover mid-flight is much worse than a delayed one.

```bash
npm run verify        # verify:lock runs first — a drifted lockfile fails the Amplify build
npx playwright test
```

## 3. Disable deletion protection — THE POINT OF NO RETURN

Until this runs, a merge to `main` fails and rolls back harmlessly. After it,
the next deploy deletes the tables for real.

```bash
PROD_API=chrtndf7ozentinkoxedkcltni
aws dynamodb list-tables --region ap-south-1 --output text --query 'TableNames' \
  | tr '\t' '\n' | grep -- "-${PROD_API}-NONE" \
  | while read -r t; do
      echo "disabling protection: $t"
      aws dynamodb update-table --region ap-south-1 --table-name "$t" \
        --no-deletion-protection-enabled >/dev/null
    done
```

Confirm, and keep the list — it is your record of what was touched:

```bash
aws dynamodb list-tables --region ap-south-1 --output text --query 'TableNames' \
  | tr '\t' '\n' | grep -- "-${PROD_API}-NONE" \
  | while read -r t; do
      printf '%s %s\n' "$t" \
        "$(aws dynamodb describe-table --region ap-south-1 --table-name "$t" \
           --query 'Table.DeletionProtectionEnabled' --output text)"
    done
```

**Recovery position:** the tables still exist and still have point-in-time
recovery. You can re-enable protection and walk away. After step 4 you cannot.

## 4. Merge

```bash
git checkout main && git pull
git merge 3.0.0            # fast-forwards: 3.0.0 already carries main as an ancestor
git push origin main
```

The `-s ours` merge on `3.0.0` is what makes this land the complete MVP. Without
it git treats the MVP commits as already-reverted and brings only a handful of
files. If `git diff --stat` after the merge shows only a few files, **stop and
do not push** — the branch was rebuilt without that merge commit.

Amplify builds automatically. Watch it:

```bash
aws amplify list-jobs --app-id d1z2jyqeifr0gd --branch-name main --region ap-south-1 \
  --max-results 1 --query 'jobSummaries[0].{id:jobId,status:status}'
```

## 5. Recreate the administrator

The old pool is gone, and so is every account in it. The new pool starts empty,
and self sign-up is disabled — so this is not optional.

```bash
POOL=$(aws cloudformation describe-stacks --region ap-south-1 \
  --stack-name "$(aws cloudformation list-stacks --region ap-south-1 \
      --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
      --query "StackSummaries[?starts_with(StackName,'amplify-d1z2jyqeifr0gd-main-branch')]|[0].StackName" \
      --output text)" \
  --query 'Stacks[0].Outputs[?OutputKey==`userPoolId`].OutputValue' --output text)

npm run admin -- --create --email you@example.com \
  --user-pool-id "$POOL" --region ap-south-1 --yes
npm run admin -- --grant  --email you@example.com \
  --user-pool-id "$POOL" --region ap-south-1 --yes
```

Use `--create` here, not `--bootstrap`: this is production, and `--create` is the
path where the password never reaches your terminal.

## 6. Re-import the article

The v2 and MVP schemas differ, so this is a field mapping, not a copy:

| v2                                      | MVP                                                           |
| --------------------------------------- | ------------------------------------------------------------- |
| `title`, `slug`                         | unchanged                                                     |
| `excerpt`                               | `summary`                                                     |
| `bodyMarkdown`                          | `content`                                                     |
| `authorDisplayName`                     | `authorName`                                                  |
| `authorProfileId`                       | `authorSub`                                                   |
| `publishedAt`, `createdAt`, `updatedAt` | unchanged                                                     |
| `status: PUBLISHED`                     | `status` + `statusKey` = `PUBLISHED`, `feedKey` = `PUBLISHED` |
| everything else                         | dropped — no equivalent exists                                |

Two details that will otherwise cost you an hour:

- **`__typename: 'Article'` is required.** A row written by a raw `PutItem`
  without it is invisible to Amplify's GraphQL layer — the admin edit form will
  not find it.
- **`feedKey` must be present for published rows and absent for drafts.** The
  public feed index is sparse; setting it to `null` is not the same as omitting
  it and would put a draft on the feed.

Derive the new table name from the new API id (**not** the GraphQL URL hostname
— they are different values):

```bash
NEW_API=$(aws appsync list-graphql-apis --region ap-south-1 \
  --query "graphqlApis[?name=='amplifyData'].apiId" --output text)
# then PutItem into Article-${NEW_API}-NONE
```

## 7. Verify

```bash
npm run verify:backend              # the public API key must NOT reach the Article model
curl -sL https://www.rajchowk.in/ | grep -o 'article/[a-z0-9-]*'
curl -sL -o /dev/null -w '%{http_code}\n' https://www.rajchowk.in/article/<slug>
```

Then sign in at `/admin/login`, publish a test article, confirm it reaches the
feed, and delete it.

> The feed takes up to 60 seconds to show a new article — the ISR window — and
> CloudFront serves one stale response after that expires, so it can need a
> second refresh. That is expected, not a failed cutover.

## 8. Afterwards

- Re-enable deletion protection on the new `Article` table once you are happy.
- Delete the old S3 media bucket only after confirming nothing links to it.
- Tear down the sandbox stacks that are still billing:
  `amplify-rajchowkmvp-mvp-sandbox-7883fdb38b` (`npm run sandbox:delete`) and
  `amplify-rajchowk-amritsingh-sandbox-3d81aa0f0f`, which needs the v2 code
  checked out to remove cleanly.

---

## If it fails partway

CloudFormation rolls back on failure, but a rollback that cannot restore a
deleted table leaves the stack in `UPDATE_ROLLBACK_FAILED`. If that happens:

1. Do **not** retry the deploy.
2. `aws cloudformation describe-stack-events --stack-name <stack> --max-items 30`
   and find the first failure — everything after it is noise.
3. Restore any lost table from point-in-time recovery **under a new name**, then
   copy rows across. PITR cannot restore over an existing table.
4. Use `continue-update-rollback --resources-to-skip` only once you understand
   which resource is wedged.
