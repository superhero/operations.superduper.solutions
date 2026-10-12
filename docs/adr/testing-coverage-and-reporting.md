# Test reporting includes every test, and release validation requires 100% coverage of explicitly scoped application logic

## Context

A combined report must account for every test that influences validation.
Coverage answers a separate question: which measured application code those
tests execute. Neither a passing suite nor full coverage alone proves that the
application behaves correctly.

## Decision

Every test belongs in the test-suite reports. Release validation also requires
100% statement, branch, function and line coverage of the application logic
explicitly included in [`.c8rc.json`](../../.c8rc.json). The percentage describes
that measured scope, not the entire application.

### Test suites and reports

Cucumber features and steps are the common format for source, acceptance,
automation and browser tests. Browser steps use Playwright to exercise the
application. [`cucumber.config.mjs`](../../cucumber.config.mjs) defines these
suites and their JSON outputs.

After all four suites have run, `npm run report:tests` uses
`multiple-cucumber-html-reporter` to generate `tmp/test-report.html`, a standalone
report for offline viewing. Missing or invalid suite results must fail report
generation. The scenario badge uses the same Cucumber results.

There is a known implementation gap: `test:source` also invokes standalone Node
tests through `test:unit`. They affect CI success and measured coverage, but
their individual results are absent from the combined report and scenario
count. Isolated browser smoke scripts also sit outside Cucumber reporting.
Migration into Cucumber is deferred; the reporting requirement still applies,
and the migration must preserve their assertions and coverage.

### Measured coverage

c8 measures Node-executable application logic, including parsing, mapping,
aggregation, layout, response decoding and worker RPC. Browser adapters, worker
entry points, DOM startup code and other explicit exclusions are listed in
`.c8rc.json`. Browser scenarios and isolated
[smoke checks](../../tests/schema-storage.smoke.mjs) exercise browser-dependent
behavior. That verification remains necessary when coverage scope changes.

## Usage

See [npm commands](../../README.md#npm-commands) for running the four suites, then
generate their combined report with `npm run report:tests`.

After installing dependencies, collect and check coverage, then package it for
offline viewing:

```sh
npm run test:source:coverage
npm run test:coverage
npm run report:coverage
```

`test:source:coverage` runs source scenarios and standalone Node tests. Reports
are written to `tmp/test/coverage/`; the standalone file is
`tmp/test-coverage.html`. The coverage badge records statement coverage, while
the report includes all four measurements.

See repository automation for [report publication and scenario badges](../../.github/workflows/README.md#test-reports)
and [coverage badges](../../.github/workflows/README.md#coverage-badges).

## Consequences

Report completeness and source coverage are separate validation requirements.
New tests must participate in reporting, and changes to the measured scope must
retain appropriate verification for excluded browser-dependent behavior.
