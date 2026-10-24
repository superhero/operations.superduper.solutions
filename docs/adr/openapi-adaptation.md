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
For the DigitalOcean correction, select `--profile=digitalocean-permissions`
instead; published packs remain unchanged in either case.
For Gemini's reviewed SDK authentication, use `--profile=gemini-auth`.
For the missing Event Grid management requirement, use `--profile=azure-eventgrid-auth`.

### Available operations

Bundled examples seed once, preserving the `demo` and `httpbin` IDs and authored
navigation groups. Bundled examples and registered service defaults cannot be
deleted, even after renaming or replacing their content. Uploaded schemas must
first be disabled before deletion. Settings explain disabled Delete buttons and
cancel a pending confirmation if the schema is re-enabled. The storage layer
checks the registered ID and current enablement in the deletion transaction,
before removing metadata, credential policy, indexes or the schema's Git
repository. Deleting an upload retains saved workflows and other repositories.
Missing defaults from older browser installations remain absent; they are not
reseeded. Schema repositories load before workflows are restored.

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
DigitalOcean's reviewed `digitalocean-bearer-permissions` correction retains its
published nonempty bearer requirements in `x-upstream-security` and moves token
permissions into `x-credential-permissions`, aligned with the `security`
alternatives. The effective bearer requirements use empty arrays; unrelated
credentials and anonymous alternatives keep their original meaning. Canonical
operation models retain these permissions in private approval fingerprints, so
changed permissions invalidate existing credential bindings. Tokens pass through
unchanged; the provider enforces their permissions. This correction uses the same
published/corrections/working Git history and upstream merge path as Google.
Generic bearer and API-key parsing still rejects nonempty security arrays.
Gemini's versioned `gemini-auth-alternatives` correction translates the reviewed
`googleGenAIAuth` declaration into separate header API-key and bearer alternatives.
Only declared plain-string `apiKey` and `accessToken` choices are used, on the
reviewed Generative Language endpoint. SDK `defaultHeaders` is not authentication.
The original custom definition and security requirements remain inspectable;
other required credentials and explicit anonymous overrides retain their meaning.
Ambiguous SDK contracts and provenance/scheme collisions reject the correction.
An upstream standard API-key or bearer fix needs no further adaptation. Uploaded
custom schemes remain unsupported unless an existing reviewed correction applies;
no schema extension executes code. The [provider schema](https://ai.google.dev/static/api/interactions.openapi.json)
and [authentication guide](https://ai.google.dev/gemini-api/docs/oauth) describe
these credential transports. This adds no login or refresh flow, and does not
qualify real accounts, quotas or browser CORS.
Event Grid's `azure-eventgrid-management-auth` correction attaches its existing
`azure_auth` declaration and `user_impersonation` scope when root security is
absent. It only accepts the reviewed management document, issuer, scope and
inherited Event Grid routes on `management.azure.com`; explicit operation
requirements and anonymous overrides remain unchanged. `x-upstream-security:null`
records the absent original declaration; an existing root declaration is left
intact. Published paths and OAuth definitions remain byte-equivalent data in
their separate history. Canonical approvals retain the management destination
and scope, so earlier anonymous approvals cannot authorize the corrected request.
Use an existing [Azure Resource Manager bearer token](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/manage-resources-rest),
with the corresponding Azure RBAC authorization. Tokens for Event Grid event
publishing target a different resource. Azure enforces token validity and RBAC;
the application does not inspect JWT claims or add consent, acquisition, implicit
login or refresh flows by preserving the upstream OAuth metadata.

Anthropic's `anthropic-authentication` correction applies to the pinned
`sdk-v0.120.0` direct API document. Its reviewed routes inherit explicit
`x-api-key` or HTTP Bearer alternatives. The correction requires the existing
non-secret `anthropic-version` header and adds an optional
`anthropic-workspace-id` field for API keys that need workspace selection.
It does not choose a newer API version automatically. Existing root security
and explicit operation overrides remain intact; unreviewed revisions, route
families, destinations and provenance collisions require another review.
Published bytes remain unchanged. `x-upstream-security:null` and
`x-upstream-parameters` retain the omitted declaration and original parameters.

Existing vault-to-API-key-header connections retain their field and edge IDs.
An unambiguous direct vault reference supplies the matching credential choice;
an explicit clear prevents fallback. The worker may consume a connected private
header only when its resolved value exactly equals the selected injected
credential. Conflicting private values and public Authorization/API-key inputs
still fail before dispatch. Existing vault entry kinds remain usable through
that exact direct connection; ordinary selector kind restrictions remain.
Neither inference nor a saved binding grants authority over a destination:
canonical current-schema approval and private execution checks still apply.

The [Anthropic authentication guide](https://platform.claude.com/docs/en/manage-claude/authentication)
documents API-key and acquired access-token transports, conditional workspace
selection and workload identity. The [versioning contract](https://platform.claude.com/docs/en/api/versioning)
requires an explicit API version. This correction adds no credential issuance,
App Attest, SDK, streaming-result or native-worker lifecycle. Synthetic
non-streaming requests do not qualify live accounts, permissions or browser CORS.

ElevenLabs' `elevenlabs-authentication` correction declares the account
`xi-api-key` transport while retaining reviewed public and optional-public route
overrides. Optional generated header parameters alone do not establish public
access. The correction checks the direct API endpoint and existing private-key
parameter contract. Its exact string/null key union becomes equivalent nullable
Text metadata so existing vault header connections remain usable; original
parameters and omitted security declarations stay inspectable as provenance.
An explicitly anonymous choice cannot supply a declared credential header or
query value through ordinary inputs.

Responses that declare an authentication token, signed URL, new API key or
webhook secret carry `x-operations-credential-result:true`. Both schema readers
retain this capability as `credentialResult`; request preparation and canonical
private approval reject it until private credential acquisition is implemented.
This applies even when upstream authentication metadata is already fixed.
Pagination tokens, masked key previews and credential IDs do not trigger the
marker. These results cannot be treated as ordinary JSON outputs, and ephemeral
client tokens are not aliases for the account API key. Existing binary, stream,
form and endpoint limitations remain separate.

See [ElevenLabs authentication](https://elevenlabs.io/docs/api-reference/authentication),
[public default settings](https://elevenlabs.io/docs/api-reference/voices/settings/get-default),
[single-use tokens](https://elevenlabs.io/docs/api-reference/tokens/create) and
[signed conversation URLs](https://elevenlabs.io/docs/api-reference/conversations/get-signed-url).
No token acquisition, audio playback or binary/streamed result support is added.
Provider authorization, public-resource visibility, key permissions, quotas and
browser CORS remain separate from deterministic request validation.

Authentication alternatives retain their original array positions and scheme
names. A valid unsupported HTTP scheme is retained as an explicit unavailable
credential with its destination and explanation; it never becomes an empty
anonymous requirement. Other members of that AND alternative remain required.
A supported OR alternative can execute independently, while an operation with
no supported choice remains unavailable. Missing definitions, malformed scope
arrays and conflicting credential destinations still reject the operation.
The strict security extraction API remains strict; service and authored-model
inspection use capability-aware extraction. Existing SigV4 requirements stay
unavailable, including when another authentication choice is supported.

The credential chooser disables unavailable alternatives and explains why.
Saved selections keep their original alternative index and vault IDs across
reload. Complete canonical approvals retain unavailable metadata and reject
selection of any unavailable AND member in private execution and credential
grants. An explicit anonymous choice still requires an explicit selection when
other alternatives exist. All-supported metadata and approval fingerprints are
unchanged. OAuth1 execution and automatic authentication fallback remain unsupported.

HTTP Basic uses two existing vault entries: a username and a password or API
token. A local binding stores an exact `{ username, password }` pair of opaque
vault IDs under the original scheme name; bearer and API-key references remain
strings. Portable workflow exports/imports remove these bindings. Only private
execution resolves values and constructs the `Authorization: Basic` header.
The worker redacts the source values, joined pair, Base64 token and complete
header, including their percent/form-encoded echoes, from previews and responses.

Basic retains the vault's existing nonempty visible-ASCII value contract. It
rejects username colons, unsupported characters, malformed/stale/missing/extra
references and oversized encoded credentials before dispatch. Password colons
are supported. The existing HTTPS, destination/currentness, AND/OR, public-header
collision and redirect rules apply. A policy change still invalidates stale
fingerprints; unchanged bearer/API-key policies keep their existing bindings.
This adds no character-set negotiation, challenge retry or new vault entry type.
See [RFC 7617](https://www.rfc-editor.org/rfc/rfc7617.html#section-2),
[Twilio credential roles](https://www.twilio.com/docs/usage/requests-to-twilio#authentication)
and [Atlassian email/API-token Basic](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/).

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

For operations with file representations, normalized per-status response media
metadata is part of canonical approval. Actual Content-Type selects the matching
response branch; a preferred JSON declaration cannot override a file or event
stream. Declared binary bodies expose a Binary port and preserve exact bytes in
the existing bounded file envelope. See [workflow files](../workflow-files.md)
for size, download, storage and private-result limits. JSON/text-only operations
retain their existing approval metadata.

Header serialization follows the workflow runner's supported
[OpenAPI Header Object](https://spec.openapis.org/oas/v3.1.0.html#header-object) rules.

### Saved workflow compatibility

Response field identities use `response:<status>[:media]` and JSON pointers into
the response object. Legacy `output:<status>[:media]` fields remain body-rooted,
preserving existing mappings. Saved graphs and Git snapshots are not regenerated
from changed documents; newly added HTTP nodes use the response layout.
