# Repository automation

Validation, reports, badges, and GitHub Actions workflows. See
[Contributing](../../CONTRIBUTING.md) for project guidance and
[Continuous integration and deployment](../../docs/adr/branching-and-releases.md)
for the branching and release decision.

- [Local validation](#local-validation)
- [Documentation-only changes](#documentation-only-changes)
- [Test reports](#test-reports)
- [Scenario badges](#scenario-badges), [dependency badges](#dependency-badges), and [coverage badges](#coverage-badges)
- [Branch workflows](#branch-workflows) and [merging](#validation-and-merging)
- [Release preparation](#release-preparation), [checks](#release-checks-and-diagnostics), and [stabilization](#release-stabilization-and-versions)
- [Publication and synchronization](#publication-and-synchronization), including [retries](#retrying-publication)
- [GitHub App permissions](#github-app-permissions)
- [Scheduled dependency checks](#scheduled-dependency-checks)
- [Reading workflow runs](#reading-workflow-runs)

## Local validation

For changes to release automation, run these checks from the repository root:

```sh
npm run test:automation
npm run badges:dependencies -- --check
shellcheck .github/scripts/*.sh
```

Automation uses the same Cucumber feature and JavaScript step format as the
application tests. Install the locked dependencies with `npm ci`; the automation
scenarios also require Bash, Git and jq. They run the real shell scripts with simulated
GitHub and Cloudflare responses in temporary directories, without creating
releases or deploying. Unexpected external requests fail the scenario.

## Test reports

See [Testing, coverage and reporting](../../docs/adr/testing-coverage-and-reporting.md) for the
Cucumber decision and the pending standalone-test reporting gap.

The source, acceptance, automation, and browser profiles write Cucumber JSON to
`tmp/test/cucumber-source.json`, `tmp/test/cucumber-test.json`,
`tmp/test/cucumber-automation.json`, and `tmp/test/cucumber-browser.json`.
Release CI retains the application and
automation results as `application-test-report` and `automation-test-report`,
including available results when tests fail. Application source coverage remains
separate.

After running all four suites, `npm run report:tests` uses
`multiple-cucumber-html-reporter` to combine their results into
`tmp/test-report.html`. The standalone HTML contains the overview, feature and
scenario details, styles, scripts, and fonts; it can be opened offline. Missing
or invalid suite results stop generation instead of producing a partial report.

## Scenario badges

The Test Scenarios badge counts reported test cases across those same four suites,
including each scenario-outline example. Steps are not counted as separate tests.
After running all suites, `npm run badges:scenarios` updates
`.github/badges/test-scenarios.json` and its SVG; include them with test changes.
Release CI checks both with `npm run badges:scenarios -- --check`. A scenario
passes only when every step and hook passes; failed or skipped cases cannot
produce an all-passing badge. Detailed results stay in the HTML report.

## Dependency badges

The README's package-version badges are generated SVGs in `.github/badges`.
Their relative image paths follow the branch or tag being viewed. After changing
dependencies, run `npm run badges:dependencies` and include the updated SVGs in
the same commit as the manifest. CI checks that the files match `package.json`.
The dependency cron colours each badge orange when the declared version differs
from npm's reported `latest` version and blue otherwise. The colour records the
last successful check for that branch. Ordinary generation and CI preserve it while the declared
version is unchanged; changing a version resets its badge to blue until checked.
Registry failures leave the badges unchanged.

## Coverage badges

See [Testing, coverage and reporting](../../docs/adr/testing-coverage-and-reporting.md) for the measured scope
and coverage requirements.

The coverage badge records measured statement coverage in
`.github/badges/test-coverage.json`, with a matching SVG for the README. Regenerate
both files from a fresh source-coverage run and include any changes in the same
commit as the code:

```sh
npm run test:source:coverage
npm run test:coverage
npm run badges:coverage
```

Release CI checks both files against its measured coverage with
`npm run badges:coverage -- --check`. Badge updates do not create bot commits.

## Documentation-only changes

Create `docs/<topic>` from the branch you intend to update, either `develop` or
`main`, and open a PR to that same target. Only regular, non-executable Markdown
files (`.md`, case-insensitive) may be added, edited, renamed, or deleted. Images,
badges, configuration, scripts, and other file types use the normal feature or
bugfix path, even when related to documentation.

[`ci-docs.yml`](ci-docs.yml) checks the complete Git change set from merge base to
the pinned PR head. It inspects both sides of renames, rejects symlinks,
executable files, submodules, and empty changes, and fails if Git cannot verify
the history. It does not rely on the capped GitHub changed-files list.

The workflow runs trusted automation from the default branch using
`pull_request_target`. PR content is fetched only as Git objects and is never
checked out or executed. No packages are installed, and no test suites, builds,
releases, tags, deployments, reports, or synchronization jobs run. The normal
`main` and `develop` workflows skip `docs/*` PRs; mixed changes fail the
documentation check rather than falling through to application CI.

After successful validation, the App merges same-repository, non-draft PRs using
the existing exact-head and target-revision checks. A single commit fast-forwards
when the target is its ancestor; other documentation PRs squash. A documentation
branch targeting `main` must include current `main`, apart from dependency-badge
updates. Choose each destination explicitly: merging into `main` does not open a
PR to `develop` or synchronize another branch.

Before a documentation merge into `main`, a lightweight check ensures that no
production release workflow is currently running. If one is active, retry the
documentation workflow after it finishes; this prevents a documentation commit
from interrupting that release's tagging or deployment.

To check a documentation branch locally after fetching the target:

```sh
bash .github/scripts/validate-documentation-changes.sh \
  "$(git rev-parse origin/develop)" "$(git rev-parse HEAD)"
```

Use `origin/main` instead when targeting `main`.

### Enabling the documentation workflow

The automation itself changes YAML and shell scripts, so its initial rollout
uses normal CI and release promotion. The workflow and helpers must reach the
default branch (`main`), and the normal CI exclusions must exist in both target
branches, before the fast path is available for each target.

GitHub's public-repository event policy also needs an explicit
`pull_request_target` allowance scoped to `.github/workflows/ci-docs.yml`.
The [policy definition](../policies/documentation-events.json) limits that
allowance to trusted documentation automation. An administrator can create the
policy once from the repository root, or update the existing policy if already
configured:

```sh
gh api --method POST \
  repos/superhero/operations.superduper.solutions/actions/policies \
  -H 'X-GitHub-Api-Version: 2026-03-10' \
  --input .github/policies/documentation-events.json
```

See [GitHub's event policy guidance](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
and [Actions policy API](https://docs.github.com/en/rest/actions/policies#create-a-repository-actions-policy).

## Branch workflows

Application CI is split by target branch or branch family:

- [`ci-develop.yml`](ci-develop.yml) validates PRs into `develop`.
- [`ci-release.yml`](ci-release.yml) validates PRs into `release/**`.
- [`ci-support.yml`](ci-support.yml) validates PRs into `support/**`.
- [`ci-main.yml`](ci-main.yml) validates, merges, and deploys release PRs into `main` in one run.

The branch workflows define their own triggers, jobs, permissions, and artifact
handling. Common Gitflow, merge, release, and publishing logic lives in Bash
scripts under `.github/scripts`; branch CI does not call a shared workflow.
The workflow is selected by the PR target. Feature and integration bugfix PRs run
develop CI; release-stabilization bugfix PRs run release CI. Hotfix PRs run CI for
their chosen main, release, or support target.

## Validation and merging

Main CI creates releases from `develop` trigger PRs and validates release and
hotfix PRs. Every automatic merge requires automation checks, Gitflow policy,
and application checks. Each application job installs once and runs its checks
locally; npm's download cache is the only cache used.
Auto-merges are serialized per target branch and bind both the tested head and
base commit. A target advancement is accepted only when every intervening change
is to a dependency-version SVG. Other changes require fresh validation before
merging; the tested head must always match exactly.
Feature and bugfix PRs into `develop`, and `hotfix/*` PRs into `main`,
fast-forward when they contain exactly one commit ahead of the current target
and that target is an ancestor; otherwise the App squash-merges them.
Release stabilization, publication, and synchronization of released code prefer
fast-forward, falling back to a merge commit when histories have diverged. The shared helper
selects the method from the current PR's source and target branches.
Both `develop` and `main` PR rules permit merge and squash. GitHub has no
fast-forward PR merge method, so the App updates the target ref without force
after CI passes, using the exact tested head and rechecking the PR before writing.
Every merge method waits up to three minutes for GitHub to confirm the exact
PR and merge commit. A blocked merge reports GitHub's reason; it does not enable
queued auto-merge. Retries accept an already merged PR only when its repository,
source branch, tested head, and target branch still match. Shared branches are
never rebased, and force-push protection still applies to the App.

## Release preparation

Before creating a release, automation previews the integration of `develop` and `main`
and rejects conflicts or changes limited to dependency badges. It creates the
release branch from the pinned `develop` revision, incorporates pinned `main`,
then validates and builds that release head through the usual CI flow.
If the preview reports a conflict, prepare the release branch from `develop`,
merge `main` into it locally, resolve the conflict, and open its PR into `main`.
Automation never guesses which conflicting changes to retain.

## Release checks and diagnostics

Release CI builds the exact head commit, requires full coverage, and uploads
`bundle`, `coverage`, and the combined HTML `test-report` before auto-merge. All
four test suites use that same release head; the application job collects the
automation results from its own workflow run. The head must
contain current `main` apart from verified dependency-badge updates, with ancestry
checked again before merging. Failed acceptance reports are downloadable; full
test output stays in job logs.
Coverage reports are also retained when the coverage check fails. Workflow
guards explain the rejected input or missing output with an error annotation;
native tool diagnostics remain in step logs. npm errors are kept visible even
when routine logging is reduced, and R2 failures include structured Cloudflare
error details without dumping raw responses or credentials.
Errors include the relevant nonsecret inputs (such as PR, branch, commit, file
or destination), with expected and actual values for mismatches. API failures
retain their native reason alongside the attempted operation. Log only selected
context; do not dump argument lists, environments, authentication headers or raw
API responses. Missing credentials are reported by variable name only.

## Release stabilization and versions

Release-trigger retries reuse their release PR, including after corrections to
the release branch. Make stabilization fixes on a `bugfix/*` branch created from
the active `release/<version>` and open a PR back into that release. Release CI
validates and merges the fix, then the existing PR into `main` validates the
updated release head. Stabilization rejects invalid release versions and targets
already tagged or merged into `main`; direct pushes do not replace these checks.
Version validation fails on API errors and rejects a version already reserved by
a release or hotfix, including a merged version whose tag has not been created yet.
An already released hotfix may synchronize into `develop`, an active release,
or an explicitly selected support line. Its source must remain within the
released revision, apart from dependency-badge changes. Released release-branch
targets are rejected; support destinations retain their next-patch version check.
Automatic release creation still selects the next patch version. If an active
release has reserved the patch needed by an urgent hotfix, give the planned
release a different version first. Release and hotfix branches cannot share a
version; synchronization does not rename releases or change version policy.

## Publication and synchronization

Each release or hotfix PR into `main` follows one continuous `ci-main.yml` run:
validation and build, confirmed merge, content verification and tagging, then
deployment and synchronization. The initial `develop` trigger still creates a
separate versioned release PR so that PR's exact head can be reviewed and tested.
There is no push-triggered release run.

The merge step waits for GitHub to confirm the exact PR has merged, including
queued auto-merges and delayed fast-forward recognition. Before tagging, Git
compares the tested head and actual released trees directly, permitting only
dependency-version SVG differences. This also verifies squash merges without
requiring the tested head to be an ancestor of the released commit. Every
production step uses the confirmed merge SHA; the PR's synthetic merge commit
is never a deployment reference. Deployment consumes the bundle and reports
from successful jobs in the same run, without waiting for the whole run to finish.

Runs are serialized per PR and are not cancelled by newer PR events, because an
earlier run may already be deploying. Merge and production jobs retain their own
serialization. Current PR state is checked before merging, and unmerged,
retargeted, forked, or advanced PRs cannot supply release identity. The workflow
tags the release, opens any needed synchronization PR for normal `develop` CI,
and promotes its validated artifacts.
After a production hotfix, the same synchronization job also opens a PR into
the active release, if one exists. It uses the tagged main revision so the
release includes the production history required by its final main CI. A deleted
hotfix branch is restored at that revision. A surviving branch containing only
the tested hotfix and later dependency badges is merged with the released
revision, preserving its commits after a squash release. The resulting branch
must contain the released revision and differ only in dependency badges.
Unexpected code changes stop synchronization without discarding those commits.
Retries reuse an open PR or skip a release that already contains the fix.
Synchronization into `develop` also preserves missing release ancestry when
the content already matches; it skips only when `develop` already contains
`main`. Fast-forward synchronization then leaves both branches at the same
commit whenever possible.
`ci-release.yml` validates and merges the synchronization PR. Support-line
destinations remain explicit rather than receiving every production hotfix.
Deployment and report publishing share one serialized job and reject superseded
releases. Dependency-badge-only advances do not supersede a release. Intentional
rollback is a separate operation.

## Retrying publication

Retry failed jobs from the original release PR run to resume a failed promotion.
Rerunning all jobs is also supported: a matching, already merged PR is validated
as a retry, its pinned head is rebuilt, and its released tree is verified again.
The workflow reuses an existing matching tag and never merges the PR twice.
If a release was merged manually, rerun its original PR workflow to complete
publication; a direct push does not start deployment. Retries require that
release to remain current and its source commit and artifacts to be available.

## GitHub App permissions

The existing GitHub App (`GH_APP_CLIENT_ID`, `GH_APP_PRIVATE_KEY`) owns PRs,
merges, tags, dependency-badge commits, and deployment records. Its installation
needs Contents, Pull requests, and Deployments read/write permissions; each job requests only
the permissions it uses. The built-in GitHub token is used for read-only API
access and normal Actions infrastructure such as artifacts and caches.
For direct badge updates on protected branches, the App needs a bypass of the
pull-request requirement for `main`, `develop`, `release/*`, and `support/*`.
Force-push protections are separate rulesets without that bypass. Permanent
`main`, `develop`, and support branches also reject deletion; temporary release
branches can still be deleted after merging. GitHub
cannot scope this bypass to badge paths; the publishing helper restricts the
commit to dependency-version SVGs and the exact checked branch head.

## Scheduled dependency checks

`cron-outdated.yml` checks dependencies daily at 06:00 UTC and can also be run
manually. Every run discovers repository branches, excludes `docs/*`, and checks each remaining branch's
commit at discovery time. It installs dependencies with lifecycle scripts disabled
and runs `update-dependency-status.sh` from the workflow's revision. The helper
reports each branch's `npm outdated --json` results in the workflow logs and
summary, including current, wanted, and latest versions. The same result refreshes
the branch's dependency SVG colours. The App commits only changed badge files,
so unchanged results create no commits. A branch that moved or was deleted after
discovery is skipped; a concurrent change during publication rejects the commit
without overwriting it. A failure on one branch does not cancel the other checks.
This workflow has no PR or push triggers. Badge-only pushes do not deploy releases;
updates to an open PR's source branch still run its normal CI checks.
Documentation branches are excluded from dependency checks and badge publication
so generated SVGs cannot enter their Markdown-only changes.
The branch CI workflows have no scheduled or manual dependency refreshes.
README package-version badges are tracked in `.github/badges/`. Dependency
checks and the coverage badge do not upload to R2. Main release promotion
publishes the coverage report (`test-coverage.html`) and combined Cucumber report
(`test-report.html`) to R2, using artifacts from the validated release run.

## Reading workflow runs

GitHub's branch label on a PR run shows its source branch. For example, a
main-to-develop synchronization PR displays `main` while running `ci-develop`.
