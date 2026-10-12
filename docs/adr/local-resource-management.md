# Local resource management

> [!IMPORTANT]
> Application content is versioned in separate browser-local Git repositories to preserve independent change histories.

## Versioning model

Content that changes and restores together forms one versioned unit with its own
Git repository. Workflows, uploaded OpenAPI documents and resource aggregates
have independent histories; new content types can follow the same model.

Working files are authoritative persisted content; commits are historical
snapshots. isomorphic-git receives an explicit LightningFS filesystem and
repository path. LightningFS owns its IndexedDB persistence; application code
uses its public filesystem APIs. Separate `idb` databases hold catalogue and
recovery metadata, not independently editable content copies. Settings and
non-versioned editor state remain outside Git.

Repository mutations are serialized and protected across tabs with Web Locks.
Interrupted changes recover before new mutations begin. Historical reads use Git
blobs without changing working files; substantial repository work runs in
dedicated workers.

## Repository boundaries

Database names are slash-separated namespaces, not directory trees:

| Content | LightningFS database and repository | Working content | Application metadata |
|---|---|---|---|
| Workflow graph | `v1/workflows`, `/repositories/<id>` | `workflow.json` | `v1/workflows/index` |
| OpenAPI document | `v1/catalogs`, `/repositories/<id>` | `schema.json` | `v1/catalogs/index` |
| Completed resource aggregates | `v1/metrics`, `/metrics` | One immutable JSON file per 15-minute interval | No separate catalogue |

Stable workflow and schema IDs determine repository paths, independently of
display names or uploaded filenames. Resource intervals share one aggregate
history. Undo and Redo are workflow features, not requirements for every content
type. Remote transport, credentials, synchronization and general branch controls
are outside this decision.

## Workflow persistence

### Content and metadata

Each repository contains `.git/` and `workflow.json`. Validated snapshots use
two-space JSON indentation, a trailing newline and preserved array order.
Names, descriptions, nodes, positions, edges and operational configuration are
versioned together. Viewport, snapping, connection appearance and navigation
metadata remain outside Git; selection and measured DOM dimensions are transient.

`v1/workflows/index`, accessed through `idb`, stores the catalogue (`id`, `name`,
`repositoryPath`) and editor metadata, not a second editable workflow copy.
IndexedDB schema versions, workflow document versions and commit IDs serve
distinct purposes.

### Completed edits

Autosave creates one snapshot per completed edit and serializes writing, staging
and committing per repository. Structural edits are captured immediately, even
while an earlier save runs. Typing completes on blur; dragging completes on drop.
Explicit saves, leaving the workspace and page visibility changes flush pending
edits. Preference-only changes are debounced without creating commits.

A new draft's first save records its state before the first edit. This makes the
first added node undoable without saving untouched drafts.

### Concurrency and failed saves

Expected revisions detect stale editors. Unacknowledged save attempts retain
their exact snapshot and expected revision. If catalogue finalization fails after
a commit, recovery retries that attempt before saving a newer draft. The current
head is not accepted blindly, and the newer draft remains intact. Recovery
metadata is not a duplicate content store. Browsers without Web Locks report a
storage error instead of writing unsafely.

### Commit descriptions

Messages describe changes against the actual parent: named node additions,
removals and moves, connection endpoints, workflow details and configuration.
Generated data panels are grouped with their owning operation when added or
removed. Messages are computed inside the write lock so queued edits and edits
after Undo compare against the correct parent. Import and restore messages remain
explicit.

For legacy commits named exactly `Update workflow`, the display derives a useful
description from immutable blobs without rewriting commits, refs or working files.

## Workflow history

### Navigation and branching

Undo, Redo and history-card selection move `main` between existing commits and
update the working file and index without creating a commit. HEAD stays attached
to `main`. The private `refs/workflow/redo` reference preserves the future across
reloads.

- Selecting an ancestor retains its future for Redo.
- Selecting another branch preserves any otherwise unreachable current or redo
  future on the next available `stash-N` branch.
- Editing after navigating back preserves that future on `stash-N` and commits
  on `main`, with the selected version as parent.
- Preference-only or unchanged saves retain the redo path.

These are ordinary branches, not Git stash objects. The explicit Restore API
creates a new commit while retaining history; history cards do not call it.

### History view

History combines `git.log()` results from `main`, preserved branches and the redo
reference, deduplicated with children before parents. The dialog shows actual
parent relationships and the current version, hiding branch names and hashes.

Each title-and-date card is a keyboard-accessible button selecting its existing
commit. Selection updates the marker without closing the dialog; navigation is
disabled while pending. Opening history leaves the working tree unchanged.
There are no separate restore or preview buttons.

## Recovery and compatibility

### Recovery journal

Before mutation, the journal distinguishes commits from navigation and records
intended revisions, next navigation state and reserved branch names. A fixed
parent, timestamp and unique `Workflow-Change` message trailer make commit retries
idempotent. The trailer distinguishes separate, identical edits from the same
parent within one second without altering real timestamps; the UI hides it.

Catalogue updates and journal removal complete in one database transaction.
Older pending saves finish before navigation metadata migrates. Migration
preserves all legacy commits and rebuilds navigation from first-parent history.

### Document formats

Workflow startup does not read, import or remove legacy localStorage workflow
collections. Repository reads and JSON imports pass through
`migrateWorkflowDocument`, the entry point for versioned migrations. It currently
validates supported formats without converting them or rewriting working files
and historical commits.
Future persisted upgrades must preserve history and remain retryable. Existing
JSON import/export and nested workflow snapshots remain supported.

Palette and light/dark settings belong to `v1/settings`, outside Git; their legacy
localStorage keys migrate separately on startup.

### Pending writes

The editor awaits saves before changing workflows or workspace. Hiding the page
starts a best-effort save; unsaved changes require an unload confirmation.
Starting asynchronous IndexedDB work during `beforeunload` does not guarantee
durability. Storage errors retain the draft for retry or export.

## Storage namespace migration

### Copy and verify

A serialized migration runs before consumers start. It copies application stores
transactionally and filesystem content through public LightningFS APIs, including
Git objects, refs, working files and recovery journals. Completion markers prevent
repeated imports from overwriting later edits; interrupted copies retry before
destination consumers start.

### Retire old databases

Only after all copies finish do exact completion markers authorize deleting
retired databases and their obsolete LightningFS lock databases. Cleanup also
handles earlier migration backups and retries blocked deletions. An unverified
destination never authorizes removal.

Migration and cleanup stop while another tab holds the recorder lock. Other app
tabs must close before namespaces change; suspended or older tabs must reload
before further editing. This does not synchronize old and new namespaces.

Reference APIs: [isomorphic-git](https://isomorphic-git.org/docs/en/quickstart),
[LightningFS](https://github.com/isomorphic-git/lightning-fs), and
[idb](https://github.com/jakearchibald/idb).
