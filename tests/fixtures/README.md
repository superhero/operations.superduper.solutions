# Test-only source fixtures

Use this directory for source files loaded by a test harness to create controlled
conditions.

## Current fixture

[`dev-errors.ts`](dev-errors.ts) exports explicit runtime and logging
failures for the development-tools journey in
[`../browser/legacy-smoke.feature`](../browser/legacy-smoke.feature). Importing the fixture does not trigger
either failure; the harness copies it into an isolated Vite application under
`tmp/test/browser/` and invokes the chosen function.

## Fixture boundaries

Keep fixtures deterministic, safe to import and explicit about their effects.
Import them only from test code. Generated copies, caches and diagnostics belong
under `tmp/`, while fixtures used specifically by browser scenarios should live
beside their consumers in [`../browser/`](../browser/README.md).

## Reporting

Fixtures supply inputs and controlled behavior. Reportable tests belong in
Gherkin feature files and their step definitions, including development-overlay
regressions. See the [test placement guide](../README.md) when adding coverage
that uses a fixture.
