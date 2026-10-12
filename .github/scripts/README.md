# Automation commands

Put reusable repository automation here. Workflows own triggers, permissions and
job order; scripts own executable checks and operations. The
[workflow guide](../workflows/README.md) documents invocation, required inputs and
recovery procedures.

## Responsibility map

| Area | Scripts |
| --- | --- |
| Branch, version and content validation | `validate-pr.sh`, `validate-semver.sh`, `validate-badge-only-advance.sh`, `validate-released-content.sh`, `validate-release-tree.sh`, `validate-current-release.sh` |
| Documentation integration | `validate-documentation-changes.sh`, `validate-documentation-merge.sh` |
| Merge and release lifecycle | `auto-merge.sh`, `preview-merge.sh`, `create-release-pr.sh`, `validate-release-pr.sh`, `merge-release-pr.sh`, `synchronize-release.sh` |
| Shared release identity checks | `release-pr.sh`, sourced by the validation and merge entrypoints |
| Pages and report publication | `prepare-pages-deployment.sh`, `record-pages-deployment.sh`, `publish-status.sh` |
| Dependency status | `list-dependency-branches.sh`, `update-dependency-status.sh`, `publish-dependency-badges.sh` |
| Generated reports and badges | `generate-*-report.mjs`, `generate-*-badge.sh`, `generate-dependency-badges.sh` |
| Browser suite runner | `test-browser.sh` |

## Adding or changing commands

Extend the script responsible for the behavior; add a focused command when its
inputs and responsibility are distinct. Pair behavior changes with individually
reportable Cucumber scenarios in [`../tests/`](../tests/README.md), using temporary
repositories and simulated external responses.

## Validation and outputs

Use the [local validation procedure](../workflows/README.md#automation-changes)
for automation tests and ShellCheck. Generated badges belong in
[`../badges/`](../badges/README.md); reports and diagnostics belong under `tmp/`.
Policy decisions remain in the [CI](../../docs/adr/continuous-integration.md),
[deployment](../../docs/adr/continuous-deployment.md) and
[test-reporting](../../docs/adr/test-suite-reports.md) ADRs.
