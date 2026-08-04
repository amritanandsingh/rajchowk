# Operations runbook

## Routine checks

- Confirm the Amplify backend and frontend phases both completed and that the deployed commit matches the intended release.
- Check CloudWatch alarms for Lambda errors/throttles, AppSync 5xx responses and DynamoDB throttling.
- Review the moderation queues, failed newsletter delivery logs and audit records.
- Run the counter reconciliation function after a suspected partial failure or manual data repair.
- Verify `/robots.txt`, `/sitemap.xml`, `/news-sitemap.xml` and `/feed.xml` after domain or URL changes.

## Incident response

For a frontend regression, redeploy the last known-good commit in Amplify. For a backend regression, first stop the affected UI entry point or revoke the relevant staff group (`npm run role:grant -- --email USER_EMAIL --role EDITOR --revoke`), then deploy a forward fix; do not delete protected production tables. Use DynamoDB point-in-time recovery for data corruption and preserve AuditLog records for investigation.

If a signing secret may be exposed, rotate it in Amplify secrets and redeploy. Rotating `NEWSLETTER_TOKEN_SECRET` invalidates outstanding verification/unsubscribe links; rotating `RATE_LIMIT_IP_SALT` starts new anonymous rate-limit buckets. If an administrator account is compromised, disable the Cognito user, revoke sessions, remove group membership (`npm run role:grant -- --email USER_EMAIL --role ADMIN --revoke`, which refuses if it would empty the `ADMIN` group), rotate operator credentials and review audit events. A revocation only takes effect once the account's current ID token expires, so revoke the sessions too.

## Post-deploy smoke test

Check the home, latest, opinion, poll, question, promise, live, search, authentication and admin routes at mobile and desktop widths. Confirm no browser console errors, no horizontal overflow, correct empty states, accessible keyboard focus, API success/failure messaging, canonical metadata and a 404 response for an unknown route.
