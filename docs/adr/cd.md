# Continuous deployment

> [!IMPORTANT]
> Continuous deployment promotes tested artifacts to previews and production, keeping publication traceable to the validated revision.

## Preview and production

Cloudflare Pages provides branch previews after code integrates into `develop`
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
