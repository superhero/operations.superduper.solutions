# Test suite reports

> [!IMPORTANT]
> Test reporting includes every test, and release validation requires 100% coverage of explicitly scoped application logic.

## Test format

Every test, including unit and smoke tests, uses Cucumber and appears in the
combined report. Each independently evaluated case is a named scenario or
scenario-outline example. Given/When/Then describes behavior; step definitions
contain execution details.

Assertions, helpers, shell scripts and Playwright may run inside steps, but
independent tests must not be hidden behind one aggregate result. Failures
propagate to validation; a case passes only when every step and hook passes.

## Combined report

Source, acceptance, automation and browser profiles share Cucumber JSON reporting.
Register features and steps in `cucumber.config.mjs` and verify each case appears
in the combined report and scenario count. The HTML report opens offline;
scenario badges use the same results and count cases, not steps.

A complete report requires fresh, unfiltered results from all four suites.
The normal report command rejects missing or invalid inputs but cannot detect
unregistered tests, filtered runs or stale results. Skipped and unfinished cases
are not passes.

After failure, CI may retain a partial diagnostic report. Missing suites and
failed validation remain explicit; that report cannot certify success.

## Coverage

Release validation requires **100% statements, branches, functions and lines**
across the Node-executable application logic scoped by `.c8rc.json`. c8 includes
unexecuted files within that scope; this is not whole-application coverage.

Excluded browser adapters, worker entry points and DOM startup still require
behavioral tests. Changes to coverage scope must preserve that verification.
Report completeness, passing tests and coverage are separate requirements;
assertions must verify meaningful outcomes, not merely execute code.

## Pending migration

Standalone Node tests run through `test:unit` within `test:source`, affecting CI
and coverage without appearing in the combined report or scenario count.
Isolated browser smoke scripts also remain outside reporting.

These tests must move into the appropriate Cucumber profiles, preserving
assertions, failure behavior and coverage. Verify report and badge inclusion
before removing the old execution path. New tests follow the Cucumber standard.
