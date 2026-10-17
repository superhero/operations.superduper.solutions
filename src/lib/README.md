# Application logic and browser services

Keep reusable domain behavior and browser services here; workspace rendering
belongs in [feature components](../components/README.md), while reusable Svelte
controls belong in [components](components/README.md). `$lib` resolves to this
directory. Prefer a focused module beside its related responsibility over adding
unrelated behavior to `utils.ts`.

## Responsibility boundaries

| Module group | Owns |
| --- | --- |
| `catalog*`, `schema-documents`, `schema-library*`, `schema-storage` | OpenAPI compatibility, active operations, schema management and persistence |
| `matching`, `operation-matching*` | Local operation ranking and cancellable background evaluation for the catalog prompt |
| `workflow-document`, `workflow-graph`, `workflow-layout`, connection helpers | Persisted graph validation, operation schema projection and inferred file-output structures |
| [`flow-routing`](flow-routing/README.md), `workflow-routing*` | Measured orthogonal edge geometry, synchronized dashes and its dedicated worker adapter |
| `workflow-file*` | Bounded JSON/CSV uploads, dialect options, typed file data and disposable parsing workers |
| `workflow-runner`, `workflow-execution`, `workflow-response`, `operation-*` | Execution, typed inputs, response mappings and reports |
| `workflow-repository*`, `workflow-change-message` | Autosave, recovery, history navigation and commit descriptions |
| [`secrets`](secrets/README.md), `operation-security` | Encrypted credentials, approved execution, unlock methods and OpenAPI authentication requirements |
| `metrics-*`, `storage-metrics`, `page-memory`, `processing-metrics` | Resource measurement, aggregation and display data |
| `error-diagnostics`, `error-capture`, `error-history*` | Bounded diagnostic snapshots, runtime observation, queued recording and atomic error retention |
| `app-settings`, locale/date helpers, `storage-*`, `startup-*` | Preferences, storage lifecycle and startup coordination |

## Persistence

Workflow and schema working files are authoritative browser-local content, backed
by separate LightningFS Git repositories. Metadata databases hold indexes,
preferences and recovery journals, not editable content copies. Database names
come from `storage-names.ts`; namespace changes require the verified migration
path. Preserve serialized writes, Web Locks, expected revisions and interrupted
write recovery. Follow [local resource management](../../docs/adr/local-resource-management.md)
for history semantics and content-versus-editor-state boundaries.

## Settings and caches

Settings live outside Git. `appearance-cache.ts` is only a startup hint refreshed
from successful settings operations. `metrics-cache.ts` supplies display previews,
never new measurements or persisted history. Neither cache authorizes restoring
content into authoritative stores after a failure.

Error history lives outside Git in `v1/errors`: keep the 1,000-entry FIFO bound
and deduplication in the same transaction. The recorder must never report its
own failures through the diagnostics it subscribes to. Worker failure capture
is disabled for that recorder to prevent recursion. The secret worker also uses
its own safe error protocol to prevent credential-bearing native errors from
entering diagnostics; useful unrelated UI and console errors remain intact.

## Worker boundaries

Page code reaches persistence through `schema-library.ts`,
`workflow-repository-client.ts` and `metrics-recorder.ts`. Their persistent workers
use inline bundling; keep heavy parsing, repository work and aggregation there.
Window-only measurements cross an asynchronous bridge. Preserve native error
causes and worker cleanup when changing [worker boundaries](../../docs/adr/dedicated-workers.md).

Operation matching sends only operation names and identifiers to its disposable
worker. Each new prompt aborts the previous calculation, including its worker;
completed scores are paired with the original operations on the page.

## Operation registry

Update catalog operations and their registry together through the publication
functions in `catalog.ts`. Enabled schemas may change without rewriting saved
workflow references; preserve identities and validate execution against available
operations. See [OpenAPI adaptation](../../docs/adr/openapi-adaptation.md).

## Verification

Add new domain scenarios alongside [source](../README.md) using Cucumber.
[tests](../../tests/README.md) contains browser scenarios and smoke scripts
awaiting migration into browser reporting.

File row execution caches immutable projections per validated file node. Reuse
those projections across row frames; do not repeatedly clone entire CSV columns
for scalar requests or combine independent files as a Cartesian product.
