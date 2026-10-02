# Gitflow

We follow [git-flow (AVH Edition)](https://github.com/petervanderdoes/gitflow-avh) with [Semantic Versioning](https://semver.org/).

- `main` contains released code; `develop` is the integration branch.
- `feature/*` and `bugfix/*` merge into `develop`.
- `release/<version>` merges into `main`, is tagged with the same unprefixed SemVer, then `main` is merged back into `develop`.
- `hotfix/<version>` is patch-only and follows the same release and back-merge path; it may also target an active `release/*` or `support/*` line.
- `support/*` provides long-lived maintenance lines.
- Release and hotfix completion uses merge commits. One release and one hotfix may be active at a time.
