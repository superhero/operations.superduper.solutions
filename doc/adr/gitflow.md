# Gitflow

We follow [git-flow (AVH Edition)](https://github.com/petervanderdoes/gitflow-avh) with [Semantic Versioning](https://semver.org/).

- `main` contains released code; `develop` is the integration branch.
- `feature/*` and `bugfix/*` merge into `develop`.
- `release/<version>` starts from `develop`, merges into `main`, is tagged with the same unprefixed SemVer, then `main` is merged back into `develop`.
- `hotfix/<version>` is patch-only. Production hotfixes start from released `main` and follow the same release and back-merge path. After tagging, the released hotfix revision is also synchronized into an active `release/*` through a PR.
- Hotfixes may target a selected `support/*` line; its latest reachable release determines the next patch version. Production fixes are not automatically merged into every maintenance line.
- Synchronizing an already released hotfix must not introduce unreleased code or reuse its version for another production release.
- `support/*` provides long-lived maintenance lines.
- Release and hotfix completion uses merge commits. One release and one hotfix may be active at a time.
- Release and hotfix versions must be distinct. Automatic releases currently reserve the next patch; if an urgent hotfix needs that version, renumber the pending release before proceeding.
- Release branches require PRs and reject force pushes. The automation App may bypass the PR requirement for dependency badges; normal branch deletion remains available after merging.
