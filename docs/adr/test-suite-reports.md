# Test suite reports

> [!IMPORTANT]
> Test reporting includes every test, and release validation requires 100% coverage of explicitly scoped application logic.

## Common test format

Every test uses Cucumber features and steps so its result appears in the same
combined report. This includes unit, integration, acceptance, automation, browser
and smoke tests; a smaller test is not an exception to reporting.

Each independently evaluated case is a named scenario or scenario-outline
example. Given/When/Then describes the setup, action and expected behavior;
step definitions contain the execution details.

Steps may reuse assertions, helpers, shell scripts and Playwright, but
must not hide an independent suite behind one aggregate pass/fail result.
Failures propagate through Cucumber to validation rather than being swallowed
or converted into passing steps.

### Suite registration

Tests belong to the appropriate profile in `cucumber.config.mjs`:

| Profile | Responsibility |
| --- | --- |
| Source | Application logic exercised directly in Node |
| Acceptance | Application artifact requirements |
| Automation | Repository scripts and automation behavior |
| Browser | Application behavior exercised through Playwright |

New features and step definitions must be registered with their profile and
included in its JSON output. Verify that each added case appears in the combined
HTML report and scenario count; adding a file alone does not ensure discovery.

### Report completeness

The four profiles produce separate Cucumber JSON files. `npm run report:tests`
combines them with `multiple-cucumber-html-reporter` into `tmp/test-report.html`,
a standalone report that opens offline.

A complete report requires results from all four suites for the validation run.
The normal command rejects missing or invalid inputs. Report generation alone
does not detect unregistered tests, filtered suites or stale results, so these
must not be presented as a complete run.

Scenario badges use the same results. Each scenario-outline example counts as
a case; steps are not separate tests. A case passes only when every step and hook
passes. Skipped or unfinished cases must not be presented as passing.

### Failure diagnostics

CI retains available results after failures and may generate a partial diagnostic
report. It identifies missing suites and warns that it does not certify successful
validation. This aids investigation without replacing the complete report or
turning a failed run into a success.

## Coverage

### Measured scope

Release validation requires **100% statements, branches, functions and lines**
for the application logic included by `.c8rc.json`. c8 includes unexecuted files
within that scope; the percentage does not describe the entire application.

The scope covers Node-executable logic such as parsing, mapping, aggregation,
layout, response decoding and worker RPC. Browser adapters, worker entry points,
DOM startup and other explicit exclusions still require appropriate behavioral
tests. Scope changes must preserve that verification rather than merely improve
the percentage.

Report completeness, passing tests and measured coverage are separate
requirements. Neither a passing suite nor full coverage alone proves correct
behavior; assertions must verify meaningful outcomes.

### Coverage artifacts

`npm run test:source:coverage` collects coverage. `npm run test:coverage` checks
the thresholds and writes reports to `tmp/test/coverage/`.
`npm run report:coverage` packages them as the standalone `tmp/test-coverage.html`.

The coverage report includes all four measurements; the coverage badge records
statement coverage. Badge updates use fresh results, and release CI checks them
against its measurements.

## Existing reporting gap

Currently, `test:source` also runs `test:unit`, whose standalone Node tests affect
CI success and coverage but are absent from the combined report and scenario
count. Isolated browser smoke scripts also remain outside Cucumber reporting.
These are known deviations, not an alternative testing standard.

Migration remains pending. Move each case into the appropriate Cucumber profile,
preserving assertions, failure behavior and coverage. Verify report and badge
inclusion before removing the old execution path. New tests follow the Cucumber
standard instead of extending the standalone suites.
