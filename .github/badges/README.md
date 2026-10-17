# Dependency status badges

This directory contains committed dependency-version SVGs used by the repository
README. Their inputs are the declared dependencies in `package.json`; scheduled
registry checks refresh their status colors.

## Generation

Run `npm run badges:dependencies` after manifest changes and commit the generated
SVGs with `package.json`. CI checks their agreement. See the
[badge procedures](../workflows/README.md#badges).

## Test results

Scenario and coverage badges are generated under `tmp/test/badges`, retained with
validated reports and published to the status site. They are not committed here.
See the [test-reporting ADR](../../docs/adr/test-suite-reports.md).

## Placement

Generators belong in [`../scripts/`](../scripts/README.md), and behavioral tests
belong in [`../tests/`](../tests/README.md). Reports and generated test results
belong under `tmp/`.

## Release allowance

The dependency-only advance allowance covers `version-dependency-*.svg`
specifically. It does not extend to this README or other files.
