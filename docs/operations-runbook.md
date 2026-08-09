# Operations runbook

## Routine checks

- Confirm the Amplify backend and frontend phases both completed and that the deployed commit matches the intended release.
- Check CloudWatch alarms for Lambda errors/throttles, AppSync 5xx responses and DynamoDB throttling.
- Review the moderation queues, failed newsletter delivery logs and audit records.
- Run the counter reconciliation function after a suspected partial failure or manual data repair.
- Verify `/robots.txt`, `/sitemap.xml`, `/news-sitemap.xml` and `/feed.xml` after domain or URL changes.

## Categories

An article cannot be saved without a category — `Article.categoryId` is required, and the publish function derives the category feed key from it. A newly deployed environment has none, so the first editor creates one from the article form itself (`+ नई श्रेणी`), which needs `EDITOR` or `ADMIN`.

A category slug is a permanent public URL (`/category/<slug>`), so it is typed in ASCII rather than transliterated from the Hindi name. There is no UI for renaming, reordering or deactivating a category yet: use the AppSync console, and remember that changing a slug breaks inbound links to the old one. Slug uniqueness is checked before creation but is not enforced by the table, so two editors adding the same topic within a few seconds can both succeed — check for a duplicate before assuming a category is missing.

Categories only enter `/sitemap.xml` once they have at least one published article, so a category created for a draft is deliberately absent until that article goes live.

## Incident response

For a frontend regression, redeploy the last known-good commit in Amplify. For a backend regression, first stop the affected UI entry point or revoke the relevant staff group (`npm run role:grant -- --email USER_EMAIL --role EDITOR --revoke`), then deploy a forward fix; do not delete protected production tables. Use DynamoDB point-in-time recovery for data corruption and preserve AuditLog records for investigation.

If a signing secret may be exposed, rotate it in Amplify secrets and redeploy. Rotating `NEWSLETTER_TOKEN_SECRET` invalidates outstanding verification/unsubscribe links; rotating `RATE_LIMIT_IP_SALT` starts new anonymous rate-limit buckets. If an administrator account is compromised, disable the Cognito user, revoke sessions, remove group membership (`npm run role:grant -- --email USER_EMAIL --role ADMIN --revoke`, which refuses if it would empty the `ADMIN` group), rotate operator credentials and review audit events. A revocation only takes effect once the account's current ID token expires, so revoke the sessions too.

## Post-deploy smoke test

Check the home, latest, opinion, poll, question, promise, live, search, authentication and admin routes at mobile and desktop widths. Confirm no browser console errors, no horizontal overflow, correct empty states, accessible keyboard focus, API success/failure messaging, canonical metadata and a 404 response for an unknown route.
