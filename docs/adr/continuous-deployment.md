# Continuous deployment

> [!IMPORTANT]
> Continuous deployment promotes tested artifacts to previews and production on Cloudflare, keeping publication traceable to the validated revision.

## Cloudflare hosting

Cloudflare Pages hosts the static application, with `main` serving production
and separate branch deployments providing previews. Cloudflare R2 stores the
published test and coverage reports separately from the application bundle.

GitHub Actions uploads the tested application to Pages through Wrangler and
publishes its validation reports to R2. This fits the application's static
build; saved application data remains in the browser.

## Preview and production

Branch previews are published after code integrates into `develop`
or `release/*`. Release and hotfix PRs targeting `main` preview their tested
head before merging. Production follows the confirmed merge after all required
checks pass, without a separate manual deployment gate.

Documentation PRs do not deploy. Direct pushes do not start production
publication.

## Artifact promotion

Preview and production reuse the tested application bundle without rebuilding
it. Production identifies the confirmed merge commit and verifies its tree
against the tested revision, allowing only dependency badge differences. The
bundle and published test reports come from the same validation run.

Production publication is serialized and rejects superseded releases, preventing
an older run from replacing newer application content. Previews likewise skip
superseded revisions. An identical bundle reuses the active deployment on its
destination branch; failed publication can be retried while that release remains
current. These boundaries preserve reproducibility without redundant deployment.
