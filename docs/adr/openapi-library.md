# OpenAPI documents define the application’s available operations and are managed through a browser-local schema library

## Decision

The schema library is the source of available operations for navigation, matching, reports and workflow execution. Users manage OpenAPI documents locally and choose which are enabled. Changes to the enabled library update the active operation registry without rewriting saved workflows.

This makes operation discovery and execution follow the same documents while allowing users to replace or disable an API independently. Documents follow the [application content versioning model](browser-git-versioning.md); parsing, validation and repository work run in [dedicated workers](dedicated-workers.md).

## Document management

Settings exposes **Schemas** with the subtitle “Manage your OpenAPI documents”. Users can upload JSON or YAML, rename a document, enable or disable it, replace it, download normalized JSON, and explicitly confirm deletion. The name field is always editable and saves changed names on blur. Renaming updates the document's `info.title` and records a descriptive commit in its existing repository; its ID and other content remain unchanged. The section follows the alphabetical settings order. Full source editing and remote Git integration are outside this first version.

Each card also exposes the complete document through the same read-only JSON viewer used in operation reports, including collapsible scopes, line wrapping and copying JSON. The viewer renders on first expansion, including for disabled documents. Each opening shows the paths and HTTP methods with operation bodies and other nested fields folded. Viewing does not change the document or its Git history.

## Persistence and recovery

Each document has an immutable identifier and an independent Git repository at `/repositories/<id>` in the shared LightningFS filesystem `v1/catalogs`. The repository contains one predictably formatted `schema.json`; working files are the authoritative persisted documents. Import creates the first commit, replacement adds a commit in the same repository, and identical content creates no extra commit. Historical reads use Git blobs and do not modify the working file. Different files, even with the same filename, receive different repository IDs.

The separate `v1/catalogs/index` IndexedDB database stores document metadata, repository paths, enablement, initialization state and recovery journals. It does not store another editable copy of a schema. Enablement is application state outside Git. A serialized queue and browser lock protect repository writes across tabs. Immutable Git objects are flushed before publishing a recovery journal; the working file, index, branch reference and metadata can then be finalized after an interrupted save. Deletion records a tombstone before removing only the selected repository and metadata. Saved workflow documents remain untouched.

Schema cards can be reordered by dragging a card before or after another. Cards slide into a local preview as the pointer moves; only dropping saves that order, while cancellation restores the original arrangement. Their order lives in the metadata database's `state` store, separately from schema documents and Git history. Moves resolve the latest order under the same browser lock; dropping a card in its existing position adds no write. New documents append, deletion removes their order entries, and older metadata without an order falls back to creation time and stable ID.

## Available operations

Seed the bundled examples only once, preserving their `demo` and `httpbin` IDs and authored navigation groups. Deleting all documents must not reseed them. Load schema repositories before restoring workflows. Successfully loaded, enabled documents replace the active registry atomically and immediately update navigation, matching and reports. Removed or disabled operations are unavailable for future execution; existing workflow references retain their IDs and can work again when the same document is enabled. Replacement retains IDs but changed or removed endpoints remain subject to workflow execution validation.

## Validation and failures

Uploads are limited to 10 MiB and must be compatible OpenAPI 3.0/3.1 documents. Validate metadata, JSON-compatible YAML values, references, operation identities, executable inputs and server URLs before persisting. Existing execution limitations are reported explicitly rather than silently dropping unsupported operations. No external references are fetched. Effective HTTP(S) server URLs honor document, path and operation overrides and server-variable defaults. Joining operation paths preserves the server base path and rejects authority changes or traversal. This validation checks application compatibility; it is not a general-purpose OpenAPI conformance validator.

Validation and storage failures retain the current document list and show an actionable error in the section. Failed initial loading disables document mutations until a retry succeeds. Cache/fallback data is never imported into a repository automatically. Browser tests cover startup, persistence, active operations, replacement history, isolation, deletion, invalid input and retry.
