# Contributing

Thank you for contributing to `operations.superduper.solutions`.

## Architectural decision records

- [Simplify](doc/adr/simplify.md)
- [UI](doc/adr/ui.md)
- [Security](doc/adr/security.md)
- [Gitflow](doc/adr/gitflow.md)

## Automation validation

For changes to release automation, run these checks from the repository root:

```sh
npm run test:automation
npm run badges:dependencies -- --check
shellcheck .github/scripts/*.sh
```

Automation uses the same Cucumber feature and JavaScript step format as the
application tests. Install the locked dependencies with `npm ci`; the automation
scenarios also require Bash and jq. They run the real shell scripts with simulated
GitHub and Cloudflare responses in temporary directories, without creating
releases or deploying. Unexpected external requests fail the scenario.

The source, acceptance, and automation profiles write Cucumber JSON to
`tmp/test/cucumber-source.json`, `tmp/test/cucumber-test.json`, and
`tmp/test/cucumber-automation.json`. Release CI retains the application and
automation results as `application-test-report` and `automation-test-report`,
including available results when tests fail. Application source coverage remains
separate.

After running all three suites, `npm run report:tests` uses
`multiple-cucumber-html-reporter` to combine their results into
`tmp/test-report.html`. The standalone HTML contains the overview, feature and
scenario details, styles, scripts, and fonts; it can be opened offline. Missing
or invalid suite results stop generation instead of producing a partial report.

The Test Scenarios badge counts reported test cases across those same three suites,
including each scenario-outline example. Steps are not counted as separate tests.
After running all suites, `npm run badges:scenarios` updates
`.github/badges/test-scenarios.json` and its SVG; include them with test changes.
Release CI checks both with `npm run badges:scenarios -- --check`. A scenario
passes only when every step and hook passes; failed or skipped cases cannot
produce an all-passing badge. Detailed results stay in the HTML report.

The README's package-version badges are generated SVGs in `.github/badges`.
Their relative image paths follow the branch or tag being viewed. After changing
dependencies, run `npm run badges:dependencies` and include the updated SVGs in
the same commit as the manifest. CI checks that the files match `package.json`.
The dependency cron colours each badge orange when the declared version differs
from npm's reported `latest` version and blue otherwise. The colour records the
last successful check for that branch. Ordinary generation and CI preserve it while the declared
version is unchanged; changing a version resets its badge to blue until checked.
Registry failures leave the badges unchanged.

The coverage badge records measured statement coverage in
`.github/badges/test-coverage.json`, with a matching SVG for the README. Regenerate
both files from a fresh source-coverage run and include any changes in the same
commit as the code:

```sh
npm run test:source:coverage
npm run coverage
npm run badges:coverage
```

Release CI checks both files against its measured coverage with
`npm run badges:coverage -- --check`. Badge updates do not create bot commits.

Each CI workflow owns one target branch or branch family:

- `ci-develop.yml` validates PRs into `develop`.
- `ci-release.yml` validates PRs into `release/**`.
- `ci-support.yml` validates PRs into `support/**`.
- `ci-main.yml` validates, merges, and deploys release PRs into `main` in one run.

The branch workflows define their own triggers, jobs, permissions, and artifact
handling. Common Gitflow, merge, release, and publishing logic lives in Bash
scripts under `.github/scripts`; branch CI does not call a shared workflow.
The workflow is selected by the PR target, so feature and bugfix PRs run develop
CI, while hotfix PRs run CI for their chosen main, release, or support target.

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
Release publication and synchronization of released code prefer fast-forward,
falling back to a merge commit when histories have diverged. The shared helper
selects the method from the current PR's source and target branches.
Both `develop` and `main` PR rules permit merge and squash. GitHub has no
fast-forward PR merge method, so the App updates the target ref without force
after CI passes, using the exact tested head and rechecking the PR before writing.
It waits for GitHub to recognize the PR as merged. Shared branches are never
rebased, and force-push protection still applies to the App.

Before creating a release, automation previews the integration of `develop` and `main`
and rejects conflicts or changes limited to dependency badges. It creates the
release branch from the pinned `develop` revision, incorporates pinned `main`,
then validates and builds that release head through the usual CI flow.
If the preview reports a conflict, prepare the release branch from `develop`,
merge `main` into it locally, resolve the conflict, and open its PR into `main`.
Automation never guesses which conflicting changes to retain.

Release CI builds the exact head commit, requires full coverage, and uploads
`bundle`, `coverage`, and the combined HTML `test-report` before auto-merge. All
three test suites use that same release head; the application job collects the
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
Release-trigger retries reuse their release PR, including after corrections to
the release branch. Version validation fails on API errors and rejects a version
already reserved by a release or hotfix, including a merged version whose tag
has not been created yet.
An already released hotfix may synchronize into `develop`, an active release,
or an explicitly selected support line. Its source must remain within the
released revision, apart from dependency-badge changes. Released release-branch
targets are rejected; support destinations retain their next-patch version check.
Automatic release creation still selects the next patch version. If an active
release has reserved the patch needed by an urgent hotfix, give the planned
release a different version first. Release and hotfix branches cannot share a
version; synchronization does not rename releases or change version policy.

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
Retry failed jobs from the original release PR run to resume a failed promotion.
Rerunning all jobs is also supported: a matching, already merged PR is validated
as a retry, its pinned head is rebuilt, and its released tree is verified again.
The workflow reuses an existing matching tag and never merges the PR twice.
If a release was merged manually, rerun its original PR workflow to complete
publication; a direct push does not start deployment. Retries require that
release to remain current and its source commit and artifacts to be available.

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

`cron-outdated.yml` checks dependencies daily at 06:00 UTC and can also be run
manually. Every run discovers all repository branches and checks each branch's
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
The branch CI workflows have no scheduled or manual dependency refreshes.
README package-version badges are tracked in `.github/badges/`. Dependency
checks and the coverage badge do not upload to R2. Main release promotion
publishes the coverage report (`test-coverage.html`) and combined Cucumber report
(`test-report.html`) to R2, using artifacts from the validated release run.

GitHub's branch label on a PR run shows its source branch. For example, a
main-to-develop synchronization PR displays `main` while running `ci-develop`.

## Licensing

### Contribution license

By submitting a contribution, you agree that it is licensed under **GNU AGPLv3 only** (`AGPL-3.0-only`) together with `LICENSE-ADDITIONAL-TERMS`.

You retain the copyright in your contribution unless you separately assign it in writing.

By contributing, you represent that you have the right to submit the contribution under these terms.

### Source-file license notices

Preserve existing copyright, license, attribution, and Section 7 notices.

For new first-party source files, where comments are supported, use:

```text
Copyright (C) <year> <author name>
SPDX-License-Identifier: AGPL-3.0-only
See LICENSE and LICENSE-ADDITIONAL-TERMS.
```

Do not replace another author's copyright notice with your own.

The project uses `AGPL-3.0-only`, not `AGPL-3.0-or-later`.
