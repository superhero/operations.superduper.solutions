# Codex native workflows

The optional [paired Codex companion](codex-native-runtime.md) supports native
workflows on the pinned **0.163.0** protocol. Operations exposes reviewed native
operations: `initialize`, `account/read`, `thread/start`, `thread/resume` and
`turn/start`, plus the seven metadata queries, four workspace reads, four workspace mutations, two watch controls, four thread-section methods, two MCP reads, direct MCP tools, MCP OAuth, four standalone command methods, explicitly approved thread shell, feedback upload, fourteen configuration/import/skill methods, eight stored-thread reads, eight thread lifecycle methods and six content/goal methods below. Owned steering/interruption, inline review and compaction are also exposed below. The native schema retains all 105 identities. The active catalog omits `windowsSandbox/setupStart` for now and exposes the other 104 methods.

## Read account state and initialize

Pair the companion in **Settings → Secrets → Native runtimes**, add either
operation to a workflow and select the paired runtime in the run dialog. These
two operations require neither a provider account nor the agent opt-in.

**account/read** returns public account metadata and `requiresOpenaiAuth`. The
optional account field preserves its absent or null state. Its refresh flag is
fixed to false; this workflow does not refresh credentials or expose internal
authentication variants.

The pinned runtime also emits `workspaceRouting`, which its public schema export
omits. The workflow model includes the nullable routing metadata defined in the
[same pinned Rust source](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server-protocol/src/protocol/v2/account.rs#L517):
the account ID, backend origin and routing override. These values are output
metadata; they do not authorize a destination or alter the runtime selection.

**initialize** replaces this runtime's current channel and starts a fresh owned
child. It sends the fixed Operations client identity with public capabilities,
then returns `codexHome`, `platformFamily`, `platformOs` and `userAgent` from the
actual handshake. It has no editable parameters. Its ticket permits one
initialization and the following notification. The existing account-read and
agent profiles retain their separate scope.

`OPERATIONS_CODEX_ALLOW_ACCOUNT_READ=1` separately enables
**account/gatewayOAuth/read**, **account/rateLimits/read**, **account/usage/read**
and **account/workspaceMessages/read**. These reads reuse the paired child and
do not require agent execution or workflow approval. Gateway readiness also
works without provider sign-in. Usage, limits and workspace messages require a
ChatGPT account; API-key and anonymous runtimes cannot query those backends.

Usage accepts an optional native thread UUID, authorized by the account backend;
it does not load that thread or require it in the local workspace. Omitting the
UUID reads the account profile. Rate limits preserve backend permission and
banner fields; percentages and reset times never imply that usage is allowed.
Operations declares no automatic Reserve fallback capability. The optional
credit-detail exclusion retains the availability count. An unavailable workspace
message route returns the native disabled/empty response.

Private credential-store and account checks run before and after each read.
Credential echoes, including reviewed encoded forms, are rejected before
publication. The SDK's initial cache-fill notification is kept private while
the same file-backed authority remains pinned and no account control has been
dispatched; credential changes revoke the attempt. Cancellation withholds the
result and never replays the read.

## Manage account sign-in

`OPERATIONS_CODEX_ALLOW_ACCOUNT_AUTH=1` enables **account/login/start**,
**account/login/cancel** and **account/logout** in a separate authentication
channel. It grants no agent execution, configuration, filesystem or billing
methods and needs no workflow approval for those unrelated methods.

Sign-in supports public API-key, browser and device-code modes. API-key input is
a saved vault reference selected in the run form; its value is resolved only in
the private worker. Browser options retain their native brand and success-page
flags. Browser URLs, device codes and attempt IDs are transient progress notices.
The workflow waits for the matching successful native completion and a pinned
account read. API-key completion has a null login ID. The original acknowledgement
schema stays in `wireResult`; `wireConfirmation` retains the account-read source.
The workflow result is the confirmed public account metadata, without sign-in
links, codes or key values. Native credential echoes are rejected by the companion.

A provider that does not require account authentication may still persist an
explicitly selected key. Its confirmed public account metadata remains null with
`requiresOpenaiAuth=false`, matching the SDK. Successful sign-in and confirmed
logout update the encrypted pairing and the client reference used by following
workflow steps. Logout confirms the native signed-out state before returning its
empty result. Neither action grants execution on a previously owned thread.

Cancellation accepts the ID of an owned workflow sign-in, or uses that pairing's
current pending attempt when omitted. The dedicated cancellation call can run
alongside the pending sign-in; other ordinary vault work stays serialized.
Foreign IDs and other pairing scopes are rejected before dispatch. Cancellation
or a failed confirmation cannot undo a native account change already applied.
The SDK may refresh provider/plugin caches through its configured endpoints
following sign-in. Account changes are never replayed automatically.

## Read stored threads

Thread lifecycle actions use the independent
`OPERATIONS_CODEX_ALLOW_THREADS_WRITE=1` grant: **thread/archive**, **thread/delete**,
**thread/fork**, **thread/unarchive**, **thread/unsubscribe**,
**thread/metadata/update**, **thread/name/set** and **thread/section/move**.
Names, Git metadata and section placement are verified against the private
native store. Archive/delete include spawned descendants, including closed
persisted edges and loaded descendants; cycles, more than 64 affected threads,
or any workspace escape prevent dispatch. The SDK state directory is pinned to
the private runtime home, or its separate migration history directory.

Fork additionally requires agent authority, current workflow approval and an
owned loaded source. It preserves the host's permission profile and human
approval reviewer. Ordinary forks do not continue the source goal. Archive and
unsubscribe revoke loaded execution state; explicitly resume an owned thread
before using it again. Successful delete also removes its ownership. Cancellation
or an error can follow an applied mutation; Operations does not replay it.

The same write grant enables **thread/attachment/add**, **thread/attachment/remove**,
**thread/goal/set**, **thread/goal/clear**, **thread/inject_items** and
**thread/revert**. Attachment payloads are bounded JSON under a stable
thread-local identity; an existing identity retains its original payload.
Attachment writes and goal clear use pairing authority. Goal set and history
edits require an owned loaded agent thread and current workflow approval.

Goals also require `[features] goals=true` in the dedicated SDK configuration.
Provenance is preserved exactly: an omitted or automatic origin is never
rewritten as a user action. Omitted token budgets preserve the old value; null
clears it. Active goals may immediately start background agent work. Mutation
acknowledgements keep their native result shape; background turn content stays
private and can be inspected through authorized history reads. Background tool
interactions are declined rather than receiving implicit approval. Clear can
stop future goal continuation while a current turn finishes. Closing the paired
child revokes its active work.

Injection accepts bounded raw Responses API items and leaves native item/image
validation to the pinned SDK. Revert replaces paginated conversation history
with the prefix before the selected turn, reloads the same owned thread and
returns empty `turns` plus native hydration cursors. It does not undo files.
After an uncertain revert failure, explicitly resume before further execution.

Enable `OPERATIONS_CODEX_ALLOW_THREADS_READ=1` before pairing for **thread/list**,
**thread/loaded/list**, **thread/read**, **thread/turns/list**, **thread/items/list**,
**thread/goal/get**, **thread/attachment/list** and **thread/attachmentOwner/list**.
This permission reads local history and metadata inside the paired workspace.
It is independent of provider sign-in, agent execution and thread mutations.
Reading or discovering a thread does not enroll it for agent execution.

Thread listing defaults to the paired workspace root and accepts one directory
or up to eight directories as JSON. Canonical escapes and the private runtime
home are rejected. Loaded-thread and attachment-owner pages omit other
workspaces; their native opaque cursors still advance across those entries.
Thread-specific reads privately inspect native metadata before dispatch and
recheck scope before returning content. Private inspection replies stay inside
the companion.

Pages default to eight entries, accept at most 64, preserve direction, native
cursors and nullable filters. Item cursors accept a JSON string or an exclusive
`{"type":"item","itemId":"…"}` anchor; anchors require `turnId`. Full-history
reads use `includeTurns`; paginated turns/items avoid the 64 KiB frame ceiling.
The local SDK rejects nonempty originator filters. Listing may perform its
normal local metadata repair; no read is automatically replayed after failure.

Typed results retain the pinned Rust publisher's experimental environment,
direct-input, Daybreak and read-receipt fields omitted by its schema exporter.
Implementation-specific `extra` data remains limited to null or an empty
object. Unknown fields, oversized pages and encoded known credentials withhold
the result. Cancellation, locking, changed pairing, account or source authority
close the owned attempt. Other native operations retain their separate grants.

## Read runtime metadata

The host operator enables `OPERATIONS_CODEX_ALLOW_METADATA=1` before pairing.
Select the paired runtime for **model/list**, **modelProvider/capabilities/read**,
**permissionProfile/list** or **hooks/list**. These operations do not require an
agent profile or provider login. They return the method's native result rather
than an HTTP response.

Model and permission-profile pages default to 8 entries, accept at most 64 and
preserve their returned pagination cursor. Model listings accept `includeHidden`.
Permission-profile queries accept a workspace directory; hooks accept up to eight
directories. Relative paths resolve from the companion workspace, and canonical
paths outside that workspace or inside its credential home are rejected.

The private worker validates the complete result against the pinned schema and
withholds unknown fields, invalid variants and known credential echoes. Source,
pairing, workspace or account changes revoke pending query authority. Locking or
cancelling closes the owned channel without replaying a query.

## Read app and connector metadata

The host operator enables `OPERATIONS_CODEX_ALLOW_APPS=1` for **app/installed**,
**app/list** and **app/read**. This opt-in is independent of ordinary metadata
and agent execution. App listings and installed refresh may start the configured
connector MCP runtime and fetch remote inventories. They cannot call tools.
Codex applies the connected account's feature and connector policies.

Installed apps expose their committed enabled/callable snapshot; `forceRefresh`
requests a fresh snapshot. App listings preserve cursor pagination, default to
eight entries and accept at most 64; `forceRefetch` bypasses metadata caches.
App reads accept up to 100 IDs and optionally return display-only public tool
summaries. The runtime deduplicates IDs while preserving their first order.
An empty ID list is valid. Loaded-thread configuration is outside this
standalone profile, so `threadId` is rejected.

The complete reviewed results retain typed output ports. Invalid nested data,
unknown fields, tool input schemas and known credential echoes are withheld.
Inventory update notifications stay private; server-initiated interactions are
denied. Cancellation closes the owned query and never replays a refresh.

## Read and search workspace files

The operator enables `OPERATIONS_CODEX_ALLOW_FILESYSTEM_READ=1`. Pair the host,
then select it for **fs/readFile**, **fs/readDirectory**, **fs/getMetadata** or
**fuzzyFileSearch**. These methods require neither agent execution nor a provider
account. Their grant does not enable writes or watches.

Paths may be absolute or relative to the authorized workspace. Credential-home
paths and canonical escapes are rejected. Files must be regular, have one link
and fit 32 KiB; directory listing returns at most 256 complete direct entries.
Metadata preserves safe leaf-symlink semantics. File contents retain the SDK's
canonical `dataBase64` encoding, including arbitrary binary bytes; known vault
credentials in decoded bytes withhold the entire result.

Search uses up to four selected roots, a query and an optional cancellation token.
It preserves native match fields and the SDK's 50-match bound. Every returned path
is checked against its selected root and workspace before publication. The native
64 KiB frame limit still applies; oversized results fail rather than truncate.
Cancellation or changed source/account/workspace authority withholds pending data.

## Change workspace files

The host operator separately enables `OPERATIONS_CODEX_ALLOW_FILESYSTEM_WRITE=1`.
Add **fs/writeFile**, **fs/createDirectory**, **fs/copy** or **fs/remove** and select
the paired runtime. Paths must remain in its workspace and exclude private
runtime/configuration paths. File contents use canonical base64, up to 32 KiB;
known vault credentials cannot be written through encoded input. Tree copies
and removals allow 256 entries, 16 levels and 4 MiB of file data. Hard links and
special files are unavailable.

Writes replace existing contents. Safe leaf links are followed for writes,
preserved for copies and unlinked for removals. Directory copies require
**Recursive = true**. Create/remove default to recursive; remove defaults to
ignoring missing paths. Omitted/null optional flags preserve these SDK defaults.
Each invocation dispatches once through a fresh owned child. Cancellation or a
lost acknowledgement cannot undo effects already applied; inspect the workspace
before choosing to run a failed step again. The grant does not enable watches.

## Manage thread sections

The operator enables `OPERATIONS_CODEX_ALLOW_THREAD_SECTIONS_READ=1` for
**threadSection/list**, and independently enables
`OPERATIONS_CODEX_ALLOW_THREAD_SECTIONS_WRITE=1` for **threadSection/create**,
**threadSection/update** and **threadSection/delete**. Select a paired runtime;
an agent profile or provider login is not required. The SDK needs SQLite-backed
section storage. Sections belong to the runtime's configured store and persist
across owned child processes; listings are not filtered to one workflow or thread.

Create and update accept public section names up to 200 characters. The SDK
trims names and rejects empty names. Update and delete use the stable section ID
returned by that store; IDs from another store and protected built-in sections
cannot be changed. Appearance accepts nullable `icon` and `color` strings, each
limited to 64 UTF-8 bytes. Omit appearance to preserve it on update, or send null
to clear it. Listings preserve opaque pagination cursors, default to eight rows
and allow at most 64; the SDK treats a page size of zero as one.

Typed native results retain section IDs, names and appearance. Known credential
inputs/echoes and unclassified result fields are withheld. Each mutation runs
once on a fresh owned child, without automatic replay. A failed or cancelled
response does not roll back an already saved section change. Listings reuse
only their exact read channel, not cached results. Source, pairing, account or
runtime authority changes withhold pending replies.

## Watch workspace changes

Enable `OPERATIONS_CODEX_ALLOW_FILESYSTEM_WATCH=1`, add **fs/watch**, select a
paired runtime and supply a unique **Watch ID** and **Workspace path**. A watch
is non-recursive and may target an ordinary workspace file or directory outside
the private credential home. This grant is independent of reads, writes and
agent execution. Registration returns the native path and starts a workflow
stream immediately.

The **Filesystem changes** outputs preserve `fs/changed`, its watch ID and changed
paths, plus the SDK transport timestamp when present. Notification-dependent
steps wait for an actual change. Ordinary downstream steps consume the first
notification once per run; connected charts and the stream's latest-event view
continue receiving updates. No HTTP status or response body is fabricated.

Add **fs/unwatch** with the same runtime and Watch ID to end that subscription;
the notification's `watchId` can be connected to its input. **Stop stream** also
unwatches that ID and preserves sibling subscriptions. Removing the last watch
closes its owned child. Up to eight watch streams share the private worker with
one ordinary command at a time. Stop active watches before using a different
native role on the same runtime profile.

Credential changes, source changes and vault locking revoke watch authority.
Each event is checked before publication and known credential echoes are
withheld. When a root is removed or replaced, only its final already-known path
may be delivered before the stream reports authority loss. No further paths are
inferred from the lost root. Ending the run tears down its subscriptions.

## Send feedback

The host operator enables `OPERATIONS_CODEX_ALLOW_FEEDBACK=1`. Add
**feedback/upload**, select the paired runtime and enter a classification, optional
message and optional text tags. This sends a report to OpenAI's feedback service.
It does not require an agent profile or enable tools.
The SDK includes its standard version/session and available account metadata
even when no diagnostic attachments are selected.

**Share runtime diagnostics** and **Share workspace files** explicitly select
additional content and require `OPERATIONS_CODEX_ALLOW_FEEDBACK_DIAGNOSTICS=1`.
Logs may include runtime diagnostics and rollouts for an owned thread. The browser
does not preview or redact their contents. Thread IDs must belong to this host
generation and account. Workspace files use private frozen snapshots, at most
eight files, 2 MiB each and 8 MiB total; credential-home paths, escapes, hard links
and special files are rejected. The qualified file-snapshot path requires Linux.

The native result contains `threadId` and an optional/null `promptHash`. Success
means the SDK received acceptance for the report and its attachments. Cancellation
closes the owned child and removes snapshots, but cannot undo an already accepted
report. Uploads are never replayed automatically; check delivery before retrying
an unverified result. The paired host's Codex configuration can disable feedback.

## Enable and connect an account

The host operator enables `OPERATIONS_CODEX_ALLOW_AGENT=1` before starting the
companion. Use an isolated service identity/container and an approved workspace.
The companion selects a named read-only permission profile, denies agent tool
reads of its dedicated credential home and disables tool network access. Agent
parameters cannot override the workspace, provider, sandbox, configuration,
environment or persisted history. Human approval review remains the default;
explicit AI review also requires the companion owner's Guardian grant below.
The host configuration is
trusted operator input; this does not deploy or configure a shared machine.

In **Settings → Secrets → Native runtimes**, pair the configured companion, then
choose **Enable workflows**. This saves a separate approval for the current
reviewed native models in the encrypted profile. Select a public sign-in method:

- **ChatGPT device code:** follow the link and enter the displayed code.
- **ChatGPT browser sign-in:** open the supplied sign-in link.
- **API key from vault:** select a separate saved credential. Its value goes
  directly from the private worker to the paired companion, never through an
  operation input, workflow document or page message.

Browser/device sign-in stays pending until the matching native login completion
and a fresh account read. An API-key acknowledgement has no login ID. Its successful native completion
uses a null login ID, followed by an account read to confirm the runtime state. This
does not prove provider validation, billing, subscription or model entitlement.
Only the owned login may update account authority. An unrelated account change
revokes the transport. Login completion saves a new profile revision; previous
workflow runtime references must be selected again. Sign-in links and codes are
transient and clear on completion, cancellation or leaving the pane.

Internal `chatgptAuthTokens`, experimental Bedrock modes and logout are not public
controls. Disconnect, cancel and vault lock close only the owned transport/child;
they do not log out another Codex client.

## Build and run a workflow

Add **thread/start**, then **turn/start**. Connect the thread result's
`result.thread.id` to the turn's **Thread ID** input. Select an enabled native
runtime when confirming each step. Supply an input array such as
`[{"type":"text","text":"Describe the approved workspace."}]`. The optional
model must be available to the connected account. To continue a known thread,
use **thread/resume** with an ID established by this host generation and account.
Foreign thread/turn IDs are rejected.

Native inputs use a parameters group and native results; they have no HTTP URL,
verb, headers or status code. The complete pinned wire parameter schema remains
available to the model, while the graph/form exposes only the reviewed subset.
Registered credentials and private vault-variable connections cannot become
ordinary native inputs. Known vault credentials in progress/results fail closed.
Locally saved runtime selections bind the exact operation and encrypted profile;
portable workflow exports/imports remove those selections, including nested ones.

Thread start/resume output types follow the explicitly reviewed response mappings
in the [pinned request declarations](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server-protocol/src/protocol/common.rs).
For **turn/start**, the workflow result is the matching
`TurnCompletedNotification`, rather than the initial `TurnStartResponse`.
The wire response schema remains intact. Unknown JSON keeps its existing
JsonValue/Unknown behavior instead of acquiring an invented concrete type.

## Approval, cancellation and failure

An owned command approval appears in the run panel with its command, working
directory and reason. Choose **Allow once**, **Decline** or **Cancel turn**.
Approval is a real host action: inspect the complete command before allowing it.
Session-wide grants, policy amendments, network/extra-permission requests,
unreviewed file-change requests and other unsupported interactions stop the turn.
No server request is approved automatically.

The native start acknowledgement does not complete a turn. Only the matching
terminal status `completed` returns a successful result. `failed`, `interrupted`,
source/account changes, expired sessions and disconnections fail explicitly.
The adapter does not replay native writes. If a connection ends without terminal
confirmation, inspect the thread before starting another turn. Cancellation
attempts the owned interrupt/login cancellation and stops that child; it cannot
undo an action already performed.

The existing limits apply: 64 KiB frames, eight pending requests/interactions,
15-minute paired sessions and bounded request acknowledgements. Text input is
limited to 16 entries and 24 KiB total. The host retains at most 64 owned thread
identities per runtime generation; a successful account change clears them.

## Qualification boundary

Focused deterministic source cases cover public login waiting, early/mismatched
completion, private credentials, encrypted profile revisions, canonical source
approval, thread/result mappings, explicit command approval, stale or unsupported
interactions, cancellation, terminal errors and disconnect without replay.
Production-worker Chromium scenarios exercise the settings and workflow UI at
desktop and phone widths. No test logs into a real provider account.

The opt-in real-runtime evaluation also checks initialization/account-read with
the named agent permission configuration, using an isolated temporary home and
workspace and the pinned executable. It does not perform inference or prove
live tool sandbox behavior. Real account/model entitlement, a deployed trusted
HTTPS host/certificate/origin and Safari/Firefox/device qualification remain
separate user-provided prerequisites. The [qualification receipt](evidence/codex-native-workflows-0.163.0.json)
records the exact checks completed by this change.

## Configured MCP reads

`OPERATIONS_CODEX_ALLOW_MCP_READ=1` separately enables **mcpServerStatus/list**
and **mcpServer/resource/read**. These use the configured runtime's global MCP
registry. Discovery may start configured stdio programs and contact remote
servers; resource reads use those servers' runtime credentials and policies.
The browser selects a configured server name and advertised resource URI. It
cannot supply transport URLs, headers, command configuration, threadId or an
originCallId. The SDK's global path loads non-project configuration; these
standalone reads do not borrow a loaded thread's configuration or account.

Inventory page size defaults to 8, with a maximum of 64. Zero retains the SDK's
one-entry minimum. Both inventory detail variants are supported. Resource
requests preserve the optional legacy connectorId and codex_apps target,
including explicit `linkId: null` for no-auth access under the hosted app policy.
Synthetic account links are rejected. Results retain their original text/base64
encoding, public schemas, capabilities and metadata. Each resource body is at
most 32 KiB, with at most 64 contents and the existing 64 KiB frame limit.

Typed result fields remain strict. Only these MCP result contracts accept
bounded JSON in the source's explicitly untyped fields. Saved credentials are
checked in inputs, complete results and decoded resource bytes. Cancellation,
source changes or changed runtime authority withhold replies and close the owned
read channel. The companion cannot undo requests already accepted by an MCP
server. It does not automatically open links, invoke discovered tools, log in,
or answer server-initiated approval/elicitation requests. MCP OAuth and tool
calls require their separate grants and lifecycle checks below.

## MCP tools on a loaded thread

Enable `OPERATIONS_CODEX_ALLOW_MCP_TOOLS=1` and the agent host opt-in, then enable
the current reviewed workflows in the encrypted pairing. **Update workflow
approval** refreshes a previous approval after the method contract changes;
stale approvals are excluded from workflow selection and rejected privately.
A runtime that reports `requiresOpenaiAuth: false` can run these workflows
without an OpenAI sign-in. That verified requirement is saved in the encrypted
profile and bound into its fingerprint. Legacy profiles without the flag keep
the account-required behavior; pair again to record a runtime that needs no
account. Account-required runtimes retain their existing sign-in checks.

Add **thread/start**, map `/result/thread/id` into **mcpServer/tool/call**'s
threadId and select the same paired runtime. Provide a configured server, tool
name and optional JSON arguments/metadata. The retained owned child keeps the
thread loaded across calls. A saved ID from a previous child needs an explicit
owned **thread/resume** first. Foreign, unloaded, busy or stale threads cannot
invoke tools. Browser inputs cannot replace transport or runtime configuration.
Codex supplies the authoritative thread ID for object metadata and may add its
own progress metadata; the complete result is preserved.

The call has a two-minute limit and never automatically retries a dispatched
effect. Cancellation disconnects the owned child and cannot undo effects already
accepted by a local/remote MCP server. The operator grant covers those configured
servers' own permissions, which can differ from the agent filesystem/network
sandbox. Extra server approvals, elicitation and credential requests are denied;
they do not gain authority from the tool call.

Results retain content, structuredContent, isError and metadata. An MCP
`isError: true` is the tool's application-level result, not a transport failure;
it stays visible without replay. Source-declared untyped values use bounded
plain JSON, typed fields remain strict, and known credentials are checked in
complete results and decoded text/image/audio/embedded-resource bodies. Inputs
fit 32 KiB with bounded JSON complexity. Results keep the 64 KiB frame bound,
at most 64 content items and 32 KiB per recognized body. OAuth workflow login
requires the separate sign-in grant below.

## MCP OAuth sign-in

`OPERATIONS_CODEX_ALLOW_MCP_OAUTH=1` enables **mcpServer/oauth/login** for a
configured HTTP MCP server. Without `threadId`, the operation owns a fresh
standalone SDK child and needs neither agent approval nor an OpenAI account.
With `threadId`, it uses the already-loaded thread and requires the agent
opt-in and current workflow approval. Successful sign-in keeps that thread
available for later tool calls. Neither path borrows the MCP read/tool grant.

Inputs preserve the pinned server name, optional scopes, `auto`/`cimd`/`dcr`
registration strategy and a 1–300 second callback timeout. Missing/null values
use SDK defaults; empty scopes add no explicit scopes, while provider defaults
can still apply. Credentials, callback overrides and runtime configuration
cannot be supplied through an operation.

The initial SDK acknowledgement supplies an authorization URL and login ID.
The run shows a transient **Open MCP sign-in** link and stays pending until the
matching `mcpServer/oauthLogin/completed` notification. Its typed completion is
the workflow result; the acknowledgement remains documented as `wireResult`.
Links allow HTTPS or literal loopback HTTP, carry no referrer, and reject
credentials, fragments and known secret echoes. The authorization URL is not
saved in workflow results.

The SDK owns PKCE, callback correlation, client registration and credential
storage in the configured runtime home. Cancellation, timeout, identity/source
changes or disconnect close the owned attempt without replay. A completed
provider grant or already-persisted SDK credential cannot be rolled back by
closing the child. Sign-in does not authorize extra server interactions.

## Command transport integration status

The standalone transport for `command/exec`, stdin writes, terminal resize and
termination is implemented behind `OPERATIONS_CODEX_ALLOW_COMMANDS=1`. The
four standalone command operations are available through the private worker and
workflow lifecycle below. `thread/shellCommand` uses the separate host grant and explicit unsandboxed
approval described below.

The role uses a separate ticket and requires explicit approval of prepared argv,
environment, output cap and canonical workspace cwd before SDK dispatch. It
rechecks the directory and runtime authority after approval. Process IDs belong
to that connection, cannot be reused there, and only live compatible processes
accept stdin/resize/termination. There are at most four active commands and 64
named IDs per connection. The local dispatched notification is progress; the
actual SDK result arrives after exit and queued stdout/stderr notifications.

Commands retain the configured read-only filesystem profile, private-home denial
and disabled network access. Browser input cannot replace the permission profile
or sandbox policy. Explicit timeouts are bounded to 300 seconds; a disabled SDK
timeout still ends with the 15-minute connection lease. Output capture defaults
to 16 KiB per stream, with the existing 64 KiB transport-frame bound. Canonical
base64 preserves streamed bytes; stdin controls accept at most 16 KiB decoded.
Known pairing-key echoes, including chunks split across notifications, are
withheld. The private worker checks the complete vault credential inventory in arguments,
stdin, terminal results and decoded output, including split and encoded values.

The pinned Linux PTY implementation resolves `codex-linux-sandbox` by name from
PATH. An opted-in runtime creates a private `.operations-dispatch` alias to the
verified configured binary and checks it with runtime authority. This alias
stays ahead of caller-supplied PATH entries; PATH cannot be unset. It is a
runtime-owned alias, not another installed binary or a shared CLI installation.
Actual SDK tests verify the configured sandbox, arbitrary stdin bytes, PTY size
changes, termination, disconnect cleanup and rejection of dispatcher changes.

Thread shell commands use a separate host opt-in. The pinned SDK deliberately
runs them unsandboxed; their empty immediate ACK is not terminal completion.
They do not inherit the standalone command or agent-tool grant.

### Standalone command workflow lifecycle

Add `command/exec`, select the paired runtime and enter executable/argv. Optional
`processId` is required for TTY or streamed stdin/output. The run dialog shows the
prepared command, cwd and environment and waits for **Allow once** before SDK
dispatch. Decline or cancel does not execute the command.

The **Command dispatched** ports carry a locally confirmed `processId`, with no
fabricated SDK result. Map that ID to `command/exec/write`, `command/exec/resize`
or `command/exec/terminate` to control the same running process. Resize requires
a TTY; stdin writes require TTY or streamed stdin. Controls cannot adopt an
unknown, ended or foreign process. Base64 inputs and output notifications retain
exact bytes, including non-text bytes.

**Command output** ports carry timestamped native output notifications. Charts
can receive subsequent samples; a downstream operation consumes its first mapped
sample once. **Result** ports remain unavailable until the actual terminal
`exitCode`, `stdout` and `stderr` arrive. A buffered command therefore releases
its form after dispatch while terminal consumers wait. Stopping the stream
terminates its named process, releases waiting branches and leaves sibling
processes and the next operation form intact. Ending the run, changing authority
or locking the vault tears down owned work without automatic replay.


## Thread shell commands

`thread/shellCommand` preserves shell syntax, including pipes, redirects and
quoting. It requires `OPERATIONS_CODEX_ALLOW_THREAD_SHELL=1`, the agent host grant,
current workflow approval and a thread created or resumed by that same live
workflow session. Foreign, unloaded and busy threads are rejected. The runtime
user's filesystem and network access apply: the SDK intentionally bypasses its
normal sandbox for this method.

The run dialog displays the exact shell command and its bounded execution
timeout, explains that it runs without a sandbox, and requires **Run once without
sandbox**. Approval is single use and belongs to that private request. Decline or
cancellation before approval does not execute the command. No approval reviewer
or automatic decision can be selected through workflow inputs. The timeout
profile defaults to five minutes, accepts 0–300000 ms, and remains subject to the
15-minute connection lease; zero is an immediate timeout.

The immediate SDK response is empty. Operations waits for the matching native
`item/completed` and `turn/completed` notifications instead. The workflow result
preserves both original events in `command` and `completion`, including native
timestamps when supplied. Command output, exit code and duration are typed under
`command.params.item`; turn status and ID are under `completion.params.turn`.
A nonzero command exit is preserved even when its enclosing turn completes.
These events are not combined into an invented SDK ACK or HTTP response.

Cancellation after approval interrupts the owned turn and waits for terminal
confirmation before releasing the runtime. Source, identity and vault changes
revoke the attempt without replay. Known vault secrets are checked in commands,
approval prompts and terminal fields, including Base64 and UTF-16 output.

## Public configuration and skill reads

Set `OPERATIONS_CODEX_ALLOW_CONFIGURATION_READ=1` on the companion and pair the
runtime to use `config/read`, `configRequirements/read`,
`experimentalFeature/list` and `skills/list`. These four reads require neither
provider sign-in nor enabled agent workflows. They reuse the same paired SDK
child; agent methods still need their own host grant and workflow approval.
An optional feature-list thread ID must belong to a loaded thread in that same
session, with agent authority. A saved thread ID alone is insufficient.

`config/read` exposes reviewed public model/preferences and policy fields.
Provider credentials, private connector/desktop maps and instruction bodies are
withheld, including from optional configuration layers. Requirements and skill
results retain their native structures. Working directories must resolve inside
the paired workspace and outside the runtime home; feature pages default to eight
entries and are bounded to 64. Known vault secrets, including encoded echoes,
are withheld from results. These grants do not enable configuration writes,
process-local feature changes, extra skill roots, MCP reloads or imports.

## Runtime feature, skill and MCP controls

`OPERATIONS_CODEX_ALLOW_CONFIGURATION_CONTROL=1` grants three controls on the
paired SDK session. This is separate from configuration reads, agent execution,
provider sign-in and persistent configuration changes. The runtime operator's
grant includes the documented process-wide effects and configured services.
Control-only sessions select the Operations tool permission profile, with private
home access denied and network disabled for tools. Configured MCP servers retain
their own permissions under the explicit control grant.

`experimentalFeature/enablement/set` updates named boolean overrides from the
pinned SDK's twelve accepted canonical feature keys. Omitted keys stay unchanged;
an empty object is a no-op. Enabling features can start configured background
services, including rollout migration. `skills/extraRoots/set` replaces up to
eight extra skill directories, resolved inside the paired workspace and outside
its private home. An empty list clears them. These settings affect the shared
child and are discarded when it disconnects; neither writes config.toml.

`config/mcpServer/reload` publishes refreshed MCP configuration to the process's
loaded threads. The workflow awaits the SDK response; this does not assert that
every server is ready. Configured MCP servers use their own credentials and
permissions. All loaded threads belong to the retained paired process. Agent
turns, tools, login and other configuration requests cannot overlap a control.
The companion accepts only the exact requested feature acknowledgement or native
empty result, rechecks authority and root boundaries, and rejects unknown fields.

Results and inputs retain known-credential checks. Cancellation closes the owned
child and never automatically retries a dispatched effect. It cannot undo
background work or external server effects already accepted. Arbitrary config
keys, private home roots, persistent writes and imports remain separate grants.

## Persistent preferences and skill overrides

`OPERATIONS_CODEX_ALLOW_CONFIGURATION_WRITE=1` grants `config/value/write`,
`config/batchWrite` and `skills/config/write`. Reads, controls, agent execution
and provider sign-in have independent grants. Select the paired runtime in the
workflow. The write profile uses the Operations tool permissions, with private
home access denied and tool network access disabled.

Preference edits accept `model`, `review_model`, `model_reasoning_effort`,
`model_reasoning_summary`, `model_verbosity`, `model_context_window`,
`model_auto_compact_token_limit`, `model_auto_compact_token_limit_scope`,
`service_tier`, `web_search` and `analytics.enabled`. Values retain the pinned
SDK types; JSON null removes an override. Batches accept up to sixteen ordered
edits. Both native merge strategies are retained for these scalar preferences.
The companion fixes the destination to its owned user config.toml and supplies
the inspected version when the caller omits it. An explicit stale version fails.
`reloadUserConfig` asks the SDK to refresh eligible settings on loaded threads;
session-static model defaults retain their native behavior.

Skill writes select exactly one workspace path or trimmed name. Disabling adds
or updates the first matching override; enabling removes it. Paths resolve
inside the paired workspace and exclude the private home. Symlink destinations,
hard-linked config files and hard-linked skill files are rejected. An existing
workspace skill symlink is accepted only when its canonical destination stays
inside the permitted workspace.

The companion privately compares before/after SDK layers, exact requested user
settings, native versions and every other runtime authority input. Raw snapshots
and SDK configuration errors stay private. Its receipt binds the method, request,
parameters and terminal result to a change in configuration identity only. The
worker checks that receipt and current secrets, reads fresh encrypted records,
and updates only the pairing under storage compare-and-swap. Unrelated record
changes are preserved. A no-op retains its pairing revision.

The SDK child and owned loaded threads survive a verified write. Later calls in
the unlocked client session advance exact references through worker-owned reply
metadata. The original workflow binding and up to 127 recent predecessor
references are retained per pairing; unknown fingerprints remain unchanged and
the worker rejects stale references directly. Locking or explicit runtime
management clears this convenience state. After a reload or reauthorization,
select the current pairing again. Reference metadata is separate from native
workflow results and never enters the workflow response body.

Writes serialize with turns, login, tools and other configuration operations.
Cancellation, source revocation, changed authority, mismatched receipts, secret
results or storage conflicts withhold adoption and close the owned session.
An already applied file change cannot be undone by cancellation. Uncertain work
is never retried or rolled back automatically; check the runtime explicitly
before continuing. Provider routing, credentials, permission keys and external
configuration imports require their own qualification.

### Owned active turn controls

**turn/steer** and **turn/interrupt** require the same approved agent runtime and
active turn owner as the pending operation. They can run through a named private
worker control call alongside that pending request. They never open a new child
or take over a foreign or idle thread. The running workflow shows controls for
sending a text instruction and stopping its own turn.

Steering preserves the required `expectedTurnId`, optional/null
`clientUserMessageId` and reviewed text input, including UTF-8 `text_elements`
byte ranges and placeholders. It shares the current text-only agent input
profile with `turn/start`; media/skill/mention inputs remain outside this
profile, while complete original wire schemas are retained. Its native result
must acknowledge exactly the requested turn. The acknowledgement does not
complete the parent turn.

Interruption preserves the native empty-object result and waits for the owned
interrupted terminal event plus acknowledgement before retiring the owner. An
empty `turnId` retains the SDK's startup-cancellation semantics, scoped to its
own pending thread. Parent failures/cancellation cannot close the shared channel
before an in-flight control acknowledges or fails. Invalid controls do not
replace or authorize the running workflow; source, vault, account and runtime
checks remain active. Steering is limited to ordinary text turns; review,
compaction and shell work retain Stop without accepting steering input.

### Review and compaction

`review/start` and `thread/compact/start` use the approved agent runtime and an
idle owned thread loaded by that connection. Both wait for their matching
`turn/completed` event. Acknowledgement alone does not complete the workflow;
failed, interrupted, foreign, duplicate or revoked results cannot advance it.
The run dialog retains Stop while either operation is active.

Review targets retain `uncommittedChanges`, `baseBranch` with `branch`, `commit`
with `sha` and optional nullable `title`, and `custom` with `instructions`.
The SDK forwards a delegate turn-start event during inline review. Its observed ID is used for native Stop; the parent operation ID remains the acknowledgement and completion owner. A delegate cannot supply a parent result. The result preserves `reviewThreadId` and the completed native `turn`. Inline
delivery accepts omission, null or `inline`. The pinned stable 0.163.0 SDK
rejects detached reviews on its default paginated history. Selecting legacy
history requires the experimental API, which this pairing profile keeps disabled.
Operations therefore identifies `delivery` when detached review is requested;
it never silently changes the delivery mode.

Compaction accepts only `threadId` and retains the native empty-object result,
published after the owned compaction turn finishes. Neither operation can
override provider, workspace, history content, sandbox or approval policy.

### Guardian denials

The companion owner enables `OPERATIONS_CODEX_ALLOW_GUARDIAN=1` alongside the
agent grant. A workflow must then explicitly choose `auto_review` in the
**Approval reviewer** field of `thread/start` or `thread/resume`; omission keeps
`user`. The companion and private worker verify the acknowledged reviewer.
Other parameters cannot replace the permission profile, provider or workspace.

`thread/approveGuardianDeniedAction` selects `threadId` and a `reviewId` observed
during a foreground agent turn on that same live connection. The run dialog
offers its recent denial IDs for selection. Both the companion and worker
validate the native started/completed review, unchanged action, thread, turn
and current authority. Reconnects, discarded history, unknown IDs, changed
actions, replay and expired reviews cannot acquire an approval.

The human confirmation displays the exact action, rationale, risk and assessed
authorization. Only **Approve one retry** dispatches the selected native event;
decline, cancellation, source/vault revocation and changed identity prevent it.
Native acknowledgement retains `{}` and queues an approved-action context
fragment. It does not execute or automatically retry the action. The next turn
can use that recorded permission. Unknown outcomes are never replayed.

All seven pinned action variants retain their native conversion: command,
execve, stdin, patch, network, MCP tool and requested permissions. Local stdin
and permission paths use the host's path-URI conversion. Native credential
echo checks and private worker filtering precede public confirmation. Editable
raw events are excluded from workflow input; the original wire schema stays
available. Capture is bounded to 32 pending/recent reviews, 256 lifecycle IDs
per connection and ten-minute freshness, with 48 KiB notification payloads and
60 KiB prepared native events. Autonomous goal events keep their existing
noninteractive boundary. Reviewed text content permits newlines and tabs;
identifiers and paths keep their existing strict validation.

### Credit-reset and credit-email actions

`OPERATIONS_CODEX_ALLOW_ACCOUNT_ACTIONS=1` independently enables
**account/rateLimitResetCredit/consume** and **account/sendAddCreditsNudgeEmail**.
Each attempt requires explicit confirmation of its action, parameters and
available native account metadata. Approval tokens are single use and bound to
the pending request. Decline, cancellation or changed account/configuration/
workflow authority prevents dispatch. Native SDK authentication remains
responsible for requiring the signed-in ChatGPT backend account; provider
metadata hiding does not prevent an otherwise authenticated action.

A reset requires an opaque nonempty `idempotencyKey`; a UUID is recommended.
Reuse the same value to retry the same logical attempt. Optional `creditId`
selects a particular reset credit; omission or null lets the backend select one.
Outcomes remain `reset`, `nothingToReset`, `noCredit` or `alreadyRedeemed`.
Email retains `creditType: credits | usage_limit` and native `sent` or
`cooldown_active` status. Operations does not automatically replay either action.
These operations keep their typed native results and never acquire agent or
primary-account control. The companion verifies pinned native identity and
metadata before dispatch and before publishing a result; native errors remain
private.

### Gateway sign-in

`OPERATIONS_CODEX_ALLOW_GATEWAY_OAUTH=1` enables **account/gatewayOAuth/login**
and **account/gatewayOAuth/cancel** independently of account sign-in and agent
execution. Both operations have empty inputs and native empty-object results.
The configured provider owns its authorization and token endpoints. Its sign-in
link appears only while the request is pending; it must match the configured
authorization origin and path. Native failures remain private.

Login waits for native completion and a confirmed successful gateway state.
Only the owned secondary encrypted-store transition may advance the saved
pairing reference; primary credentials, workspace and configuration remain
pinned. Cancellation acknowledges release of the owned native login slot,
including when its login error arrives before the cancellation response.
Closing the owner cancels its native connection. No active login yields the
native empty cancellation acknowledgement.

Every trusted initialization declares `explicitGatewayOauth: true`, so passive
reads do not initiate sign-in. Native authority includes `auth.json`,
`secrets/codex_auth.age` and `secrets/gateway_oauth.age`. Lock files and creation
of an empty secrets directory do not change credential authority. The SDK owns
encrypted storage and its OS keyring requirement.

### Migration workflows

The four `externalAgentConfig` methods use a paired runtime with the independent
migration grant and protected source home. They do not require an account or a
loaded thread. Detection retains source selectors, attribution, repository
directories, session limits and connector metadata. Select the detected item
metadata for import; configuration, instructions, skills, plugins, MCP servers,
subagents, hooks, commands, memory and sessions retain their native semantics.
Plugin imports use home scope. Some native kinds import their complete selected
scope rather than treating detail-name lists as filters.

An import response is published only after the companion verifies its matching
completion, file/configuration effects and persisted history. The private
worker validates its receipt and atomically saves the new pairing identity and
private credential candidates with fresh vault records. Other records survive;
cancelled, revoked, conflicting and mismatched results cannot advance a binding.
Short imported values use scoped metadata matching while opaque content bytes
retain exact matching. MCP URL, header, bearer and environment credentials stay
inside encrypted records, separate from public connection summaries.

Later nodes can retain the original saved runtime reference: the client advances
it only through an exact worker-owned transition. Direct stale worker references
remain invalid. History is metadata and does not load or authorize imported
threads. Public detection/history results withhold transcript-derived titles
and raw native failure text while preserving their classified fields.


### Read plugin catalogs

The five plugin read operations use the existing paired runtime without enabling agent workflows or configuration writes. `plugin/read` requires exactly one local marketplace JSON file or remote marketplace name. `plugin/skill/read` requires the remote marketplace, remote plugin ID and skill name. Omitting marketplace kinds preserves the SDK's default catalog behavior. Directories and local source references are checked by the companion, and source/account/schema changes, cancellation or vault lock invalidate a pending read. Plugin installation and share publishing require their separate operations and grants.


### Manage marketplaces

Marketplace operations use the paired runtime without enabling agent workflows. The companion owner must separately enable marketplace management. Add accepts a workspace directory, Git URL or owner/repository, with optional Git reference and sparse directories. Credential-bearing URLs and checkout options are rejected; Git authentication belongs to the companion. Remove preserves a local source directory and deletes only an owned private clone/registration. Upgrade targets one configured Git marketplace or all of them when the name is omitted. Its typed result retains selected names, upgraded roots and per-marketplace errors. Verified configuration changes update the encrypted runtime binding for subsequent workflow steps.

### Install, remove and reconcile plugins

Plugin management uses the paired runtime with its separate owner grant. Install selects exactly one local marketplace file or remote marketplace name and preserves an optional installation correlation ID. Local marketplace sources can reference workspace, Git or npm packages; authentication stays in companion configuration. The typed result retains native authentication policy and apps requiring authentication. Uninstall accepts a local name@marketplace ID or a remote backend ID and preserves workspace source files. Reconcile accepts an optional nullable reason, including multiline text, and returns only that pass's changes and backend/materialization failures. It does not promise that every affected runtime is ready. Each verified mutation updates the encrypted runtime binding for later workflow steps; lost acknowledgements are not retried automatically.

### Publish and check out plugin shares

The four sharing operations use the paired companion's separate sharing grant and ChatGPT account. Save publishes a reviewed plugin directory; set a remote ID to update its package. On creation, omit access policy for the native default or choose PRIVATE/UNLISTED. Use Update share targets for user/group reader/editor access and LISTED publishing. UNLISTED adds the native workspace reader automatically; clients cannot supply workspace targets directly. Checkout downloads a private/unlisted shared package into the companion's personal HOME marketplace and preserves edits on repeat checkout. An already-associated workspace source is reused for editing/publishing rather than overwritten by checkout. Delete removes the remote share and its association while preserving local files. The current pairing remains valid when its local authority is unchanged; every result still requires its own verified receipt.

### Read Windows sandbox readiness

The readiness operation uses a separate companion-owner grant and needs no agent/account approval. It returns the native status, including `notConfigured` on the qualified Linux host. Windows provisioning/start is omitted from the active catalog until its Windows implementation is qualified; a start acknowledgement alone cannot stand in for its asynchronous completion.
