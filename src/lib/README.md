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
| `workflow-document`, `workflow-graph`, `workflow-layout`, connection helpers | Persisted graph validation and editor projection |
| [`flow-routing`](flow-routing/README.md), `workflow-routing*` | Measured orthogonal edge geometry, synchronized dashes and its dedicated worker adapter |
| `workflow-runner`, `workflow-execution`, `workflow-response`, `operation-*` | Execution, typed inputs, response mappings and reports |
| `workflow-repository*`, `workflow-change-message` | Autosave, recovery, history navigation and commit descriptions |
| `metrics-*`, `storage-metrics`, `page-memory`, `processing-metrics` | Resource measurement, aggregation and display data |
| `app-settings`, locale/date helpers, `storage-*`, `startup-*` | Preferences, storage lifecycle and startup coordination |
| [`cursors`](cursors/README.md) | Embedded cursor artwork, theme colors and native cursor fallbacks |

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

## Worker boundaries

Page code reaches persistence through `schema-library.ts`,
`workflow-repository-client.ts` and `metrics-recorder.ts`. Their persistent workers
use inline bundling; keep heavy parsing, repository work and aggregation there.
Window-only measurements cross an asynchronous bridge. Preserve native error
causes and worker cleanup when changing [worker boundaries](../../docs/adr/dedicated-workers.md).

## Operation registry

Update catalog operations and their registry together through the publication
functions in `catalog.ts`. Enabled schemas may change without rewriting saved
workflow references; preserve identities and validate execution against available
operations. See [OpenAPI adaptation](../../docs/adr/openapi-adaptation.md).

## Verification

Add new domain scenarios alongside [source](../README.md) using Cucumber.
[tests](../../tests/README.md) contains browser scenarios and remaining standalone
checks.
