# Browser scenarios

This suite exercises the built application and generated reports through Gherkin,
QuickPickle, Vitest and Playwright. Put user-visible cases in top-level `.feature`
files and execution details in `.steps.mjs`. The `browser` profile in
[`profiles.mjs`](../gherkin/profiles.mjs) discovers both patterns and loads
[`support.mjs`](support.mjs) explicitly. Import nested helpers from those steps.

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

## Default catalog fixtures

Most scenarios isolate the two example catalogs through the real IndexedDB
installation record, avoiding unrelated provider setup. The `@service-defaults`
scenarios exercise all shipped providers, fresh and existing profiles, persistent
local choices and normal workflow execution. This fixture changes stored setup,
not the shipped application or its validation.

## Scenario scope

Palette scenarios check persistence in both themes, then resize the same page
to check mobile keyboard navigation, colors and layout. Storage behavior does
not depend on viewport width, so mobile checks do not repeat the reload matrix.
Each palette still has an isolated scenario; recovery and migration failures
remain separate. Initial selections check real Tab entry, while repeated
persistence selections focus the checked radio before using native arrow keys.

The node-clearance normalization scenario checks its input table in one browser
session. Every row replaces the complete saved defaults, reloads the application,
and checks the controls, persisted defaults and absence of workflow documents.
Failures identify the input row and retain the original error as their cause.

History browsing checks share one seeded history: inspect and close it, select
versions with the keyboard, then select and edit an earlier version. The keyboard
check returns to the latest commit before the editing checks begin. Interrupted
checkout, fork, undo and redo recovery remain separate scenarios.

Custom-property scenarios follow creation through mapping, reload, rename and
removal, and scalar/object creation through nested fields and type changes.
They reuse the graph while retaining cancellation, duplicate-name, history,
field-identity and layout assertions at each relevant stage.

Passing scenarios rely on DOM, behavior and persistence assertions rather than
uncompared screenshot files. Failure hooks retain screenshots, diagnostics and
full traces; add image comparisons explicitly if a future test needs visual
regression coverage.

## Execution boundary

Run `npm run build` before `npm run test:browser`. The
[runner](../../.github/scripts/test-browser.sh) uses the matching pinned
Playwright container with networking disabled. Support serves `dist/index.html`
and the exact favicon allowlist with their declared MIME types on loopback,
creates a fresh browser context for each scenario, and rejects
unexpected external requests. Simulate endpoint responses through test routes;
keep test hooks out of the shipped application.

Chromium remains the default. An unfiltered `npm run test:browser` also runs the
Svelte component suite afterward, in the same container. Focused selections run
only their selected application cases:

```sh
npm run test:browser -- tests/browser/workflow-file.feature -t 'upload'
BROWSER_ENGINE=firefox npm run test:browser -- --tags @vault-browser-kdf
```

Firefox and WebKit are opt-in and exclude `@chromium-only` cases. Each engine has
its own JSON, blob and proof filenames; another run of that engine replaces them.
Filtered or stale results cannot supply complete release evidence.

Local containers use one browser worker, 2 CPUs and 2 GiB, without extra swap.
GitHub Actions uses two workers within 2 CPUs and 4 GiB. Inspect host headroom
before increasing a development budget.

The error-history fixture runs the real IndexedDB store and recording worker on
an isolated test page. Its scenarios cover multi-tab deduplication, FIFO eviction,
transaction rollback, blocked storage and bounded recording; UI cases also open
the Errors view in the built application. Fixture routes are test-server-only.

Vault fixtures exercise the real IndexedDB/Web Locks adapters, worker schema
policy and bounded Fetch responses against isolated loopback endpoints. The KDF
worker checks pinned reference bytes and the application's nonextractable key
under a restrictive CSP. Vault UI cases use the built application, including
recovery-key presentation, lock/unlock and encrypted vault import. Native WebAuthn
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

## Runtime and test boundaries

Use Vitest scenario and Gherkin step durations to separate expensive assertions from repeated setup.
Compare the same scenarios, browser image, worker count and resource limits before
and after a change. Summed scenario time overlaps when workers run in parallel;
it is not the suite's wall-clock duration.

List the slowest scenarios from a completed report, including their setup:

```sh
jq '[.testResults[] | .name as $file | .assertionResults[] |
  {file: $file, name: .title, seconds: (.duration / 1000)}] |
  sort_by(.seconds) | reverse | .[:10]' tmp/test/vitest-browser-chromium.json
```

### Palette navigation

Palette checks retain every palette, both themes and desktop/mobile layouts.
Native keyboard navigation takes the shorter wrapped route in Chromium and
Firefox; WebKit takes the direct route because its radios stop at group ends.
Retryable accessibility and DOM snapshots check all computed accessible names,
enabled states, selections and swatch colors instead of sending one assertion
per option.

### Resource measurements

Storage scenarios tagged `@immediate-page-memory` supply only the unrelated
page-memory measurement. Their browser storage estimates, IndexedDB databases,
Git history, recorder worker and UI remain real. The untagged native-storage
scenario retains the browser's own memory-measurement path. Do not apply this
fixture to tests of memory collection, timeouts or recorder scheduling.

### Startup setup

Shared setup waits for real startup and canvas restoration before finishing
the loader animation. This skips only the presentation delay, runs its native
removal and gutter-cleanup callback, and leaves startup-specific scenarios alone.
It does not advance application clocks or bypass initialization.

### Shared fixture bundles

`tests/browser/run.mjs` delegates to the shared Gherkin launcher. It prepares the
five standalone bundles once per invocation, before starting workers; fixture
builds remain serial to bound peak memory. Workers read the shared file under
`tmp/test/browser/`.

The pinned Docker command uses this entry point. In a prepared Playwright
environment, run `node tests/browser/run.mjs` with feature paths, `--tags` or `-t`.
Browser step modules stay native so serialized `page.evaluate()` callbacks do not
contain Vite's Node helpers.

### Worker ownership

Vitest's automatic worker fixture owns shared browsers, HTTP servers and
registered development-server cleanup. Each scenario owns a fresh context.
Cleanup does not depend on a predicted feature count; tag and name filters keep
the same lifetime rules. Aborting a scenario closes its contexts before later
work continues, while failed cleanup still fails validation.

### Fixture-only entry pages

Storage, network, policy and KDF vault tags, `@error-history-storage` and
`@error-history-recorder` start on their isolated HTML fixture.
`@coverage-report` starts on a blank page until its generated report is ready.
`@legacy-smoke` similarly lets each migrated lifecycle case create its own page.
These cases do not initialize and discard the full application first. Shared
setup still creates a fresh context and installs the same request guards,
diagnostics and tracing. Fixture steps seed their own data;
explicit reloads and additional-tab navigation remain part of their tests.

UI and startup scenarios keep the built application entry page. When adding a
fixture-only tag, ensure every scenario carrying it works without application
workers, settings or databases left behind by startup.

### Saved graph setup

Use `workflow-graph.fixture.mjs` for cases that start with existing operations.
It generates real schema panels and uses the application’s import and autosave
paths, including Git/IndexedDB persistence. Import assigns a fresh document ID;
identity and history fixtures must retain repository setup. This avoids repeated
catalog insertion and startup reloads. Fixture geometry uses estimated
dimensions; dedicated catalog scenarios retain measured insertion layout,
automatic reveal and creation checks.

Keep explicit reloads when testing persistence. Pointer gestures, mapping,
snapping, rendering and subsequent saves still run through the real application.

### Focused fixtures

Vault UI setup creates a vault and one encrypted credential. The creation and
management scenario additionally checks copying, cancellation and key rotation;
other cases keep fresh contexts and the production password-derivation costs.

History setup creates real isolated Git repositories. Only editor scenarios open
a saved workflow. Reloads belong to the cases that explicitly verify recovery or
persistence, rather than every shared setup.

Palette persistence checks inspect every preview and accessible choice in both
theme modes. Repeated selection and reload checks verify the selected radio,
active colors and durable settings without rescanning every unrelated preview.

Wait for observable saves where possible. Keep bounded real-time waits when the
assertion proves that an unfinished edit or deleted workflow does **not** save;
immediate assertions or success polling cannot establish that absence.

### Preserved checks

Keep fresh contexts, production password-derivation costs, traces, diagnostic
checks and durable-storage assertions. Reduce repeated work and irrelevant
external waits before increasing parallelism or replacing integration behavior.

## Scenario state and diagnostics

Scenarios run in parallel, so keep mutable state in the scenario World or its
fixtures. Failure diagnostics, screenshots and traces belong in
`tmp/test/browser/`; Vitest JSON, blobs and execution proofs belong in `tmp/test/`.
Report attachments retain screenshots and trace downloads after job transfer. See the
[workflow guide](../../.github/workflows/README.md#local-validation) for setup
and complete report generation.
