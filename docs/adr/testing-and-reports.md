# Testing and test reports

Use Cucumber features and steps for all tests so their results can be combined
into one report. The source, acceptance, automation and browser suites share
this format; browser steps use Playwright to exercise the application.

[`cucumber.config.mjs`](../../cucumber.config.mjs) defines the suites and their
JSON outputs. After running all four suites, `npm run report:tests` uses
`multiple-cucumber-html-reporter` to generate `tmp/test-report.html`, a standalone
report that can be opened offline. Missing or invalid suite results must fail
report generation. The scenario badge uses the same Cucumber results.

There is a known gap: `test:source` also invokes standalone Node tests through
`test:unit`. They affect CI success and measured coverage, but their individual
results are absent from the combined report and scenario count. Migrating them
into Cucumber is deferred; preserve their assertions and coverage when doing so.
Isolated browser smoke scripts also sit outside Cucumber reporting.

See [npm commands](../../README.md#npm-commands) for running the suites,
[repository automation](../../.github/workflows/README.md#test-reports) for
report publication and badges, and [source coverage](source-coverage.md) for
the separate code coverage requirement.
