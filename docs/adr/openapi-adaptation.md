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
without rewriting saved workflows. Discovery and executable models are separate;
parsing, validation and repository work run in dedicated workers.

## Discovery and execution

Startup reads metadata and compact indexes for enabled schemas. Disabled sources
are not decoded, inspected or hashed merely to list their cards. Reviewed bundled
indexes are generated from the complete source and bound to its digest and adapter
revision. User imports generate an equivalent index from validated content.

Descriptors retain operation identity, name, method, path, grouping and execution
limitations. They cannot prepare or execute a request. Adding, restoring or running
a workflow loads its canonical operation models and their local-reference closure.
Current source identity and enablement are checked before publishing a model.
Credential policy is derived from authoritative content, never a discovery index.

Workflow restoration groups missing models by schema and source identity, with
at most 16 operations per request. Overlapping loads share pending models.
The worker shares source materialization, descriptor lookup and one policy
transaction per batch; every operation retains its own canonical adaptation,
reference closure and fingerprint. A failed batch publishes no new policies.
Disabled or changed sources reject obsolete requests, and the page checks source
identity again before installing returned models.

Metadata changes publish only changed catalogs and active IDs. Alphabetical
ordering does not rebuild matching inputs or revoke unchanged credential policy. Decoded
sources use a bounded cache; models used by the current workflow or run remain
pinned. Size accounting limits retention, not exact JavaScript heap consumption.
Active workflows may require more models than the cache budget permits to retain
when idle.

Closed settings sections construct their controls on demand and release them
after their closing transition, including when the entire drawer closes. The
Browser indicator stays mounted while its dashboard is released. The parent retains saved settings and Application numeric drafts;
canonical source storage and ongoing application services remain independent of
these controls. This avoids maintaining schema-card tooltip listeners while the
Schemas section is closed.

Search normalization reuses unchanged schema descriptors. The navigation shares
one tooltip controller for its rows and uses browser-managed offscreen rendering
through `content-visibility: auto`. Real buttons remain in the DOM to preserve
hierarchy, accessible names, native Tab order and focus-driven scrolling. This
limits rendering work rather than the number of DOM rows; unsupported CSS falls
back to ordinary rendering.

## Schema library

### Document management

**Settings → Schemas**, subtitled “Manage your OpenAPI documents”, supports JSON
and YAML upload, renaming, enablement, replacement, normalized JSON download and
confirmed deletion. Settings sections remain alphabetically ordered. Full source
editing and remote Git integration are outside this version.

Cards start folded. Opening a card makes its name editable; changes save on blur. Renaming changes only
`info.title` and creates a descriptive commit in the existing repository,
preserving its ID and other content.

### Document inspection

Cards show the complete document in the same read-only JSON viewer as operation
reports, with collapsible scopes, line wrapping and copying. The viewer renders
on expansion, even for disabled documents. Each opening exposes paths and HTTP
methods while folding operation bodies and other nested fields. Rows are paged;
copy and download still include the entire document. Closing releases the viewer
after its slide transition, and late replies cannot reopen it.

Inspection does not edit content. First access to a bundled source may materialize
its initial local Git snapshot; reopening unchanged content creates no commit.

### Default service library

Reviewed service schemas ship as compressed, integrity-checked local packs. Startup
adds missing defaults to existing profiles without replacing authored documents.
Installation records survive deletion, so deleted defaults stay deleted.

Unmodified defaults follow bundled revisions while retaining enablement.
Their Git baseline materializes when a complete source, operation model or history
is needed. Once materialized, later observed bundled revisions append content
commits in that schema's repository. Reading history preserves factory ownership;
renaming or replacing transfers ownership to authored content, which subsequent
bundled revisions cannot overwrite. Unused disabled defaults remain manifest entries
until needed; local history does not invent unseen upstream revisions.

Display names can identify a provider without rewriting its upstream document
title. Examples retain their existing once-only seeding behavior.

### Reviewed corrections and upstream updates

Published service snapshots and application corrections are separate. For a
corrected service, its compressed pack retains the published OpenAPI document
after reference bundling/conversion. The manifest records the original pack
digest, the versioned correction recipes and the effective document's digest and
size. Discovery indexes and executable models use that effective revision.
The complete uncorrected source stays available in its local Git history.

The first correction changes Google's duplicated OAuth requirements from an AND
entry to separate alternatives in the `security` array. Both flow definitions,
required scopes and unrelated AND credentials remain intact. This is OpenAPI's
[security alternative syntax](https://spec.openapis.org/oas/v3.0.3.html#security-requirement-object),
not JSON Schema `oneOf`. The correction accepts only the reviewed Google flow
endpoints and matching scopes, records the prior requirement and rejects an
existing conflicting provenance extension. It applies to the 52 Google Cloud
and 24 Google product packs. An already-correct upstream document needs no
duplicate correction content.

Each materialized schema repository uses these local branches:

| Git branch | Settings label | Content |
| --- | --- | --- |
| `upstream` | Published | Observed published snapshots, without application corrections |
| `corrections` | Corrections | Reviewed corrections replayed over the selected published revision |
| `main` | Working | The effective schema, including local edits such as its name |
| `incoming` | Incoming | A proposed corrected update awaiting conflict decisions, when necessary |

Existing linear histories remain intact; migration does not invent missing old
published revisions. Branches materialize on first source/model/history access,
not while listing disabled schemas. Opening history again makes no commit.

Uploading a replacement imports a new published snapshot into the same
repository. Reviewed corrections are reapplied, then a structured three-way merge
compares the previous corrected baseline, current working document and new
corrected source. Independent edits merge automatically. Arrays are atomic, and
overlapping edits produce explicit field conflicts instead of text conflict
markers or an arbitrary winner. The current schema remains usable while the
incoming branch and review state survive reload. Decisions must match both
reviewed revisions; stale decisions cannot replace newer edits. A resolved
document is validated before its working branch and credential policy change.

The bundled-update API uses the same merge process to update an edited copy from
the bundled source. It performs no schema download. Unmodified factory copies
continue to follow bundled revisions automatically; edited copies retain their
authored content. The history view has no bundled-apply action.
Applying an already-current factory bundle preserves its catalogue label and
automatic update ownership without reading its source or publishing metadata.
Reapplying an identical source to an edited copy also preserves local state;
pending proposals and changed source metadata still use the update path.

**Schema revisions** shows the actual commit graph with a selected marker and
uniform edges. The disclosure has only its leading chevron, and the selected
commit has no redundant text label. Branch refs remain stored but are not
rendered as badges or card borders. Independent **Base** and **Compare** selectors
accept any two saved commits in that schema's isolated Git repository, including equal and reverse
comparisons. Both menus retain the graph's newest-first commit order. A fresh
disclosure selects the original import on the left and latest commit on the right
without reordering either list. Root discovery can expand the loaded ancestry up to 1,000 commits; if
the root is still outside that bound the user must choose a base explicitly.
Selecting a graph node changes the comparison target while retaining its base.
Comparing revisions never changes checkout, Git objects or schema metadata.

Changed-field lists contain paths and kinds only. Expanding a field loads actual
JSON values from the selected immutable blobs and computes aligned line changes
with line numbers, context, red removals and green additions. Missing sides are
omitted; null remains a real value. Visible Before/After headings appear only
when both panes are present. Code never wraps and scrolls horizontally.
Field paths stay on one line, truncate with an ellipsis without scrolling, and
show the complete path on hover. Closing a field releases its rendered content; changing endpoints
discards old field requests. Matching work is bounded; very large unmatched
regions are honestly shown as replacements. Context is folded, and display limits
(initially 200 rows, expandable to 5,000, with a 512 KiB text budget) are explicit.
These bounds and the changed-field pagination never alter saved content/exports.
Conflict decisions and their revision checks retain the separate merge review.

Build-time refreshes apply the same reviewed recipes. To update corrections
without fetching new provider documents, use
`node build/service-schemas.mjs --from-bundled --profile=google-oauth`, followed
by `npm run schemas:index`. The one-time migration of earlier Google packs
restores their recorded original requirements only when those exactly explain
the earlier correction. Generic parsing retains strict auth AND semantics.

### Available operations

Bundled examples seed once, preserving the `demo` and `httpbin` IDs and authored
navigation groups. Deleting every document does not reseed them. Schema
repositories load before workflows are restored.

Successfully loaded, enabled discovery indexes replace the registry atomically, updating
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

Import creates the first commit; corrected factory schemas retain separate source
and correction commits. Upstream replacement and local edits use the same repository.
Identical content adds no commit unless a new source ancestry must be integrated;
repeating the same update does not create another merge. Historical reads use immutable Git blobs
without changing the working file.

### Metadata and recovery

`v1/catalogs/index` stores metadata, repository paths, enablement, recovery journals,
rebuildable discovery indexes and per-schema credential policies. These are not
independently editable content copies. Cache identities include source and adapter
revisions. Corrupt derivatives rebuild from verified sources; cache quota failure
does not erase authoritative Git content. Enablement remains outside Git.

A serialized queue and browser lock protect writes across tabs. Immutable Git
objects are flushed before publishing a recovery journal, allowing the working
file, index, all affected branch references and metadata to be finalized after interruption.
Deletion records a tombstone before removing only the selected repository and
metadata. Saved workflows remain untouched.

### Card ordering

Schemas always sort by their current displayed name, case-insensitively, with
stable schema IDs breaking ties. Settings and the operation catalog use the
same order after uploads, renames, replacements and reloads. Existing saved
manual arrangements are ignored. There are no manual ordering controls or
actions.

Ordering reads metadata without opening schema documents or adding Git
revisions. Names refreshed by discovery determine the final library snapshot.

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
Absolute overrides do not require unused ancestor variables to be configured;
relative overrides resolve their parent server only when needed.

Server variables must resolve to concrete values before execution. Unresolved
angle or brace placeholders, including their percent-encoded forms, are rejected
during schema adaptation and ordinary or credential-backed request preparation.
The original source templates remain available for inspection. This prevents
defaults such as `<bot_token>` from becoming apparently usable
`/bot%3Cbot_token%3E` endpoints through URL normalization.

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
