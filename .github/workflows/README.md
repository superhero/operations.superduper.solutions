# Repository automation

Commands, workflows and recovery procedures for GitHub Actions.
The decisions behind them are recorded in
[Continuous integration](../../docs/adr/continuous-integration.md),
[Continuous deployment](../../docs/adr/continuous-deployment.md) and
[Test suite reports](../../docs/adr/test-suite-reports.md).
See [Contributing](../../CONTRIBUTING.md) for wider project guidance.

Keep event triggers, permissions, job dependencies and artifact wiring in this
directory's workflow YAML. Reusable executable behavior belongs in
[`../scripts/`](../scripts/README.md), its Gherkin coverage in
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
- Automation tests require Bash, Git 2.45+ and jq; shell validation also needs ShellCheck.
- Acceptance and browser tests require `npm run build` first.
- Browser tests require running Docker and use the pinned Playwright image.

Browser tests exercise the built bundle with container networking disabled.
Automation tests run real shell scripts in temporary directories with simulated
GitHub and Cloudflare responses. They neither release nor deploy; unexpected
external requests fail the scenario.

### Automation changes

Run the Gherkin tags covering the affected automation. Full regression runs
belong to CI unless explicitly requested.

```sh
npm run test:automation -- --tags '@integration-queue or @validation-workflows'
npm run badges:dependencies -- --check
shellcheck .github/scripts/*.sh
```

The [npm command reference](../../README.md#npm-commands) covers individual commands.

### Integration queue

All integration workflows and scheduled dependency updates share the
`integration-ci` concurrency group, with `queue: max` and cancellation disabled.
One workflow runs at a time, including its merge and publication jobs. GitHub
allows up to 100 pending runs in this queue; additional runs are cancelled.

`prepare-integration.yml` resolves the live PR and target when the queue slot
starts. Closed PRs, superseded source revisions, drafts and title/description
edits stop before validation. Retargeting still triggers preparation. An explicit
release-workflow retry can recover publication after its exact PR was merged;
the existing release identity and tree checks still apply.

- Repository-owned feature/bugfix candidates behind `develop` or a release
  receive the latest target through an expected-head update. The current run ends; the App's
  resulting `synchronize` event owns validation of the new source revision.
- Other routes preserve their source. Development/release synchronization tests
  a proposed merge whose parents match the current target and event source;
  main releases retain their existing source-snapshot validation. If the queued
  merge changes the executing workflow definition, preparation requires a fresh
  event before validation can produce reusable evidence.
- Documentation keeps trusted default-branch code and validates pinned Git
  objects against the live target. It never executes proposed documentation.
- Merge conflicts stop with an actionable failure. The final merge guard still
  rejects unexpected changes made outside the queue.

The queue covers the full caller workflow. The reusable preparation must never
acquire the same concurrency group or wait for its queued successor. A failed
candidate releases the slot so later PRs can proceed.

## Test reports

### Suites and outputs

Every authored case uses Gherkin and runs through QuickPickle and Vitest.
[`profiles.mjs`](../../tests/gherkin/profiles.mjs) declares discovery; the
[testing ADR](../../docs/adr/test-suite-reports.md) defines the reporting standard.

| Suite | Command | JSON output under `tmp/test/` |
| --- | --- | --- |
| Source | `npm run test:source` | `vitest-source.json` |
| Acceptance | `npm run test:acceptance` | `vitest-acceptance.json` |
| Automation | `npm run test:automation` | `vitest-automation.json` |
| Application browser | `npm run test:browser` | `vitest-browser-chromium.json` |
| Svelte components | `npm run test:components` | `vitest-components.json` |
| Runner contracts | `npm run test:runner` | `vitest-runner.json` |

Unfiltered `test:browser` also runs components inside the pinned container.
Use `test:source:coverage` when collecting release coverage. Locally, select
relevant feature paths, `--tags 'expression'` or `-t 'scenario pattern'`; leave
full regression to CI unless explicitly requested.

### Execution evidence

Each suite also writes a blob under `tmp/test/blobs/` and a proof under
`tmp/test/executions/`. Proofs bind the tested commit, run attempt, selected
features and hashes of the JSON and blob. Feature URI and example-row identities
are compared with an independently parsed inventory.

Normal report generation requires all six complete, passing, unfiltered suites
and 100% scoped coverage. Missing cases, stale results, skipped work, altered
hashes or mismatched CI attempts fail validation.

### Combined HTML report

After complete validation, run:

```sh
npm run report:tests
```

Vitest merges recorded results and coverage without rerunning tests. The output
is `tmp/test/report/`, including the entry page, UI assets, coverage, attachments,
machine results and provenance. Keep the whole directory together.

Serve it locally over HTTP, for example:

```sh
npx --no-install vite preview --outDir tmp/test/report --host 127.0.0.1
```

### Failure diagnostics

- `application-test-report` and `automation-test-report` retain available raw
  JSON, blobs, execution proofs and attachments.
- Failed browser cases retain screenshots, diagnostics and downloadable traces.
- A partial HTML report may be retained as `validation-diagnostics`. Its warning
  and provenance mark it incomplete; it cannot become reusable validation proof.
- Detailed tool output remains in the job logs.

## Coverage reports

`npm run test:source:coverage` collects V8 coverage for the application scope in
`coverage.config.json`, including unexecuted files. `npm run test:coverage`
checks its summary against 100% statements, branches, functions and lines.

Raw reports remain under `tmp/test/coverage/`; `report:tests` includes their
merged counterpart under `tmp/test/report/coverage/`. There is no separate HTML
packaging command or separate primary report to publish.

## Badges

### Scenario badges

CI generates JSON and SVG badges from all six Vitest suite results. Counts include
scenario-outline examples, not steps; passing requires successful steps and hooks.
Badges travel inside the validated `test-report` artifact and are published with
the release reports. No badge commit or freshness check is required.

For local inspection, `npm run badges:scenarios` writes to `tmp/test/badges`.
Filtered or incomplete results cannot represent the complete suite.

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

CI generates the statement-coverage badge from the scoped V8 summary. Coverage
thresholds remain blocking checks; the full report includes all four measures.
The badge shares the validated report artifact and publication path above.

For local inspection, `npm run badges:coverage` writes to `tmp/test/badges`.

## Documentation-only changes

Branch policy is described in the
[documentation integration decision](../../docs/adr/continuous-integration.md#updating-documentation).

### Branch and file scope

- Create `docs/<topic>` from the intended target: `develop`, `main`, or an active
  `release/<version>`. Open a PR for each destination explicitly.
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
- Normal `main`, `develop` and release CI skip `docs/*` PRs. Release targets must
  have a valid, unpublished version and must not have already merged into `main`.
- Mixed changes fail documentation validation; they do not fall through to
  application CI.

### Merging and retry

Only same-repository, non-draft PRs auto-merge after validation. The App verifies
the tested head and target revision. One commit fast-forwards when the target is
its ancestor; other documentation PRs squash.

- A `main` target requires current `main`, except permitted dependency-badge advances.
- Documentation merges into `main` or a release share the production merge lock.
  A pre-merge check also blocks them while a production release workflow is active;
  generated release-changelog PRs wait up to two minutes for that work to finish.
  Other documentation PRs require a retry after it finishes.
- An ordinary Markdown-only advance of an open release PR pauses its pipeline. To resume
  release validation intentionally, reopen the release PR, mark it ready for
  review, or edit it. A canonical changelog versioning update resumes automatically.
  Publication always requires complete validation for the current inputs, using
  the verified reuse rules below or a fresh run.

### Reusing a source branch

One docs branch can serve several explicit PRs. Each target validates its own
full diff; passing against `develop` does not establish that `main` or a release
is safe. No target is added automatically.

- Prefer a shared ancestor when preparing changes for several targets. A branch
  based on, or refreshed from, `develop` may carry application changes that other
  targets must reject.
- Resolve conflicts without importing unrelated target changes. If histories
  cannot satisfy every target, create a separate docs branch from that target
  and carry over only the intended Markdown edits.
- Changelog preparation for `develop` may advance the source. Other open PRs
  validate that new head independently.

If GitHub deletes the source after merging, restore its **original PR head**,
not the squash commit, before opening the next explicit PR:

```sh
bash .github/scripts/restore-documentation-branch.sh \
  owner/repository 123 docs/topic ORIGINAL_FULL_HEAD_SHA ORIGINAL_BASE
```

Use the merged PR's exact number, head SHA and base (`main`, `develop` or
`release/<version>`). The helper verifies that identity, creates only a missing
ref, and confirms it afterward. An existing branch at another SHA is never
overwritten. Retrying an exact restoration is safe; recovery does not open PRs.

### Local check

Fetch the intended target, then run:

```sh
bash .github/scripts/validate-documentation-changes.sh \
  "$(git rev-parse origin/develop)" "$(git rev-parse HEAD)"
```

Substitute `origin/main` or `origin/release/<version>` for the other targets.

### Enabling the documentation workflow

The workflow's own YAML and scripts require normal CI and release promotion.
Before the fast path is available:

1. Put the workflow and helpers on the default branch, `main`.
2. Include normal-CI exclusions on all intended targets, including active releases.
   Release-update classification must be present on `main`; until then, release
   events retain full validation rather than using the Markdown fast path.
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

Develop PRs require Gitflow policy, script linting, dependency-badge checks,
type checking and a successful preview build. They do not run test suites or
produce reusable release-validation proof. Documentation uses its separate path.

Release candidates run all six Gherkin suites with
scoped coverage before release. Later release/main integration may reuse verified
release evidence when inputs match; otherwise it runs fresh validation.

Merges are serialized per target and bind the checked head and base revision.
The head must match exactly. Dependency-version SVG-only target advances are
accepted; other advances require refreshed integration checks.

### Manual develop tests

Run **test-develop** from GitHub Actions, selecting the `develop` branch, or use:

```sh
gh workflow run test-develop.yml --ref develop
```

The workflow rejects other branches and pins all six suites to the selected
commit. Reports, coverage, badges and the built bundle remain run artifacts.
It does not merge, deploy or certify a release; release candidates still need
automatic release validation. Like the other integration workflows, it uses
the shared queue.

The workflow must reach the default branch before GitHub exposes its manual
trigger.

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
`develop`. Each entry records its original commit; **Latest** stays at the top.

- Preparation adds a changelog commit to the PR branch. Its new revision runs
  through CI before merging; automation does not alter the tested tree afterward.
- Generated changelog commits are omitted. Retries deduplicate original commit
  identities, including entries already assigned to a release.
- Write useful commit subjects and bodies; their text is retained as written.
- Concurrent PRs may need the usual update from `develop`. Resolve changelog
  entries with the shared merge helper, preserving every commit identity, then
  rerun validation. Conflicts in application files require a normal resolution.

The documentation preparation step uses trusted automation from `main`, so that
part becomes active after the helpers and workflow are promoted there.

### Recovered history

History through `0.0.42` was backfilled from Git objects and merged PR heads:

- Original messages replace squash summaries, with each commit recorded once.
  Routine branch-merge messages and generated changelog commits are omitted;
  authored integration messages remain.
- Entries belong to their earliest confirmed containing tag, following the full
  ancestry and recovered squash history. This records inclusion, not deployment.
- The [`0.0.21` release PR](https://github.com/superhero/operations.superduper.solutions/pull/101)
  merged without a surviving tag. Its changes appear under `0.0.22`, their first
  confirmed tag.

This was a historical recovery; normal PR preparation captures new messages
before squashing.

## Release preparation

### Automatic preparation

1. Preview integration of pinned `develop` and `main` revisions.
2. Reject conflicts and changes limited to dependency badges.
3. Create the release branch from pinned `develop`. Keep its exact snapshot when
   it already contains `main`; otherwise integrate pinned `main` without versioning
   the changelog.
4. Open `docs/release-changelog-<version>` into `release/<version>` to move
   **Latest** entries into the selected version. Only `CHANGELOG.md` changes.
5. Wait for that docs PR to merge, then resume the release PR with the versioned
   changelog. Reuse complete matching validation or run the full suite before
   merging into `main`, tagging and publishing.

The docs PR is created automatically and uses the ordinary documentation
validation and merge path. Its merge must precede the release merge so the tag
contains the correct changelog. Ordinary authored documentation updates do not
receive this automatic release-resume behavior.

### Updating an open release

Use the same `develop` → `main` trigger again. Automation updates the open
release rather than allocating another version, retaining release-only fixes.
New entries accumulate in Latest while existing version sections and release
fixes remain intact. The changelog docs PR is refreshed, or a new PR is opened
after an earlier merge, to extend the same version without duplicating entries.
An empty Latest section remains available for subsequent work.

Retries verify the source, target and prepared content before writing. Conflicting
application changes and a branch that advances during preparation stop the update.
Unexpected work on the generated docs branch is never overwritten. A docs PR
closed without merging must be reopened before retrying.

During the first rollout, `ci-docs` still runs the old default-branch automation.
If it rejects the newly generated PR because its creating release run is still
finishing, rerun that docs workflow after the release run completes.

### Conflict recovery

Create the release branch from `develop`, merge `main` locally, resolve conflicts
and open its PR into `main`. Changelog entries have a deterministic merge; automation
does not choose conflicting application content for you.

## Release checks and diagnostics

### Required evidence

Release CI requires full scoped coverage and all six suites for its application
inputs. Fresh runs build the exact release head and collect automation results
from the same run. The release head must include current `main`, except verified
dependency SVG updates; ancestry is checked again before merge.

### Reusing complete validation

Release stabilization and main-target workflows may reuse a successful
same-repository release validation run when every tracked input matches, except the
managed root `CHANGELOG.md`. Other Markdown files, workflows, tests, dependency
files, build configuration and file modes remain part of the comparison.

Fresh runs publish a schema-2 validation manifest only after all suites, coverage,
reports and badge generation succeed. Reuse verifies that manifest against
the original successful run and tested commit, without listing individual jobs
again. The bundle, coverage and combined test report must be complete,
unexpired and match the manifest's file hashes. Missing or unverifiable evidence
requires full validation.

Remote reads allow 30 seconds per attempt and up to two retries for transient
network or server failures, with 1- and 2-second waits. All requests, downloads
and waits share a 120-second lookup budget. Authentication, rate-limit and
invalid-evidence failures are not retried. Logs identify the failed operation
and failure category without exposing credentials or raw response bodies.

The original bundle and reports are retained without rebuilding or rewriting
their provenance. The combined report identifies its original tested commit and
run URL; the current run summary identifies the reused run. Current branch,
version, changelog and merge checks still run for the new revision.

Artifacts uploaded before auto-merge:

| Artifact | Contents |
| --- | --- |
| `bundle` | Tested application |
| `coverage` | Source coverage reports |
| `test-report` | Complete Vitest HTML directory, coverage, attachments, provenance and generated badges |
| `validation-manifest` | Original run, tested inputs and artifact hashes, produced by fresh complete validation |

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

A release PR first pauses for its changelog docs PR. Once that PR merges, a new
`ci-main.yml` run validates or reuses complete evidence, confirms the release
merge, verifies its tree, tags, deploys and synchronizes. Hotfixes follow their
main-target validation and publication path directly. There is no push-triggered
release run.

Runs are serialized per PR and are not cancelled by newer events: earlier runs
may already be deploying. Merge and production jobs have their own serialization.

### Previews and bundle reuse

- Successful integrations into `develop` or `release/*` publish Pages previews
  in the same run.
- Release and production-hotfix PRs preview their tested head before merging,
  without a manual approval gate.
- Superseded previews are skipped; documentation PRs do not deploy previews.

Preview and production use the tested bundle without rebuilding. Matching
application HTML, hosting headers and all nine favicon compatibility files
reuse the active deployment on the same branch. The finite eleven-file
allowlist rejects missing, empty, extra, nested and symlinked outputs; every
allowed filename and its bytes contribute to the deterministic bundle hash.
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
- Bundle and reports come from successful jobs in the current run or from
  verified complete validation with matching inputs. Reused artifacts retain
  their original provenance; publication need not wait for the current workflow
  to finish.

Deployment and report publication share a serialized job and reject superseded
releases. Dependency-badge-only advances do not supersede a release; intentional
rollback is a separate operation.

### Report destinations

Production promotion publishes the complete report under an immutable
`reports/<commit>-<run>-<attempt>/` prefix in R2. Downloaded bundle and report
files must match the original validation manifest before any publication. Reused
evidence retains its original tested commit, run and attempt. Assets upload before the entry
page; `test-report.html` redirects to it only after publication succeeds and the
release is still current. The older `test-coverage.html` URL redirects to that
report's coverage pages.

Scenario and coverage JSON/SVG badges publish under `badges/` from the same
validated artifact. Dependency badges remain committed files and do not publish
to R2.

### Synchronization into develop

Automation opens a PR from `main` into `develop` when needed. It preserves missing
release ancestry even when content already matches, skipping only if `develop`
already contains `main`. Fast-forward synchronization aligns both branch heads
when possible.

If development continues after a release is cut, overlapping changelog edits
may need resolution. The Latest boundary prevents Git from silently assigning
new work to the old version. Combine the two changelogs by commit identity,
keeping unreleased entries in Latest.

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

After a validation or test failure, rerun **all jobs**: complete evidence requires
all suites from the same run attempt. A promotion-only failure can retry failed
jobs; publication retains the successful validation producer's original attempt.

A full rerun recognizes the matching merged PR, rebuilds the pinned head and
verifies the released tree again. Matching tags are reused; the PR is never
merged twice.

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
