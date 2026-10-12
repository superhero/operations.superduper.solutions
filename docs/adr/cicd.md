# Continuous integration and deployment follow Gitflow, with a fully passing test suite required for release

Keep ongoing development separate from released code, and publish the same
revision and artifacts that passed validation. Use the
[AVH git-flow model](https://github.com/petervanderdoes/gitflow-avh) with
[Semantic Versioning](https://semver.org/) and automated validation, merging and
release publication. Markdown-only changes use a lighter path because they do
not change the application.

## Branch and release policy

- `main` contains released code; `develop` is the integration branch.
- `feature/*` and `bugfix/*` merge into `develop`.
- `docs/*` branches contain only Markdown documents and may target `develop` or `main` explicitly. Create the branch from its intended target; changes to any other file type use the normal feature or bugfix path.
- Documentation CI validates the full change set using trusted automation, including both sides of renames and file modes. It rejects symlinks, executable files, submodules, and empty changes. It runs no application or automation test suites, builds, releases, deployments, or branch synchronization.
- Documentation PRs fast-forward when they contain one commit and the target is its ancestor; otherwise they squash. The existing exact-head and target-revision checks still apply. Documentation branches targeting `main` must include current `main`, apart from dependency-badge updates.
- Release stabilization uses a `bugfix/*` branch from the active `release/<version>` and a PR back into that release. The target must have valid SemVer and must not already be tagged or merged into `main`.
- `release/<version>` starts from `develop`, merges into `main`, is tagged with the same unprefixed SemVer, then `main` is merged back into `develop`.
- `hotfix/<version>` is patch-only. Production hotfixes start from released `main` and follow the same release and back-merge path. After tagging, the released hotfix revision is also synchronized into an active `release/*` through a PR.
- Synchronizing an already released hotfix must not introduce unreleased code or reuse its version for another production release.
- Feature and bugfix PRs into `develop`, and production hotfix PRs into `main`, fast-forward when they contain one commit and the target is its ancestor; otherwise they squash.
- Release stabilization, publication, and synchronization of released code prefer fast-forward, falling back to a merge commit when histories have diverged. Synchronization preserves ancestry, including when both branches already have identical content.
- The automation App selects the merge method after the applicable CI validation passes. Fast-forward updates use the exact validated head without force; shared branches are never rebased. Main and develop permit both merge and squash for the fallback paths.
- Release PR validation, confirmed merge, tagging, deployment, and synchronization share one workflow run. Publication uses that run's validated artifacts and the actual merged commit; retries preserve those identities.
- Successful code integration into `develop` and `release/*` publishes a Cloudflare Pages branch preview in the same CI run. Documentation PRs do not publish previews. Release and production hotfix PRs also preview their tested head before merging into `main`; this does not add a manual approval gate.
- Previews and production deploy the tested bundle without rebuilding it during publication. Bundles with identical `index.html` and `_headers` files reuse the active deployment on the same branch. Publishing the bundle to a different branch still creates a Pages deployment, while Wrangler reuses already uploaded assets. Superseded previews are skipped; superseded production releases cannot publish.
- Release preparation incorporates current `main` into a branch created from `develop` when needed. A release requires actual changes beyond dependency badges.
- One release and one hotfix may be active at a time.
- Release and hotfix versions must be distinct. Automatic releases currently reserve the next patch; if an urgent hotfix needs that version, renumber the pending release before proceeding.
- Protected branches require PRs and reject force pushes. The automation App may bypass the PR requirement for dependency badges, validated fast-forward integration, and release preparation; release branch deletion remains available after merging.

## Contributor guidance

See [Repository automation](../../.github/workflows/README.md) for local checks,
test reports, badges, CI workflows, releases and deployment.

For Markdown-only changes, use a `docs/<topic>` branch from the intended target,
`develop` or `main`. See the [documentation workflow](../../.github/workflows/README.md#documentation-only-changes)
for validation and merging. Choose each target explicitly; documentation changes
are not synchronized between branches automatically.
