# Continuous deployment

> [!IMPORTANT]
> Continuous deployment publishes tested artifacts to Cloudflare, preserving traceability to validated revisions.

## Hosting

Cloudflare Pages hosts the static application in production and branch previews.
R2 stores test and coverage reports.

## Artifact promotion

GitHub Actions publishes the application bundle and reports from complete
successful validation, without rebuilding. A later workflow may reuse those
artifacts only when all tracked inputs match except the managed root changelog,
and the original successful run, complete reports and artifact hashes verify.
Missing or expired evidence requires fresh validation. Reused reports retain
their original tested commit and run provenance.

Production requires a verified release or hotfix merge into `main`, without a
separate manual deployment gate. For a release, its changelog versioning docs PR
merges into the release branch first, so the release tag includes the changelog.

## Deployment triggers

Integrations into `develop` and `release/*` receive previews. Release and hotfix
PRs targeting `main` preview before merging. Documentation PRs do not deploy;
direct pushes do not trigger production.

## Reliability

Production publication is serialized, superseded revisions are rejected, and
matching deployments are reused on retries.
