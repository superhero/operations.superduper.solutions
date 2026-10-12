# Source coverage

Use c8 to measure which application code the tests execute. Release validation
requires 100% statement, branch, function and line coverage within the scope
defined by [`.c8rc.json`](../../.c8rc.json). The percentage describes that measured
scope, not the entire application.

Measure Node-executable application logic, including parsing, mapping,
aggregation, layout, response decoding and worker RPC. Browser adapters, worker
entry points, DOM startup code and other explicit exclusions are listed in the
configuration. Browser scenarios and isolated [smoke checks](../../tests/schema-storage.smoke.mjs)
exercise browser-dependent behavior. Keep that verification when changing coverage scope.

After installing dependencies, collect and check coverage, then package the
report for offline viewing:

```sh
npm run test:source:coverage
npm run test:coverage
npm run report:coverage
```

The generated reports are in `tmp/test/coverage/`; the standalone file is
`tmp/test-coverage.html`. The coverage badge records statement coverage, while
the report includes all four measurements. See [coverage badge instructions](../../.github/workflows/README.md#coverage-badges)
and [testing and test reports](testing-and-reports.md).
