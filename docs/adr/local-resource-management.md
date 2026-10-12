# Application content is versioned in separate browser-local Git repositories to preserve independent change histories

## Decision

Content that must change and restore together forms one versioned unit. Each unit has its own browser-local Git repository, so saving or restoring one does not change another's history. The model covers workflow graphs, uploaded OpenAPI documents and recorded resource aggregates; new content types can adopt it without sharing unrelated histories.

Repository working files are the authoritative persisted content, and Git commits are historical snapshots. isomorphic-git receives a LightningFS filesystem and repository directory explicitly. LightningFS owns its IndexedDB persistence; application code uses its public filesystem APIs. Separate application databases, accessed through `idb`, hold catalogue and recovery metadata rather than another independently editable content copy. Application settings in `v1/settings` and non-versioned editor state remain outside Git.

This separates versioning from storage and keeps history boundaries aligned with application content. It also requires coordinated writes: serialize mutations, protect them across tabs with Web Locks, and recover interrupted changes before accepting new ones. Read historical content from Git blobs without checking out or modifying the working files. Run substantial repository work in [dedicated workers](dedicated-workers.md).

## Repository boundaries

Database names are slash-separated namespaces, not physical directory trees:

| Content | LightningFS database and repository | Working content | Application metadata |
|---|---|---|---|
| Workflow graph | `v1/workflows`, `/repositories/<id>` | `workflow.json` | `v1/workflows/index` |
| OpenAPI document | `v1/catalogs`, `/repositories/<id>` | `schema.json` | `v1/catalogs/index` |
| Completed resource aggregates | `v1/metrics`, `/metrics` | One immutable JSON file per 15-minute interval | No separate catalogue |

Each workflow and schema has a stable identifier; display names and uploaded filenames do not select repository paths. Resource intervals belong to one aggregate history rather than one repository per sample. See [schema management](openapi-adaptation.md#persistence-and-recovery) and [resource monitoring](resource-monitoring.md) for their specific write and retention rules. Undo and Redo are workflow features, not requirements imposed on every repository type. Remote transport, credentials, synchronization and general branch-management controls remain outside this decision.

## Workflow snapshots and autosave

Each workflow repository contains `.git/` and `workflow.json`. Serialize validated content with two-space JSON indentation and a trailing newline, preserving array order. Names, descriptions, nodes, node positions, edges and their operational configuration belong in the versioned unit. Viewport, grid snapping and connection appearance are editor preferences stored outside Git, along with undo/redo navigation state. Selection and measured DOM dimensions remain transient.

The separate `v1/workflows/index` IndexedDB database, accessed through `idb`, holds the workflow catalogue (`id`, `name`, `repositoryPath`) and editor metadata. It does not hold a second independently editable workflow copy. IndexedDB schema versions, the existing workflow document format versions and Git commit IDs have distinct purposes.

Autosave captures one snapshot per completed edit and serializes write/stage/commit work per repository. Structural actions are captured immediately, even while a preceding save is in progress. Typing is grouped until the field loses focus; dragging is grouped until the node is dropped. Explicit saves, leaving the workspace and page visibility changes flush unfinished edits. Preference-only changes are debounced and do not add Git commits.

Retain an unacknowledged save attempt with its exact snapshot and expected revision. If catalogue finalization fails after Git commits, retry that same attempt before saving a newer draft; accepting the current repository head blindly would bypass stale-editor protection. Keep the newer editor draft intact during recovery. Expected revisions detect stale editors. Cross-tab Web Locks protect repository mutations; unsupported browsers report a storage error instead of writing unsafely. Recovery metadata must not become a duplicate content store.

A new draft's first save records its initial state before its first edit, so the first added node can be undone without creating saved entries for untouched drafts.

Automatic commit messages describe the diff against the actual parent snapshot: named node additions, removals and moves, named connection endpoints, workflow details and node configuration changes. Group generated data panels with their owning operation when adding or removing it. Compute the message inside the repository write lock so queued edits and edits after Undo compare against the right parent. Keep explicit import and restore messages. For existing commits whose message is exactly `Update workflow`, derive the displayed description from immutable commit blobs; do not rewrite commits, references or working files.

## Workflow history navigation

Undo, Redo and selecting a history card move `main` between existing commits and update the working file and index without creating another commit. HEAD remains attached to `main`. A private `refs/workflow/redo` reference preserves the future while undone, including across reloads. Selecting an ancestor retains its future for Redo; selecting a different branch preserves any otherwise unreachable current or redo future on the next available `stash-N` branch. A content edit after navigating back preserves that future on a `stash-N` branch and creates a new commit on `main`, whose parent is the selected version. These are ordinary Git branches, not Git stash objects. Preference-only or unchanged saves retain the redo path. The repository's explicit Restore API still creates a new commit and retains existing history, but history-card navigation does not call it.

History merges `git.log()` results reachable from `main`, preserved branches and the redo reference, deduplicated and ordered with children before parents. The dialog draws actual parent relationships and marks the current version; branch names and commit hashes are not displayed. Each complete title-and-date card is a keyboard-accessible button that selects its existing commit. Keep the dialog open and update the current-version marker after selection; disable navigation while it is pending. There is no separate Restore version or preview button. Opening history does not alter the working tree.

## Workflow recovery and document compatibility

A recovery journal distinguishes new commits from navigation. It records the intended revisions, next navigation state and any reserved branch name before mutating repository state. Commit creation uses a fixed parent, timestamp and unique `Workflow-Change` message trailer so retries cannot manufacture duplicate versions. The trailer distinguishes separate edits that recreate identical content from the same parent within one second, while keeping real timestamps; the UI omits it from the readable message. Catalogue updates and journal removal finish in one application database transaction. Older pending saves finish before navigation metadata migrates; migration preserves every legacy commit and rebuilds navigation from the existing first-parent history.

Workflow startup does not read, import or remove legacy localStorage workflow collections. Repository reads and JSON imports use `migrateWorkflowDocument` as the entry point for future migrations keyed by document version. It currently validates supported formats without converting them; reads do not rewrite working files or historical Git commits. Future persisted format upgrades must preserve history and remain retryable. Palette and light/dark settings use a separate application settings IndexedDB database, outside Git; their legacy localStorage keys migrate on startup. Existing JSON import/export and nested workflow snapshot formats remain supported.

IndexedDB persistence is asynchronous. The editor awaits saves before changing workflows or workspace. It starts a best-effort save when hidden, and requests an unload confirmation while changes remain unsaved. Do not claim that starting a write during `beforeunload` makes it durable. Storage errors leave the draft available for retry/export.

## Storage namespace migrations

Before application consumers start, a serialized namespace migration copies legacy application stores transactionally and filesystem content through public LightningFS APIs, including all Git objects, refs, working files and recovery journals. Completion markers prevent repeated imports from overwriting subsequent edits; interrupted copies can retry before destination consumers start. Once all copies finish, exact completion markers authorize removal of the retired databases and their obsolete LightningFS lock databases. Cleanup also handles backups left by the earlier migration and can retry after blocked deletion; an unverified destination never authorizes removal. Migration and cleanup refuse to proceed while another tab holds the recorder lock: close other app tabs before switching namespaces. Suspended or older tabs must also be reloaded before further editing; this is not synchronization between old and new database names.

Reference APIs: [isomorphic-git](https://isomorphic-git.org/docs/en/quickstart), [LightningFS](https://github.com/isomorphic-git/lightning-fs), and [idb](https://github.com/jakearchibald/idb).
