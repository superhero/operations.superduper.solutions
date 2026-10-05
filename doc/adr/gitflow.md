# Gitflow

We follow [git-flow (AVH Edition)](https://github.com/petervanderdoes/gitflow-avh) with [Semantic Versioning](https://semver.org/).

- `main` contains released code; `develop` is the integration branch.
- `feature/*` and `bugfix/*` merge into `develop`.
- `release/<version>` starts from `develop`, merges into `main`, is tagged with the same unprefixed SemVer, then `main` is merged back into `develop`.
- `hotfix/<version>` is patch-only. Production hotfixes start from released `main` and follow the same release and back-merge path. After tagging, the released hotfix revision is also synchronized into an active `release/*` through a PR.
- Hotfixes may target a selected `support/*` line; its latest reachable release determines the next patch version. Production fixes are not automatically merged into every maintenance line.
- Synchronizing an already released hotfix must not introduce unreleased code or reuse its version for another production release.
- `support/*` provides long-lived maintenance lines.
- Feature and bugfix PRs into `develop`, and production hotfix PRs into `main`, fast-forward when they contain one commit and the target is its ancestor; otherwise they squash.
- Release publication and synchronization of released code prefer fast-forward, falling back to a merge commit when histories have diverged. Synchronization preserves ancestry, including when both branches already have identical content.
- The automation App selects the merge method after CI passes. Fast-forward updates use the exact tested head without force; shared branches are never rebased. Main and develop permit both merge and squash for the fallback paths.
- Release PR validation, confirmed merge, tagging, deployment, and synchronization share one workflow run. Publication uses that run's validated artifacts and the actual merged commit; retries preserve those identities.
- Release preparation incorporates current `main` into a branch created from `develop` when needed. A release requires actual changes beyond dependency badges.
- One release and one hotfix may be active at a time.
- Release and hotfix versions must be distinct. Automatic releases currently reserve the next patch; if an urgent hotfix needs that version, renumber the pending release before proceeding.
- Protected branches require PRs and reject force pushes. The automation App may bypass the PR requirement for dependency badges, validated fast-forward integration, and release preparation; release branch deletion remains available after merging.
