# Catalog addition audit

Run `npm run test:catalog-additions` in the pinned Playwright environment used by the browser tests. Run the requested sweep explicitly; it is separate from ordinary focused UI regressions. `-- --catalog ecb,elevenlabs` selects providers, `-- --limit 10` runs a pilot, and `-- --resume` continues durable results only when the source bytes and selection match.

The suite inventories every operation in the shipped catalogs and examples, including disabled-by-default sources and unavailable operations. It expects **every addition to pass**. Unsupported operations are failures, with no skips or expected-failure exceptions. It never repairs schemas or application code and never sends provider requests or uses user credentials.

An isolated Chromium context calls the production hydration, capability checks, schema scoping, graph construction/layout/validation, model leases and workflow repository. Each attempt has a unique workflow ID and starts with an empty graph/store. A successful addition must save and read back exactly one operation. Cleanup releases the graph/model lease, removes its Git repository and verifies zero remaining workflow documents before the next attempt. A cleanup failure fails the case and requires closing/replacing the entire context before proceeding; a failed replacement stops the run. This covers insertion and persistence, not DOM menu clicks, visual rendering, live API execution or provider credentials. The capability check uses production insertion eligibility: a missing account destination remains a run prerequisite without preventing graph storage. Execution and credential approval retain that prerequisite; invalid request, authentication, response or route contracts still fail insertion.

`tmp/test/catalog-additions/` contains the individual `results.ndjson`, exact `inventory.json`, `summary.json`, provider-grouped `report.md` and all failing identities/stages/reasons in `failures.csv`. Results are durable after every case; summaries refresh every250cases. Exit status is nonzero for any failure or incomplete sweep. Reports distinguish unavailable operations, other insertion stages and infrastructure problems. Workflows in the user's browser are untouched.
# Exact operation selection

Use repeatable `--operation <catalog:operationId>` arguments for focused rechecks.
Unknown IDs, including those outside a supplied `--catalog`, fail the run.
The same fresh-workflow and delete-before-next-operation guarantees apply.
