# Deployment

## Amplify branch configuration

1. Connect the repository and select `amplify.yml` as the build specification.
2. Use a production branch named `main` or `production`; these names activate Cognito, DynamoDB and AppSync production hardening in `amplify/backend.ts`.
3. Configure `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SITE_NAME`, `NEXT_PUBLIC_DEFAULT_LOCALE`, `NEXT_PUBLIC_AWS_REGION` and `NEXT_PUBLIC_ENV` from `.env.example`.
4. Add strong, independent values for `RATE_LIMIT_IP_SALT` and `NEWSLETTER_TOKEN_SECRET` through Amplify secret management.
5. Configure the SES sender/reply-to values and verify the sender identity in the same AWS Region. Request SES production access before sending to unverified recipients.
6. Attach the custom domain, verify HTTPS, and redeploy once with the final `NEXT_PUBLIC_SITE_URL` so canonical links, Open Graph data, feeds and sitemaps use the public origin.

The build must pass the committed backend deploy, formatting, linting, application and Amplify type checks, unit/component tests, and production build. Do not change the artifact directory from `.next`.

## First administrator

Roles are Cognito groups, not a stored field, and no in-app path can grant `ADMIN` — see the comment in `amplify/auth/resource.ts`. Create and confirm the account through the public sign-up flow, then grant the group with an operator credential:

```bash
npm run role:grant -- --email USER_EMAIL --role ADMIN
```

The script targets the pool in `amplify_outputs.json`. For a pool that file does not describe — production, from a machine holding only credentials — name it and confirm:

```bash
npm run role:grant -- --email USER_EMAIL --role ADMIN \
  --user-pool-id USER_POOL_ID --region ap-south-1 --yes
```

It prints the pool, the account status and the resulting groups, is safe to re-run, and refuses to remove the last `ADMIN`. Pass `--list` to read memberships without writing. Without a repository checkout the underlying call is:

```bash
aws cognito-idp admin-add-user-to-group \
  --user-pool-id USER_POOL_ID \
  --username USER_EMAIL \
  --group-name ADMIN \
  --region ap-south-1
```

Use `EDITOR` instead for editorial staff who should not receive administrator access. Sign out and back in after a group change so Cognito issues a token with the updated groups claim.

## Release acceptance

Before promoting a branch, run `npm run verify:full` against a deployed non-production sandbox. In the deployed preview, verify sign-up email delivery, sign-in, an editor publish/unpublish cycle, moderation, one poll vote, one question/upvote, newsletter verification/unsubscribe, search, media rendering, RSS, both sitemaps and the branded 404 page.
