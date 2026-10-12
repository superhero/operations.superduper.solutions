# Automation scenarios

This directory tests repository scripts, workflow configuration, release rules,
publication and report generation. Add behavior in a named `.feature` scenario
or scenario-outline example, with step definitions in a matching `.test.mjs`
file. Despite that suffix, these modules use Cucumber; they are not standalone
Node tests.

## Discovery

The `automation` profile in [`cucumber.config.mjs`](../../cucumber.config.mjs)
discovers `.github/tests/*.feature` and `.github/tests/*.test.mjs` automatically.
Nested directories need a configuration change. Import helper modules from
steps; helpers are not independently discovered scenarios.

## Isolation and fixtures

[`support.mjs`](support.mjs) provides the `@automation` hooks, temporary working
directory and script runner. Import it when using that harness and tag the
scenario accordingly. [`mock-command.mjs`](mock-command.mjs) consumes explicit
expected `gh`, `curl` and `npm` responses; unexpected calls and unused responses
fail validation. Keep fixture data with the responsible steps, and create
temporary Git repositories for history-sensitive cases.

## Reporting and validation

Each independently evaluated case must remain visible in Cucumber results;
follow the [test-reporting ADR](../../docs/adr/test-suite-reports.md). Application
browser cases belong in [`tests/browser/`](../../tests/browser/README.md).
See [local automation validation](../workflows/README.md#automation-changes) for
commands and prerequisites.
