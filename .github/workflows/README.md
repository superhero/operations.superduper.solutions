# Repository automation

Commands, workflows and recovery procedures for GitHub Actions.
The decisions behind them are recorded in
[Continuous integration](../../docs/adr/continuous-integration.md),
[Continuous deployment](../../docs/adr/continuous-deployment.md) and
[Test suite reports](../../docs/adr/test-suite-reports.md).
See [Contributing](../../CONTRIBUTING.md) for wider project guidance.

Keep event triggers, permissions, job dependencies and artifact wiring in this
directory's workflow YAML. Reusable executable behavior belongs in
[`../scripts/`](../scripts/README.md), its Cucumber coverage in
[`../tests/`](../tests/README.md), and repository-administration payloads in
[`../policies/`](../policies/README.md). See the
[automation directory map](../DIRECTORY.md) for generated outputs and other files.

- [Local validation](#local-validation)
- [Test reports](#test-reports), [coverage reports](#coverage-reports) and [badges](#badges)
- [Documentation-only changes](#documentation-only-changes)
- [Branch workflows](#branch-workflows) and [merge rules](#validation-and-merging)
- [Release preparation](#release-preparation), [checks](#release-checks-and-diagnostics) and [stabilization](#release-stabilization-and-versions)
- [Publication and synchronization](#publication-and-synchronization), including [retries](#retrying-publication)
- [GitHub App permissions](#github-app-permissions)
- [Scheduled dependency checks](#scheduled-dependency-checks)
- [Reading workflow runs](#reading-workflow-runs)

## Local validation

### Prerequisites

- Run commands from the repository root after `npm ci`.
- Automation tests require Bash, Git and jq; shell validation also needs ShellCheck.
- Acceptance and browser tests require `npm run build` first.
- Browser tests require running Docker and use the pinned Playwright image.

Browser tests exercise the built bundle with container networking disabled.
Automation tests run real shell scripts in temporary directories with simulated
GitHub and Cloudflare responses. They neither release nor deploy; unexpected
external requests fail the scenario.

### Automation changes

```sh
npm run test:automation
npm run badges:dependencies -- --check
shellcheck .github/scripts/*.sh
```

The [npm command reference](../../README.md#npm-commands) covers individual commands.

## Test reports

### Run all four suites

| Suite | Command | JSON output under `tmp/test/` |
| --- | --- | --- |
| Source | `npm run test:source` | `cucumber-source.json` |
| Acceptance | `npm run test:acceptance` | `cucumber-test.json` |
| Automation | `npm run test:automation` | `cucumber-automation.json` |
| Browser | `npm run test:browser` | `cucumber-browser.json` |

Use `test:source:coverage` instead of `test:source` when collecting coverage.
The [testing ADR](../../docs/adr/test-suite-reports.md) defines Cucumber reporting
and records the remaining standalone Node and browser smoke-test gap.

### Generate the combined report

After a fresh, complete run of all four suites:

```sh
npm run report:tests
```

`multiple-cucumber-html-reporter` produces `tmp/test-report.html`. The standalone
file contains the overview, feature/scenario details and all required assets
for offline viewing.

Missing or invalid inputs fail normal generation. Generation does not establish
that tests were discovered or results are current; filtered or stale results
must not represent complete validation.

### Results after failure

- Release CI retains available raw results as `application-test-report` and
  `automation-test-report`.
- A partial diagnostic HTML report may be generated after failure. It names
  missing suites and explicitly warns that validation failed.
- Detailed test output remains in job logs; coverage is reported separately.

## Coverage reports

Collect fresh source coverage, enforce its thresholds and package the report:

```sh
npm run test:source:coverage
npm run test:coverage
npm run report:coverage
```

Outputs are `tmp/test/coverage/` and standalone `tmp/test-coverage.html`.
The [coverage decision](../../docs/adr/test-suite-reports.md#coverage) defines
100% statement, branch, function and line coverage within the configured scope.

## Badges

### Scenario badges

After all four suites, run `npm run badges:scenarios`. Commit the updated
`.github/badges/test-scenarios.json` and SVG with the test changes.

- Counts include every reported scenario-outline example, not individual steps.
- Passing requires successful steps and hooks; failed or skipped cases cannot
  represent an all-passing suite.
- Release CI checks the files with `npm run badges:scenarios -- --check`.

### Dependency badges

Run `npm run badges:dependencies` after manifest changes and commit the generated
SVGs under `.github/badges/` with `package.json`. CI checks their agreement.
Relative README links show the versions for the viewed branch or tag.

| Color | Last successful registry check |
| --- | --- |
| Blue | Declared version matches npm's `latest` |
| Orange | Declared version differs from `latest` |

Ordinary generation preserves the last status while the declared version stays
unchanged. A version change resets its badge to blue until checked. Registry
failures leave badges unchanged.

### Coverage badges

After the fresh coverage run, use `npm run badges:coverage`. Commit
`.github/badges/test-coverage.json` and its SVG with the code changes.

The badge shows statement coverage; the full report includes all four measures.
Release CI checks against its own measurements with
`npm run badges:coverage -- --check`; it does not create coverage-badge commits.

## Documentation-only changes

Branch policy is described in the
[documentation integration decision](../../docs/adr/continuous-integration.md#updating-documentation).

### Branch and file scope

- Create `docs/<topic>` from the intended target, `develop` or `main`, and open
  a PR to that same branch.
- Only regular, non-executable Markdown files (`.md`, case-insensitive) qualify.
  Additions, edits, renames and deletions are supported.
- Images, badges, scripts and configuration use the feature or bugfix path,
  even when their purpose is documentation.

### Validation and trust

[`ci-docs.yml`](ci-docs.yml) checks the full Git diff from merge base to pinned PR
head, including both sides of renames. It rejects symlinks, executables,
submodules, empty changes and unverifiable history, without relying on GitHub's
capped changed-files list.

The `pull_request_target` workflow executes trusted default-branch automation.
PR content is fetched as Git objects, never checked out or executed.

- No packages are installed. Tests, builds, releases, tags, deployments, reports
  and synchronization jobs do not run.
- Normal `main` and `develop` CI skip `docs/*` PRs.
- Mixed changes fail documentation validation; they do not fall through to
  application CI.

### Merging and retry

Only same-repository, non-draft PRs auto-merge after validation. The App verifies
the tested head and target revision. One commit fast-forwards when the target is
its ancestor; other documentation PRs squash.

For a `main` target:

- Include current `main`, except permitted dependency-badge advances.
- A pre-merge check blocks merging while a production release workflow is active.
  Retry after it finishes to avoid interrupting tagging or deployment.
- Merging does not open a synchronization PR to `develop`. Choose each
  destination explicitly.

### Local check

Fetch the intended target, then run:

```sh
bash .github/scripts/validate-documentation-changes.sh \
  "$(git rev-parse origin/develop)" "$(git rev-parse HEAD)"
```

Substitute `origin/main` for a `main` target.

### Enabling the documentation workflow

The workflow's own YAML and scripts require normal CI and release promotion.
Before the fast path is available:

1. Put the workflow and helpers on the default branch, `main`.
2. Include normal-CI exclusions on both target branches.
3. Allow `pull_request_target` specifically for `.github/workflows/ci-docs.yml`
   through the repository's Actions event policy.

An administrator can create the scoped
[policy](../policies/documentation-events.json) from the repository root:

```sh
gh api --method POST \
  repos/superhero/operations.superduper.solutions/actions/policies \
  -H 'X-GitHub-Api-Version: 2026-03-10' \
  --input .github/policies/documentation-events.json
```

Update the existing policy instead if already configured. See GitHub's
[event-policy guidance](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
and [Actions policy API](https://docs.github.com/en/rest/actions/policies#create-a-repository-actions-policy).

## Branch workflows

### Choose the target

| Working branch | Create from | PR target |
| --- | --- | --- |
| `feature/*` or integration `bugfix/*` | `develop` | `develop` |
| Stabilization `bugfix/*` | Active `release/<version>` | That release |
| `release/<version>` | `develop` | `main` |
| Production `hotfix/<version>` | Released `main` | `main` |

Production hotfixes use the next patch version of released `main`.

A `develop` PR targeting `main` triggers creation of a separate versioned release
PR, or updates the release already open. That release head is reviewed and tested
before integration.

### Workflow routing

| PR target | Workflow |
| --- | --- |
| `develop` | [`ci-develop.yml`](ci-develop.yml) |
| `release/**` | [`ci-release.yml`](ci-release.yml) |
| `support/**` | [`ci-support.yml`](ci-support.yml) |
| `main` | [`ci-main.yml`](ci-main.yml): validation, merge and publication |

The target selects the workflow, including for hotfix PRs to a release or support
line. Each workflow owns its triggers, permissions, jobs and artifacts. Shared
policy and publishing helpers live in `.github/scripts`; branch CI does not call
a shared workflow. Each application job installs once; only npm downloads are
cached.

## Validation and merging

### Required checks

Code auto-merges require automation tests, Gitflow policy and application checks.
Documentation uses its separate path.

Merges are serialized per target and bind the tested head and base revision.
The head must match exactly. Target advances containing only dependency-version
SVG changes are accepted; other advances require fresh validation.

### Merge methods

| Integration | Method |
| --- | --- |
| Feature/bugfix → `develop`; hotfix → `main` | Fast-forward for exactly one commit ahead with an ancestor target; otherwise squash |
| Release stabilization, release → `main`, released-code synchronization | Fast-forward where possible; otherwise merge commit |
| Documentation | See [documentation merge rules](#merging-and-retry) |

Both `develop` and `main` permit merge and squash. GitHub has no fast-forward PR
method, so the App updates the target ref without force after rechecking the PR
and tested revision. Shared branches are never rebased.

### Merge confirmation

- Every method waits up to three minutes for GitHub to confirm the exact PR and
  merge commit, including delayed fast-forward recognition or an existing queue.
- A blocked merge reports GitHub's reason; automation does not enable queued
  auto-merge as a fallback.
- Retries accept an already merged PR only when repository, source, tested head
  and target still match. Force-push protection applies to the App.

### Commit messages and changelog

The root [`CHANGELOG.md`](../../CHANGELOG.md) preserves complete commit messages
before feature, integration bugfix and documentation PRs are squashed into
`develop`. Each entry records its original commit; **Staging** stays at the top.

- Preparation adds a changelog commit to the PR branch. Its new revision runs
  through CI before merging; automation does not alter the tested tree afterward.
- Generated changelog commits are omitted. Retries deduplicate original commit
  identities, including entries already assigned to a release.
- Existing squashed history is not reconstructed. Write useful commit subjects
  and bodies; their text is retained as written.
- Concurrent PRs may need the usual update from `develop`. Resolve changelog
  entries with the shared merge helper, preserving every commit identity, then
  rerun validation. Conflicts in application files require a normal resolution.

The documentation preparation step uses trusted automation from `main`, so that
part becomes active after the helpers and workflow are promoted there.

## Release preparation

### Automatic preparation

1. Preview integration of pinned `develop` and `main` revisions.
2. Reject conflicts and changes limited to dependency badges.
3. Create the release branch from pinned `develop` and incorporate pinned `main`.
4. Move **Staging** entries into the selected version in `CHANGELOG.md`.
5. Validate and build that prepared release head through normal CI.

### Updating an open release

Use the same `develop` → `main` trigger again. Automation updates the open
release rather than allocating another version, retaining release-only fixes.
New Staging entries join its existing version section; earlier versions remain
unchanged. An empty Staging section remains available for subsequent work.

Retries verify the source, target and prepared content before writing. Conflicting
application changes and a branch that advances during preparation stop the update.

### Conflict recovery

Create the release branch from `develop`, merge `main` locally, resolve conflicts
and open its PR into `main`. Changelog entries have a deterministic merge; automation
does not choose conflicting application content for you.

## Release checks and diagnostics

### Required evidence

Release CI builds the exact head, requires full scoped coverage and runs all
four suites against that revision. Automation results come from the same workflow
run. The release head must include current `main`, except verified dependency
SVG updates; ancestry is checked again before merge.

Artifacts uploaded before auto-merge:

| Artifact | Contents |
| --- | --- |
| `bundle` | Tested application |
| `coverage` | Source coverage reports |
| `test-report` | Combined HTML test report |

Failed acceptance results remain downloadable. Coverage reports are retained
even when thresholds fail; full tool output remains in job logs.

### Actionable errors

Following the [error-reporting decision](../../docs/adr/error-view.md), guards
identify rejected inputs or missing outputs while preserving native diagnostics:

- Include relevant PRs, branches, commits, files or destinations and expected
  versus actual values for mismatches.
- Keep npm failures visible and API reasons alongside the attempted operation.
  R2 failures include structured Cloudflare error details.
- Never dump argument lists, environments, authentication headers or raw API
  responses. Identify missing credentials by variable name only.

## Release stabilization and versions

### Active versions

- At most one release and one hotfix may be active.
- Automatic release creation chooses the next patch version.
- Versions must be unique across releases and hotfixes, including merged versions
  whose tags are still pending. API errors fail version validation.
- If a planned release reserves the patch needed by an urgent hotfix, give the
  planned release a different version first.

### Stabilization fixes

Create `bugfix/*` from the active `release/<version>` and open a PR back to it.
Release CI merges validated fixes; the existing PR into `main` then validates
the updated head. Release-trigger retries reuse that PR, including after fixes.

Invalid versions and release targets already tagged or merged into `main` are
rejected. Direct pushes do not replace stabilization checks.

### Released hotfixes

A released hotfix may synchronize into `develop`, an active release or an
explicitly selected support line. Its source must stay within the released
revision apart from dependency badges. Released release targets are rejected;
support targets retain the next-patch check. Synchronization does not rename
releases or change version policy.

## Publication and synchronization

The [deployment ADR](../../docs/adr/continuous-deployment.md) explains artifact
promotion to Cloudflare Pages and report storage in R2.

### Run lifecycle

A release or hotfix PR into `main` uses one `ci-main.yml` run for validation,
build, confirmed merge, tree verification, tagging, deployment and synchronization.
There is no push-triggered release run.

Runs are serialized per PR and are not cancelled by newer events: earlier runs
may already be deploying. Merge and production jobs have their own serialization.

### Previews and bundle reuse

- Successful integrations into `develop` or `release/*` publish Pages previews
  in the same run.
- Release and production-hotfix PRs preview their tested head before merging,
  without a manual approval gate.
- Superseded previews are skipped; documentation PRs do not deploy previews.

Preview and production use the tested bundle without rebuilding. Matching
`index.html` and `_headers` reuse the active deployment on the same branch.
Another branch gets a separate deployment; Wrangler can reuse uploaded assets.

### Production identity

Before tagging, Git compares the tested and released trees, allowing only
dependency-version SVG differences. This verifies squash merges without requiring
the tested head to be an ancestor of the released commit.

- Every production step uses the confirmed merge SHA, never the synthetic PR
  merge commit.
- Current PR checks reject unmerged, retargeted, forked or advanced PRs as release
  identity sources.
- Tags use the branch's unprefixed Semantic Version: `release/1.2.3` → `1.2.3`.
- Bundle and reports come from successful jobs in the same run; publication need
  not wait for the entire workflow to finish.

Deployment and report publication share a serialized job and reject superseded
releases. Dependency-badge-only advances do not supersede a release; intentional
rollback is a separate operation.

### Report destinations

Production promotion uploads `test-coverage.html` and `test-report.html` to R2
from validated artifacts. Dependency checks and badge files do not publish to R2.

### Synchronization into develop

Automation opens a PR from `main` into `develop` when needed. It preserves missing
release ancestry even when content already matches, skipping only if `develop`
already contains `main`. Fast-forward synchronization aligns both branch heads
when possible.

If development continues after a release is cut, overlapping changelog edits
may need resolution. The Staging boundary prevents Git from silently assigning
new work to the old version. Combine the two changelogs by commit identity,
keeping unreleased entries in Staging.

### Hotfix synchronization into a release

After a production hotfix, automation also opens a PR into the active release,
if one exists. It uses tagged `main` so final release validation includes the
production history:

- Restore a deleted hotfix branch at the released revision.
- Merge that revision into a surviving branch containing only the tested hotfix
  and later dependency badges, preserving its commits after a squash release.
- Require the resulting branch to contain the released revision and differ only
  in dependency badges. Unexpected code stops synchronization without discarding it.
- Reuse an open PR on retry, or skip a release already containing the fix.

`ci-release.yml` validates and merges the PR. Support destinations remain explicit;
they do not receive every production hotfix automatically.

## Retrying publication

### Failed promotion

Retry failed jobs in the original release PR run. A full rerun is also supported:
it recognizes the matching merged PR, rebuilds the pinned head and verifies the
released tree again. Matching tags are reused; the PR is never merged twice.

### Manual merges and prerequisites

After a manual release merge, rerun the original PR workflow to publish it;
a direct push does not deploy. The release must remain current, and its source
commit and required artifacts must still be available.

## GitHub App permissions

### Credentials and job permissions

The App uses `GH_APP_CLIENT_ID` and `GH_APP_PRIVATE_KEY`, following the
[runtime-secrets decision](../../docs/adr/runtime-secrets.md).
It owns PRs, merges, tags, dependency-badge commits and deployment records.

- Installation permissions: Contents, Pull requests and Deployments, read/write.
- Each job requests only the permissions it uses.
- The built-in GitHub token handles read-only APIs and normal Actions
  infrastructure, including artifacts and caches.

### Protected-branch bypass

The App needs a pull-request-rule bypass for `main`, `develop`, `release/*` and
`support/*`. This permits dependency-badge updates, validated fast-forwards and
release preparation; helpers verify expected branch revisions before writing.

GitHub cannot restrict the bypass to badge paths. The badge publisher therefore
limits commits to dependency-version SVGs at the exact checked branch head.

### Protections retained

Force-push rules remain separate, without an App bypass. Permanent `main`,
`develop` and support branches reject deletion; temporary release branches may
be deleted after merging.

## Scheduled dependency checks

### Schedule and scope

[`cron-outdated.yml`](cron-outdated.yml) runs daily at **06:00 UTC** or manually.
It has no PR or push triggers; branch CI has no scheduled/manual dependency refresh.

Each run discovers branches and pins their current commits. It excludes `docs/*`
so generated SVGs cannot enter Markdown-only changes.

### Checks and results

- Install each branch's dependencies with lifecycle scripts disabled.
- Run `update-dependency-status.sh` from the workflow revision.
- Report `npm outdated --json` results—current, wanted and latest—in logs and
  the summary. The same results refresh [badge colors](#dependency-badges).
- A failure on one branch does not cancel the others.

### Safe publication

The App commits only changed dependency SVGs; unchanged results create no commit.
Branches moved or deleted since discovery are skipped. A concurrent change during
publication rejects the commit without overwriting it.

Badge-only pushes do not deploy releases, but changes to an open PR's source
branch still run its normal CI checks.

## Reading workflow runs

GitHub labels PR runs with the **source** branch; the **target** selects CI.
A `main` → `develop` synchronization PR therefore displays `main` while running
`ci-develop`.
