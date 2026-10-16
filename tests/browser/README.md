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

## Discovery and execution

`live-prompt.feature` covers automatic sidebar matching, cancellation, catalog
expansion and mobile selection. Matches add nodes to the workflow; operation
inputs, reports and HTTP execution belong to the **Run workflow** dialog.

The shared `chooseCatalogOperation` helper creates a single-node workflow and
opens its run. Pass `"workflow"` when a scenario only needs to add a node.
`restartRun` starts a new execution; its optional input restoration represents
re-entering values, not persisted run state.

## Execution boundary

Run `npm run build` before `npm run test:browser`. The
[runner](../../.github/scripts/test-browser.sh) uses the matching pinned
Playwright container with networking disabled. Support serves `dist/index.html`
and the exact favicon allowlist with their declared MIME types on loopback,
creates a fresh browser context for each scenario, and rejects
unexpected external requests. Simulate endpoint responses through test routes;
keep test hooks out of the shipped application.

Chromium remains the default. Use `BROWSER_ENGINE=firefox` or
`BROWSER_ENGINE=webkit` for an opt-in run with the same pinned image. Additional
Cucumber arguments pass through, for example
`BROWSER_ENGINE=firefox npm run test:browser -- --tags @vault-browser-kdf --parallel 1`.
Non-Chromium runs exclude `@chromium-only` scenarios. Each invocation replaces
the browser report and failure artifacts; copy evidence before starting another
run when comparing engines.

The error-history fixture runs the real IndexedDB store and recording worker on
an isolated test page. Its scenarios cover multi-tab deduplication, FIFO eviction,
transaction rollback, blocked storage and bounded recording; UI cases also open
the Errors view in the built application. Fixture routes are test-server-only.

Vault fixtures exercise the real IndexedDB/Web Locks adapters, worker schema
policy and bounded Fetch responses against isolated loopback endpoints. The KDF
worker checks pinned reference bytes and the application's nonextractable key
under a restrictive CSP. Vault UI cases use the built application, including
recovery verification, lock/unlock and encrypted backup restore. Native WebAuthn
cases use Chromium's CDP virtual authenticator on `localhost`; these cover native
ceremonies and worker wrapping. The different-RP restore case adds bounded
cancellation to the native call without fabricating credentials or PRF output.
They do not qualify physical authenticators, synced providers, mobile devices
or cross-provider portability. The non-PRF virtual authenticator is a separate
failure case and must preserve existing unlock methods.

The CORS-denied case disables request interception only in its fresh isolated
fixture context so the browser performs its real preflight; the container still
has external networking disabled. Diagnostic-copy coverage uses native Chromium
selection and keyboard copying with clipboard permission. Persistence canary
checks inspect local/session storage, IndexedDB values and keys, and Cache API
entries; they do not claim to decompress arbitrary Git packfiles or inspect
browser process memory.

Playwright aborts routed requests whose URL ends in `/favicon.ico` before its
route callback runs. Favicon scenarios therefore fetch that exact hosted URL
through Playwright's HTTP client, then give the returned bytes to Chromium's
image decoder as a data URL. This verifies both the real endpoint and ICO
decoding without weakening the external-network boundary. Other icon formats
use ordinary browser requests.

## Scenario state and diagnostics

Scenarios run in parallel, so keep mutable state in the scenario World or its
fixtures. Failure diagnostics, screenshots and traces belong in
`tmp/test/browser/`; Cucumber JSON belongs in `tmp/test/`. See the
[workflow guide](../../.github/workflows/README.md#local-validation) for setup
and complete report generation.
