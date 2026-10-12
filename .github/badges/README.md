# Generated status badges

This directory contains committed outputs used by the repository README and CI.
Edit their inputs or generators, then regenerate the affected files.

## Contents and sources

| Files | Source |
| --- | --- |
| `version-dependency-*.svg` | Declared dependencies in `package.json`; scheduled checks refresh registry status |
| `test-scenarios.json` and `.svg` | Fresh Cucumber JSON from all four test profiles |
| `test-coverage.json` and `.svg` | The scoped c8 coverage summary |

## Placement

Generator implementations belong in [`../scripts/`](../scripts/README.md), and
their behavioral tests belong in [`../tests/`](../tests/README.md). Keep HTML
reports, raw test results, screenshots and coverage data under `tmp/`.

## Regeneration and validation

Follow the [badge procedures](../workflows/README.md#badges) for generation,
checking and committing outputs with the corresponding source changes. Filtered,
partial or stale test results cannot establish a complete scenario badge.

## Release allowance

The dependency-only advance allowance used by release automation covers
`version-dependency-*.svg` specifically. It does not extend to test badges or
this README. The [test-reporting ADR](../../docs/adr/test-suite-reports.md)
defines what scenario and coverage results mean.
