# Native RPC operation models

The native Codex schema preserves all 105 client-method identities from protocol `0.163.0`. The active catalog exposes 104; `windowsSandbox/setupStart` is omitted until Windows provisioning support is qualified.
Discovery remains compact. Loading a method asks the schema worker for a native
model with `protocol: "json-rpc"`, its version, method, parameter requirement and
parameter/result/error schemas. It has no HTTP origin. The existing `RPC` and
method-name discovery labels are not an HTTP verb or URL.

The scoped document preserves the selected wire request, generic success/error
frames and their local definition-reference closure at the original pointers.
Watch models also include their selected `fs/changed` notification and reference
closure. Other methods, notifications and unrelated definitions stay in the source pack.
Recursive references remain references. Missing, external or malformed references,
ambiguous methods, excessive traversal and scoped documents over 1 MiB are rejected.

The pinned wire schema declares `result: true`; it does not associate each method
with a typed result. Operations preserves that generic wire result and separately
retains the 105 method-to-response references derived from the pinned Rust request
declarations. The generated mapping records the source commit and file/schema
digests, and index generation verifies exact method coverage and local response
references. This metadata does not grant execution authority.

Reviewed workflow result types include `InitializeResponse`, `GetAccountResponse`
and feedback, workspace reads, mutations and watches, thread sections, the seven metadata-query and thread/terminal-turn contracts. Unrestricted JSON remains `Unknown`, with
an explicit marker, and can connect through a Cast without claiming a concrete
type. Missing or unsupported schema fields remain unavailable.
The account workflow retains its original source declaration as `wireResult` and
uses a concrete public projection so nullable account and routing properties have
connectable output ports. Runtime validation still enforces the exact variants.
Error properties follow the native error schema. Native panels have Parameters,
Result and Error branches, without HTTP status codes, headers or response bodies.
Watch models add typed Filesystem changes panels. Their native notification
params remain source references, and `emittedAtMs` preserves the SDK transport
timestamp separately from the registration result.
Stored-thread reads retain their exact native request/result declarations and
bounded workflow inputs. Directory filters and exclusive item cursors use JSON
fields to preserve their string/array/object alternatives. The workflow result
adds the same pinned Rust publisher's experimental thread environments,
direct-input and Daybreak flags, plus read receipts omitted by its schema
exporter. Implementation-specific extra data accepts null or an empty object;
unclassified fields remain rejected. These result fields do not confer agent
execution authority on discovered threads.

Thread lifecycle models retain named native response contracts and the reviewed
thread metadata extensions. Fork results also retain runtime workspace roots,
active permission profile and multi-agent mode from the pinned Rust publisher.
Mutation inputs exclude workspace, permission, provider and instruction
overrides; Git metadata uses a closed nullable patch object. Runtime scope and
ownership checks remain independent of the model.

Content models preserve arbitrary bounded attachment JSON and raw history item
arrays, nullable goal patches and explicit provenance. Revert uses the same
reviewed thread metadata extension and preserves native history cursors. A goal
mutation acknowledges its stored state; autonomous turn output is not its result.

Thread-section appearance inputs preserve nullable objects and nullable nested
strings in forms while retaining their original wire parameter references.

Saved workflows retain the native discriminator, version and method alongside
their parameter/result panels and connections. These are advisory graph data;
imports cannot carry credentials or execution authority. Reopening a workflow
hydrates its native models from the currently enabled source. Legacy HTTP
workflows retain their existing format.

Native model fingerprints bind the protocol, canonical operation and exact scoped
schema independently of HTTP destination/credential fingerprints. Schema storage
publishes them only after a complete batch succeeds. The existing private policy
reader checks current enabled source metadata, revision, adapter revision and
fingerprint; disabled, replaced, pending or missing sources cannot authorize an
old or page-forged descriptor. The adapter revision includes the native scoping
implementation so derived indexes and policies refresh when its contract changes.

Hydration coalesces duplicate requests and retains the existing 16-model batch
limit and 8 MiB cache eviction budget for unpinned models. Open workflows pin
their models; closing releases that ownership. Catalog republication preserves
the native discriminator, and late replies from replaced sources are rejected.

Loading or approving a model does **not** enable native execution. HTTP preparation,
HTTP credential approval and both workflow HTTP executors reject native methods.
The [paired runtime implementation](codex-native-runtime.md) is a separate,
explicit connection action. The [bounded Codex workflow adapter](codex-native-workflows.md)
adds separate host/profile approval for its reviewed methods. No Codex process,
account login or provider request is started by model
hydration.

Filesystem mutations use separate host authority and preserve the pinned empty
response object as a connectable native Result. Their input models retain
base64 bytes, nullable create/remove flags and explicit recursive copy semantics.
The original wire declarations remain available alongside the reviewed workflow
inputs. Mutation methods use one request per fresh owned child; no cached query
peer or automatic retry can reapply them.

Standalone MCP inventory and resource operations expose concrete `data` and
`contents` result ports and preserve their wire response definitions. Their
nullable hosted-app target retains required connectorId/linkId properties;
thread-dependent inputs are omitted from this standalone profile. JSON schema,
capability and metadata values remain JSON at the exact untyped MCP source
locations, under the private worker's bounded JSON and credential checks.

MCP tool workflow inputs retain the pinned complete JSON type union for arguments
and metadata, presented as single JSON fields in the editor. The concrete tool
result exposes content, structuredContent, isError and metadata ports. Tool
execution uses the current reviewed native workflow approval and loaded thread;
the original generic wire result and pinned per-method response declaration
remain distinct from execution authority.

MCP OAuth exposes the typed `McpServerOauthLoginCompletedNotification` as its
workflow result. The pinned `McpServerOauthLoginResponse` remains in
`x-operations-native-workflow.wireResult` so the initial authorization URL and
login ID are distinguishable from terminal success. The URL is transient run
progress; callback addresses and stored credentials are not operation inputs.

The build retains the readable pinned response inventory in
`native-method-results.json` and generates a compact runtime table alongside it.
Conventional response names are shortened only when they exactly match the
reviewed declaration; all differing names are stored explicitly. Generation
roundtrips every reference and `--check` compares both generated files. This
changes storage only, with no method permissions inferred from naming.

Standalone command models retain their pinned native terminal and control result
schemas. The `command/exec` workflow adds separate **Command dispatched** and
**Command output** groups. The former carries a locally confirmed process ID,
never a result or exit status. The latter preserves `command/exec/outputDelta`
base64 bytes, stream, cap flag and optional native timestamp. Terminal result
mappings wait for real completion, while process controls can use the dispatch
ports immediately. No HTTP response/status envelope is introduced.

Thread shell retains its empty `ThreadShellCommandResponse` wire declaration and
uses a separate workflow result containing the actual `item/completed` command
execution and `turn/completed` events. Its command variant comes from the pinned
`ThreadItem` declaration, keeping output and exit-code ports concrete. Original
notification declarations remain in the reference closure so rescoping is
idempotent. No success is published from the empty acknowledgement.

Configuration reads retain their pinned response declarations. `config/read`
uses a documented public projection for preferences and policy fields, including
the same projection within optional layers. Flattened provider/MCP/desktop
settings and instruction bodies are withheld; origins are limited to the public
fields. The original full response remains in `wireResult` for provenance.
Requirements, experimental-feature and skill reads keep their native typed
results. Configuration reads do not acquire write or agent authority.

Process-local configuration controls retain their original named native result
references. Feature override results are boolean maps and must acknowledge exactly
the requested canonical keys and values. Skill-root replacement and MCP refresh
keep their native empty results. Reviewed input schemas name unsupported fields,
limit roots to eight workspace directories and retain the original wire schemas.
No HTTP or agent-turn result envelope is introduced.

Persistent preference writes retain `ConfigWriteResponse`; skill overrides keep
`SkillsConfigWriteResponse`. The reviewed inputs preserve JSON value types,
null removal, ordered batches, version conflicts and exactly one skill selector.
Native parameter and response definitions remain at their original pointers.
Request/result-bound authority receipts and updated pairing references travel
through private transport and worker reply metadata, outside workflow results.

Gateway sign-in and cancellation retain their named native empty-object results.
They accept no credential, provider or endpoint fields. The authorization link
is a transient private progress event, and the confirmed credential authority
transition travels in worker reply metadata outside the operation result.

Credit-reset and credit-email actions retain their original named parameter and
response definitions, native enum values and public account confirmation schema.
Reviewed fields preserve opaque reset/idempotency identifiers and the credit-type
enum. Approval is a private Operations interaction outside the workflow result.

Steering/interruption keep `TurnSteerResponse` and `TurnInterruptResponse`,
including the required active-turn precondition and native startup cancellation
identifier. Their scoped models retain both native turn notification definitions.
The reviewed text input retains optional message IDs and UTF-8 annotations;
private controls do not change a pending parent operation into an early result.

Review and compaction retain `ReviewStartResponse` and
`ThreadCompactStartResponse`, their full wire definitions and both native turn
notification definitions. Review publishes its completed turn under the native
`reviewThreadId`/`turn` response shape; compaction returns its native empty object
after completion. Reviewed targets preserve all four native variants. Stable
workflow delivery is inline, with explicit field diagnostics for the SDK's
unsupported detached/paginated combination; the original wire delivery enum
remains available in the retained native schema.

Guardian approval retains its original event parameter, empty named response
and complete started/completed notification definitions. Reviewed workflow
input selects an observed thread/review ID; the companion supplies the frozen
native event after human confirmation. All seven native action variants and
permission/path conversions stay source-backed. Thread creation/resume expose
the bounded `user`/`auto_review` choice with a human default and independent host
grant. Private notifications and approval tokens are outside workflow results.


Plugin read models preserve the pinned0.163.0 wire parameter/result declarations alongside bounded public input forms. Native results remain `PluginInstalledResponse`, `PluginListResponse`, `PluginReadResponse`, `PluginSkillReadResponse` and `PluginShareListResponse`; local and remote `plugin/read` variants share their original result type. Their typed ports and workflow documents retain those shapes. Five source-backed reads are enrolled locally; complete OP040 qualification and delivery remain tracked separately.


Marketplace models preserve exact `MarketplaceAddResponse`, `MarketplaceRemoveResponse` and `MarketplaceUpgradeResponse` declarations and their typed workflow ports. Nullable/omitted native request values remain distinct. Marketplace mutation receipts use the same exact method/request/input/result/identity binding as preference writes; their host effect verifier and owner grant are separate, and the writable preference-key list is unchanged.

Plugin management preserves `PluginInstallResponse`, `PluginUninstallResponse` and `PluginReconcileResponse`, including authentication results and per-pass capability/failure fields. Public forms retain mutually exclusive local/remote source selectors, optional correlation IDs and nullable multiline reconciliation reasons. Their separate owner grant and effect verifier use the existing exact mutation receipt contract without expanding writable preference keys.

Plugin sharing retains `PluginShareSaveResponse`, `PluginShareUpdateTargetsResponse`, `PluginShareCheckoutResponse` and `PluginShareDeleteResponse`, including principal roles, nullable publication capability and checkout identity/path/version fields. The public forms preserve nullable creation selectors and the SDK's full bounded remote-ID grammar across backend generations. User/group access targets and creation/update visibility restrictions match the pinned SDK; readonly wire declarations retain its broader principal enums. A separate owner grant and host effect verifier use finite private metadata requests and exact method/input/result receipts, without broadening writable configuration keys.

Windows sandbox readiness retains `WindowsSandboxReadinessResponse` and its native three-state enum, with no fabricated thread or account inputs. The setup parameter/completion contracts are source-backed but remain unenrolled: `started` is an acknowledgement, while the separate mode/success/error event carries the terminal outcome. Linux failure evidence does not qualify Windows provisioning.
