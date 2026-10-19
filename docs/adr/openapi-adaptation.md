# OpenAPI adaptation

> [!IMPORTANT]
> OpenAPI documents define the application’s available operations and the input and response models of its workflow nodes.

## API contract

The browser-local schema library supplies operations for navigation, matching,
reports and workflow execution. HTTP operation nodes and their connected data
panels derive inputs and responses from the same document, preserving the API
contract. Utility nodes retain application-defined models.

Run forms expose field information and separate omission from explicit `null`.
Optional fields can be excluded without losing their drafts. Null is available
only when the schema allows it, independently of whether the field is required;
connected workflow values remain authoritative. OpenAPI 3.0 `nullable` and 3.1
types containing `null` retain that distinction through request validation.
Form-encoded bodies continue to require primitive non-null values.

Users choose which documents are enabled. Changes update the active registry
without rewriting saved workflows. Compatibility is checked before operations
become available; parsing, validation and repository work run in dedicated workers.

## Schema library

### Document management

**Settings → Schemas**, subtitled “Manage your OpenAPI documents”, supports JSON
and YAML upload, renaming, enablement, replacement, normalized JSON download and
confirmed deletion. Settings sections remain alphabetically ordered. Full source
editing and remote Git integration are outside this version.

The name is always editable; changes save on blur. Renaming changes only
`info.title` and creates a descriptive commit in the existing repository,
preserving its ID and other content.

### Document inspection

Cards show the complete document in the same read-only JSON viewer as operation
reports, with collapsible scopes, line wrapping and copying. The viewer renders
on first expansion, even for disabled documents. Each opening exposes paths and
HTTP methods while folding operation bodies and other nested fields. Viewing
changes neither content nor Git history.

### Default service library

Reviewed service schemas ship as compressed, integrity-checked local packs. Startup
adds missing defaults to existing profiles without replacing authored documents.
Installation records survive deletion, so deleted defaults stay deleted.

Unmodified defaults follow bundled revisions while retaining enablement and order.
Renaming, replacing or requesting history materializes a Git copy; subsequent
bundled revisions do not overwrite that copy. Display names can identify a provider
without rewriting its upstream document title. Examples retain their existing
once-only seeding behavior.

### Available operations

Bundled examples seed once, preserving the `demo` and `httpbin` IDs and authored
navigation groups. Deleting every document does not reseed them. Schema
repositories load before workflows are restored.

Successfully loaded, enabled documents replace the registry atomically, updating
navigation, matching and reports immediately. Removed or disabled operations
cannot execute, but saved workflow references keep their IDs and can work again
when the same document is enabled. Replacement retains IDs; changed or removed
endpoints remain subject to execution validation.

## Persistence

### Repository identity

Each document has an immutable ID. Authored documents have their own Git repository at
`/repositories/<id>` in LightningFS `v1/catalogs`. Different files receive distinct
IDs even when filenames match. The predictably formatted `schema.json` working
file is authoritative persisted content.

Import creates the first commit; replacement commits to the same repository.
Identical content adds no commit. Historical reads use immutable Git blobs
without changing the working file.

### Metadata and recovery

`v1/catalogs/index` stores document metadata, repository paths, enablement,
initialization state and recovery journals, not another editable schema copy.
Enablement remains outside Git.

A serialized queue and browser lock protect writes across tabs. Immutable Git
objects are flushed before publishing a recovery journal, allowing the working
file, index, branch reference and metadata to be finalized after interruption.
Deletion records a tombstone before removing only the selected repository and
metadata. Saved workflows remain untouched.

### Card ordering

Cards slide into a local preview during dragging. Dropping before or after
another card saves the order; cancellation restores the original arrangement.
Order lives in the metadata database's `state` store, outside schema documents
and Git history.

Moves resolve the latest order under the same browser lock; dropping in the
existing position causes no write. New documents append, deletion removes their
entries, and older metadata without a saved order falls back to creation time
and stable ID.

## Validation

### Documents and server URLs

Uploads are limited to 10 MiB and compatible OpenAPI 3.0/3.1 documents. Validation
covers metadata, JSON-compatible YAML values, references, operation identities,
executable inputs and server URLs before persistence. Execution limitations are
reported explicitly; unsupported operations are not silently omitted. External
references are not fetched.

Effective HTTP(S) server URLs honor document, path and operation overrides and
server-variable defaults. Joining paths preserves the server base path and
rejects authority changes or traversal. These checks establish application
compatibility, not general OpenAPI conformance.

### Reviewed service compatibility

Bundled services retain their complete source documents and operation inventory.
Supported constraints produce typed controls; advanced JSON Schema rules use a
JSON input with an explicit notice that the API performs that validation.
Unsupported authentication, serialization or transports remain visible with an
execution limitation instead of disappearing from navigation.

OAuth access tokens use bearer transport, retaining declared scopes in the
approved-operation identity. This does not implement OAuth login or token refresh.
AWS Signature Version 4 signing is unsupported. Browser CORS, local-network access
and the API's own authorization rules still apply.

### Failure handling

Validation and storage failures retain the document list and show actionable
errors in Schemas. Failed initial loading blocks mutations until retry succeeds.
Cache or fallback data is never imported into a repository automatically.

Browser tests cover startup, persistence, active operations, replacement history,
isolation, deletion, invalid input and retry.

## Workflow projection

### Inputs

Parameter panels group fields by OpenAPI location. Operation-level parameters
override path-level parameters with the same name and location. Request bodies
use the selected media type. Nested objects and arrays form connected panels with
schema-derived names, types and required markers. Unknown or undocumented
structure remains explicit; no schema is invented.

### Response model

New HTTP nodes expose one response object per documented status and
representation, containing **Status**, **Status message**, **Response body** and
**Response headers**. Body schemas and documented headers supply nested fields.
Responses without content have a null body; missing schemas remain unknown.

This envelope wraps the OpenAPI response; it does not add a level inside the
API's response body.

### Execution

Execution retains the actual status, status message, readable headers and parsed
body. Empty status messages stay empty. Header lookup is case-insensitive;
documented values are decoded for typed mappings, while undeclared headers stay
text. Failed requests retain response metadata and remain retryable.

Header serialization follows the workflow runner's supported
[OpenAPI Header Object](https://spec.openapis.org/oas/v3.1.0.html#header-object) rules.

### Saved workflow compatibility

Response field identities use `response:<status>[:media]` and JSON pointers into
the response object. Legacy `output:<status>[:media]` fields remain body-rooted,
preserving existing mappings. Saved graphs and Git snapshots are not regenerated
from changed documents; newly added HTTP nodes use the response layout.
