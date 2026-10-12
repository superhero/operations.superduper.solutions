# Browser scenarios

This suite exercises the built application and generated report behavior through
Cucumber and Playwright. Put user-visible cases in top-level `.feature` files
and execution details in `.steps.mjs`. The `browser` profile in
[`cucumber.config.mjs`](../../cucumber.config.mjs) discovers both patterns and
loads [`support.mjs`](support.mjs) explicitly. Nested files need registration.

## Helpers and fixtures

Keep focused helpers and `*.fixture.mjs` or `*.fixture.ts` modules beside their
consumers and import them from steps or support. Fixtures prepare data or inspect
state; each independent assertion case still needs its own reportable scenario
under the [testing standard](../../docs/adr/test-suite-reports.md).

## Execution boundary

Run `npm run build` before `npm run test:browser`. The
[runner](../../.github/scripts/test-browser.sh) uses the matching pinned
Playwright container with networking disabled. Support serves `dist/index.html`
on loopback, creates a fresh browser context for each scenario, and rejects
unexpected external requests. Simulate endpoint responses through test routes;
keep test hooks out of the shipped application.

## Scenario state and diagnostics

Scenarios run in parallel, so keep mutable state in the scenario World or its
fixtures. Failure diagnostics, screenshots and traces belong in
`tmp/test/browser/`; Cucumber JSON belongs in `tmp/test/`. See the
[workflow guide](../../.github/workflows/README.md#local-validation) for setup
and complete report generation.
