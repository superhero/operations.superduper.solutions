# Contributing

Thank you for contributing to `operations.superduper.solutions`.

## Architectural decision records

- [Simplify](doc/adr/simplify.md)
- [UI](doc/adr/ui.md)
- [Security](doc/adr/security.md)
- [Gitflow](doc/adr/gitflow.md)

## Workflow validation

For changes to release automation, run these checks from the repository root:

```sh
npm run test:automation
shellcheck .github/scripts/*.sh
actionlint
```

Automation uses the same Cucumber feature and JavaScript step format as the
application tests. Install the locked dependencies with `npm ci`; the automation
scenarios also require Bash and jq. They run the real shell scripts with simulated
GitHub and Cloudflare responses in temporary directories, without creating
releases or deploying. Unexpected external requests fail the scenario.

The `automation` profile writes `tmp/test/cucumber-automation.json` in the same
format as the acceptance report, `tmp/test/cucumber-test.json`. CI retains the
automation report as `automation-test-report` on success and failure, ready for
combined reporting later. Application source coverage remains separate.

Each CI workflow owns one target branch or branch family:

- `ci-develop.yml` validates PRs into `develop`.
- `ci-release.yml` validates PRs into `release/**`.
- `ci-support.yml` validates PRs into `support/**`.
- `ci-main.yml` handles PRs into `main` and deployment after pushes to `main`.

The branch workflows define their own triggers, jobs, permissions, and artifact
handling. Common Gitflow, merge, release, and publishing logic lives in Bash
scripts under `.github/scripts`; branch CI does not call a shared workflow.
The workflow is selected by the PR target, so feature and bugfix PRs run develop
CI, while hotfix PRs run CI for their chosen main, release, or support target.

Main CI creates releases from `develop` trigger PRs and validates release and
hotfix PRs. Every automatic merge requires workflow validation, Gitflow policy,
and application checks. Each application job installs once and runs its checks
locally; npm's download cache is the only cache used.
Auto-merges are serialized per target branch and bind both the tested head and
base commit. If the target advances during CI, update the PR branch to trigger
fresh validation before merging.

Release CI builds the exact head commit, requires full coverage, and uploads
`bundle`, `coverage`, and `coverage-status` before auto-merge. The head must
contain current `main`, with ancestry checked again before merging. Failed
acceptance reports are downloadable; full test output stays in job logs.
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

The same `ci-main.yml` deploys when `main` changes. PR checks and post-merge
deployment run separately, with event guards keeping their jobs independent.
Only superseded PR runs are cancelled; deployment has its own concurrency.
Artifact lookup selects the matching PR run, never the deployment run itself.
The main-push run resolves exactly one merged same-repository release or hotfix
PR for the pushed commit before tagging;
missing or ambiguous release identity fails with context. Closing a release
trigger PR creates no extra CD run. The workflow tags the release, opens a
synchronization PR for normal `develop` CI, and promotes its validated artifacts.
All production writes share one serialized job. It waits up to ten minutes for the
matching release CI, checks artifact availability, and rejects superseded
releases before deployment or status publishing. Intentional rollback is a
separate operation. Retrying promotion repeats deployment and publishing for
the current release; retry the main-push run rather than rerunning CI for an
already merged release.

The existing GitHub App (`GH_APP_CLIENT_ID`, `GH_APP_PRIVATE_KEY`) owns PRs,
merges, tags, and deployment records. Its installation needs Contents,
Pull requests, and Deployments read/write permissions; each job requests only
the permissions it uses. The built-in GitHub token is used for read-only API
access and normal Actions infrastructure such as artifacts and caches.

`dependency-status.yml` refreshes the dependency badges from one `npm outdated`
result. It and release promotion use `publish-status.sh` for R2 uploads. Badge
URLs remain stable; legacy object deletion is not part of normal publishing.

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
