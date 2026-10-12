# Continuous deployment

> [!IMPORTANT]
> Continuous deployment publishes tested artifacts to Cloudflare, preserving traceability to validated revisions.

## Hosting

Cloudflare Pages hosts the static application in production and branch previews.
R2 stores test and coverage reports.

## Artifact promotion

GitHub Actions publishes the application bundle and reports from the same
successful validation run, without rebuilding. Production requires a verified
release or hotfix merge into `main`, without a separate manual deployment gate.

## Deployment triggers

Integrations into `develop` and `release/*` receive previews. Release and hotfix
PRs targeting `main` preview before merging. Documentation PRs do not deploy;
direct pushes do not trigger production.

## Reliability

Production publication is serialized, superseded revisions are rejected, and
matching deployments are reused on retries.
