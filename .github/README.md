# Repository automation

This directory owns GitHub Actions configuration and the supporting code, tests,
policy inputs and generated status badges. Application behavior belongs in
[`src/`](../src/README.md); browser behavior is exercised in
[`tests/browser/`](../tests/browser/README.md).

## Where changes belong

| Directory | Responsibility |
| --- | --- |
| [`workflows/`](workflows/README.md) | Event triggers, job orchestration, permissions and artifacts |
| [`scripts/`](scripts/README.md) | Validation, merging, release, publication and report commands |
| [`tests/`](tests/README.md) | Cucumber scenarios and steps for repository automation |
| [`policies/`](policies/README.md) | Declarative inputs for repository administration |
| [`badges/`](badges/README.md) | Generated SVGs and test-summary JSON committed with their inputs |

## Responsibility boundaries

Keep reusable automation behavior in scripts and exercise it through automation
scenarios. Keep workflow-specific scheduling and job dependencies in YAML.
Generated reports and runtime diagnostics go under `tmp/` rather than alongside
the checked-in automation sources.

## Procedures and decisions

The [workflow guide](workflows/README.md) owns commands and operating procedures.
The [CI](../docs/adr/continuous-integration.md),
[deployment](../docs/adr/continuous-deployment.md) and
[test-reporting](../docs/adr/test-suite-reports.md) ADRs explain the policy behind
them; update the relevant record when changing that policy.
