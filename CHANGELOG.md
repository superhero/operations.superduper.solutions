# Changelog

## Staging

<!-- changelog-commit:e2551bfd987b9ce39bc7853e90b2b05994494a71 -->
### Commit [`e2551bf`](https://github.com/superhero/operations.superduper.solutions/commit/e2551bfd987b9ce39bc7853e90b2b05994494a71)

```text
feat(ci): preserve commit messages in staged release changelogs

Capture complete commit messages in CHANGELOG.md before feature, bugfix
and documentation branches are squashed into develop. Keep unreleased
entries under Staging and exclude generated changelog commits on retries.

Fold Staging into the chosen version before release validation. Further
develop integrations update the existing release version while preserving
release-only fixes. Verify pinned revisions and use expected-head pushes
to avoid publishing over concurrent changes.

Keep an explicit Staging boundary so concurrent branch merges cannot
silently classify unreleased entries under a published version.

```

<!-- changelog-staging-end -->
