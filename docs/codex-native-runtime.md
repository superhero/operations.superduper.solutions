# Pair a private Codex runtime

Operations can pair with an optional companion that you control. The production
vault worker owns its HTTPS ticket request, WSS connection, native initialization
and read-only account check. A paired runtime can run the `account/read` and
`initialize` workflow operations without a provider login. The native schema
preserves all 105 methods; the active catalog exposes 104 and omits Windows
provisioning setup until its runtime is qualified.
Four metadata-read workflows are available with the separate host opt-in below.
Three standalone app metadata workflows have a separate connector-access opt-in.
Feedback uploads have separate delivery and diagnostics opt-ins.
Workspace file reads, metadata, directory listing and search have their own read grant.
The optional [bounded workflow adapter](codex-native-workflows.md) separately
enables three reviewed operations after host and encrypted-profile opt-in.

The initial profile is `codex-stdio-paired-v1`, pinned to Codex **0.163.0** and
Node **26.7.0**. The [qualified transport contract](codex-native-connector.md) and
[native model boundary](native-rpc-models.md) explain the source and authority.
The [pinned upstream schema](https://raw.githubusercontent.com/openai/codex/rust-v0.163.0/codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.schemas.json)
defines native request IDs, initialization and `account/read` parameters.

## Companion setup

Use a dedicated Linux host/container identity, owner-only runtime home and
operator-approved workspace. Supply the actual pinned Codex executable and its
SHA-256; a desktop application wrapper is not a substitute. The companion checks
the digest and `codex --version` before accepting browser connections. It never
downloads or replaces the installed binary.

Install this project's pinned dependencies and configure these environment
variables before `npm run companion:codex`:

| Variable | Value |
| --- | --- |
| `OPERATIONS_CODEX_PUBLIC_ORIGIN` | Exact HTTPS origin, without a trailing slash. |
| `OPERATIONS_CODEX_ALLOWED_ORIGINS` | JSON array of exact approved Operations origins. HTTPS is required except for an explicitly selected loopback development application. |
| `OPERATIONS_CODEX_PAIRING_KEY_FILE` | Owner-only file containing a random 32-byte base64url key. Generate it with Node's `randomBytes(32).toString('base64url')`; keep it out of command arguments, logs and URLs. |
| `OPERATIONS_CODEX_RUNTIME_ID` | Operator-assigned UUID for this runtime. |
| `OPERATIONS_CODEX_EXECUTABLE` | Absolute path to the pinned native binary. |
| `OPERATIONS_CODEX_BINARY_SHA256` | SHA-256 of that executable. |
| `OPERATIONS_CODEX_HOME` | Dedicated canonical directory with mode 0700, owned by the companion user. The desktop/default Codex home and symlinked home are rejected. |
| `OPERATIONS_CODEX_WORKSPACE` | Existing approved workspace; browser requests cannot replace it. |
| `OPERATIONS_CODEX_ALLOW_AGENT` | Optional `1` to permit the separately approved bounded workflow scope. Omit for read-only pairing. |
| `OPERATIONS_CODEX_ALLOW_GUARDIAN` | Optional `1`, together with the agent grant, to permit an explicit `auto_review` thread choice and human-confirmed approval of an observed denial. Human review remains the default. Changes invalidate the previous runtime configuration binding. |
| `OPERATIONS_CODEX_ALLOW_METADATA` | Optional `1` to permit the four reviewed metadata-read workflows. Independent of agent execution; changing it invalidates existing pairing authority. |
| `OPERATIONS_CODEX_ALLOW_APPS` | Optional `1` to permit standalone app metadata. Listings and installed refresh may start the configured connector runtime and fetch remote inventories. Independent of metadata/agent opt-ins; changing it invalidates pairing authority. |
| `OPERATIONS_CODEX_ALLOW_MCP_READ` | Optional `1` for standalone MCP inventory and resource reads. May start configured stdio servers and contact configured remote endpoints using runtime credentials. Does not authorize tools, OAuth login or thread-bound reads; independent of all other opt-ins. |
| `OPERATIONS_CODEX_ALLOW_MCP_TOOLS` | Optional `1`, together with the agent opt-in, for direct MCP tool calls on a thread loaded by this paired workflow. Tools use the configured MCP server's permissions; this grant does not authorize extra server interactions. |
| `OPERATIONS_CODEX_ALLOW_MCP_OAUTH` | Optional `1` for MCP OAuth sign-in and SDK credential persistence. Independent of MCP reads, tools and account sign-in. Supplying a thread also requires the agent opt-in, current workflow approval and a thread loaded by that session. |
| `OPERATIONS_CODEX_ALLOW_COMMANDS` | Optional `1` for four independently approved standalone command workflows. They use the configured read-only sandbox, disable network access and deny the private runtime home. Each execution requires explicit approval; process controls stay connection-owned. Does not grant thread shell execution. |
| `OPERATIONS_CODEX_ALLOW_THREAD_SHELL` | Optional `1`, together with the agent grant and current workflow approval, for `thread/shellCommand` on an owned idle loaded thread. The SDK runs it without its sandbox. Each command requires explicit confirmation; neither standalone commands nor agent tools grant this access. |
| `OPERATIONS_CODEX_ALLOW_THREADS_READ` | Optional `1` for eight stored-thread/history/goal/attachment reads inside the paired workspace. Independent of agent execution and provider sign-in. Native metadata inspection checks the workspace before reading thread contents; listings never grant agent execution. Changing this grant invalidates pairing authority. |
| `OPERATIONS_CODEX_ALLOW_ACCOUNT_READ` | Optional `1` for gateway readiness, account usage, rate limits and workspace messages. Independent of agent execution and workflow approval. The three backend reads require ChatGPT sign-in; gateway readiness also works anonymously. Native credentials remain private, and credential or configuration changes invalidate pairing authority. |
| `OPERATIONS_CODEX_ALLOW_ACCOUNT_AUTH` | Optional `1` for public API-key/browser/device sign-in, owned cancellation and logout. Uses a separate scope with no agent authority. Saved keys remain private; transient instructions wait for native completion and confirmed account metadata. Successful account changes update encrypted pairing references and invalidate prior thread ownership. May refresh configured SDK provider/plugin caches. |
| `OPERATIONS_CODEX_ALLOW_GATEWAY_OAUTH` | Optional `1` for explicit secondary gateway sign-in and owned cancellation. Uses a separate scope with no agent or primary-account control. The provider and OAuth endpoints come from native configuration; workflows take no endpoint or credential overrides. Successful native completion and gateway readiness confirmation advance the encrypted pairing reference. |
| `OPERATIONS_CODEX_ALLOW_ACCOUNT_ACTIONS` | Optional `1` for credit-reset consumption and add-credit email. Uses a separate scope and requires one explicit confirmation for the exact native action and parameters. Grants no agent, login, gateway or credential control. The SDK requires ChatGPT backend authentication, including when the configured model provider hides account metadata. No application replay is performed. |
| `OPERATIONS_CODEX_ALLOW_THREADS_WRITE` | Optional `1` for fourteen lifecycle, metadata, attachment, goal and history mutations. Archive/delete inspect every persisted or loaded descendant before dispatch. Fork, goal updates and history edits also require agent authority, workflow approval and an owned loaded source. Goal clear remains available with pairing authority. Native SQLite state is pinned to the dedicated private runtime home (or its migration history directory). Goals require the SDK's goals feature. Changing this grant invalidates pairing authority. |
| `OPERATIONS_CODEX_ALLOW_CONFIGURATION_READ` | Optional `1` for public configuration, requirements, feature and skill reads. Independent of agent execution and provider sign-in; does not grant writes or imports. Reads reuse the paired SDK session. Changing the grant invalidates pairing authority. |
| `OPERATIONS_CODEX_ALLOW_CONFIGURATION_CONTROL` | Optional `1` for process-wide feature overrides, workspace skill roots and MCP reload on the paired SDK session. Independent of reads/agent sign-in. Feature changes can start background services; MCP refresh may use configured servers and credentials. Does not authorize persistent config writes or imports. Changing it invalidates pairing authority. |
| `OPERATIONS_CODEX_ALLOW_CONFIGURATION_WRITE` | Optional `1` for reviewed public preferences and skill overrides in this runtime's user config.toml. Independent of reads, controls and agent sign-in. Verified writes update the encrypted pairing while retaining its child and loaded threads. Provider/credential/permission keys and imports remain unavailable. Changing the grant invalidates pairing authority. |
| `OPERATIONS_CODEX_ALLOW_FILESYSTEM_READ` | Optional `1` for the four reviewed workspace read/search methods. Independent of metadata, app and agent grants; it does not enable native writes or watches. |
| `OPERATIONS_CODEX_ALLOW_FILESYSTEM_WRITE` | Optional `1` for four reviewed workspace mutations. Independent of reads/metadata/apps/agent grants; excludes runtime configuration, private home and executable. Does not enable watches. |
| `OPERATIONS_CODEX_ALLOW_FILESYSTEM_WATCH` | Optional `1` for workspace watch/unwatch workflows and their dedicated authenticated channel. Independent of reads, writes, metadata, apps and agent grants. |
| `OPERATIONS_CODEX_ALLOW_THREAD_SECTIONS_READ` | Optional `1` for `threadSection/list` in the runtime's section store. Does not authorize section writes. |
| `OPERATIONS_CODEX_ALLOW_THREAD_SECTIONS_WRITE` | Optional `1` for section creation, rename/appearance updates and deletion. Does not authorize listings or other native methods. |
| `OPERATIONS_CODEX_ALLOW_FEEDBACK` | Optional `1` to permit explicit feedback uploads to OpenAI's feedback service. Off by default; Codex feedback is also disabled in the child when this grant is off. |
| `OPERATIONS_CODEX_ALLOW_FEEDBACK_DIAGNOSTICS` | Additional optional `1` to permit selected runtime logs, owned-thread rollouts and workspace files in feedback. Neither grant enables the other. Both bind runtime authority. |
| `OPERATIONS_CODEX_TLS_KEY_FILE`, `OPERATIONS_CODEX_TLS_CERT_FILE` | TLS key and device-trusted certificate files. |
| `OPERATIONS_CODEX_LISTEN_HOST`, `OPERATIONS_CODEX_PORT` | Default `127.0.0.1` and 8446. Bind a reachable interface only under the operator's access policy. |

An operator-controlled TLS reverse proxy may terminate HTTPS/WSS instead. In that
case set `OPERATIONS_CODEX_TRUSTED_TLS_PROXY=1`; the cleartext backend must remain
bound to `127.0.0.1` or `::1`. Forward WebSocket upgrades and preserve the browser's
Origin. The public endpoint still requires trusted HTTPS/WSS. No HTTP loopback
exception is added to the application's native credential policy.

The child uses the dedicated home for `HOME` and `CODEX_HOME`, a file credential
store, analytics disabled and a read-only sandbox. Ambient provider keys are not
copied into its environment. Only the configured executable/workspace is used;
browser inputs cannot replace its launch command, environment or permission
profile. The independent configuration-write grant permits the reviewed user
preferences described in [native workflows](codex-native-workflows.md#persistent-preferences-and-skill-overrides).
Auth/config symlinks are rejected. File authority, executable metadata and
workspace identity are checked again before native dispatch.

## Pairing and lifecycle

Save the pairing key in the existing vault, then use **Settings → Secrets →
Native runtimes**. Choose its vault reference, companion HTTPS origin and name.
The pairing key and native responses stay in the worker; the page receives
connection metadata and an account type, without provider tokens or account email.

Ticket creation requires the key and exact Origin. A ticket expires within 30
seconds, is consumed once in the first WSS frame and is never placed in a URL,
cookie or subprotocol. Unauthenticated sockets have a five-second deadline.
The host bounds tickets 16, unpaired sockets 4, frames 64 KiB and pending RPCs 8;
the worker bounds combined connected/opening runtimes 4. A companion instance
permits one active browser owner. Sessions expire after 15 minutes and require an
explicit reconnect; no write or turn is replayed.

The pairing scope allows only native initialization and `account/read` with
`refreshToken: false`. The companion enforces ordering and parameters, correlates
responses, rejects arbitrary methods and refuses interactive server requests.
Model/schema approval is checked privately before and after network work.

The `initialize` workflow uses a separate initialization-only ticket. It replaces
the selected runtime's current channel, starts a fresh owned child and returns
that child's `InitializeResponse`. The client identity is fixed to Operations
with public capabilities. This scope cannot read the account or run agent methods.
The companion rechecks runtime authority before forwarding a read-only response;
an account/workspace change while a request is pending withholds the reply.

With `OPERATIONS_CODEX_ALLOW_METADATA=1`, a separate exact-method ticket permits
`model/list`, `modelProvider/capabilities/read`, `permissionProfile/list` or
`hooks/list`. Each channel can execute only its selected query after initialization.
Directory inputs resolve inside the canonical workspace and cannot enter the
credential home or escape through symlinks. Queries require neither a provider
login nor the agent opt-in. Results must match their complete reviewed schema;
unknown fields and known vault credentials withhold the result.

With `OPERATIONS_CODEX_ALLOW_APPS=1`, the same exact-method transport supports
`app/installed`, `app/list` and `app/read`. This grants connector inventory access,
including configured MCP startup for listing/refresh, without granting native
agent methods or tool invocation. Loaded-thread configuration is not part of
this standalone profile; `threadId` inputs are rejected. Provider account and
connector feature gates remain enforced by Codex.

With `OPERATIONS_CODEX_ALLOW_FILESYSTEM_READ=1`, exact-method query tickets support
`fs/readFile`, `fs/readDirectory`, `fs/getMetadata` and `fuzzyFileSearch`. The SDK's
filesystem executor receives no agent sandbox for these calls, so the companion
checks canonical paths itself. Relative inputs resolve from the authorized
workspace; credential-home paths and escapes are rejected. File reads require
regular files with one link, up to 32 KiB; directory listings allow 256 direct
entries. A safe leaf symlink remains visible to metadata inspection, while file
reads use its checked canonical target.

Search accepts up to four canonical workspace roots and preserves the SDK's
50-match limit. Roots cannot contain the credential home. Returned matches must
belong to their selected roots, remain inside the workspace and resolve outside
the credential home before publication. All results retain the native 64 KiB
frame budget. Oversized data is rejected, never silently truncated. The private
worker checks decoded base64 file contents for known credential echoes before
returning the unchanged native base64 result. Source, runtime and account changes
and cancellation discard pending data and close the owned read.

With `OPERATIONS_CODEX_ALLOW_FILESYSTEM_WRITE=1`, separate exact-method tickets
permit `fs/writeFile`, `fs/createDirectory`, `fs/copy` and `fs/remove`. Each uses a
fresh owned child and one mutation; requests are never cached or replayed.
Canonical source/destination checks exclude the credential home, workspace
`.codex` configuration, executable and their ancestors. Existing hard links and
special files are rejected. Copy/remove trees are checked before dispatch, with
256 entries, 16 levels and 4 MiB total file data per operation; writes accept up to
32 KiB of canonical base64 bytes. Known credential values in decoded write inputs
are rejected by the private worker. These checks do not lock the workspace
against concurrent local editors or provide transactional rollback.

Parent directories are canonicalized while leaf symlinks retain SDK semantics:
writing follows an authorized target, copying preserves the link text, and
removing unlinks the link. Source links and their projected copy destinations
must stay in the allowed workspace. Recursive and force flags retain the pinned
wire defaults: create/remove default to true, directory copy requires explicit
true, and force defaults to true. Only the native empty-object acknowledgement
completes a mutation. Errors, cancellation or authority changes withhold success;
changes already applied may remain. Watches use their own separate grant.

The independently granted `codex-filesystem-watch` scope keeps one owned child
for `fs/watch` and `fs/unwatch`. Each HTTPS ticket and WSS frame retains the exact
allowed Origin, pairing key, runtime, workspace and account authority. The grant
is bound into runtime configuration identity. Other RPC methods are rejected on
this channel even when other operator grants are enabled.

Up to eight non-recursive watches may use distinct connection-owned IDs. Roots
are canonical workspace files/directories outside the private home; roots that
contain the private home are excluded. Pending requests and early notifications
are bounded. Registration acknowledgement precedes notification delivery, and
unwatch acknowledgement ends delivery for that ID. SDK notification timestamps
are preserved. The private worker cancels a subscription with an acknowledged
`fs/unwatch`, preserving sibling watches; removing the last subscription closes
the owned child. Wire-level request cancellation closes its channel. After a root
is removed or replaced, only a notification naming that
already-known root alone may be sent before the channel closes; other ambiguous
or escaped paths are withheld.

The private worker and client retain at most eight pending watch subscriptions
and permit one ordinary vault command alongside them. Ordinary commands remain
serialized. Events pass schema, credential and authority checks before delivery;
the private delivery queue is bounded to 32 notifications. Credential changes
and vault locking revoke subscriptions. A different native role cannot silently
replace an active watch on the same runtime profile.

The two workflow methods preserve native acknowledgements and typed
`fs/changed` outputs, including SDK timestamps. Acknowledgement starts the stream;
notification-dependent steps wait for a real event. Charts receive subsequent
events while ordinary downstream steps run once. The stream retains its final
known-root notification even when authority loss ends it with an error.

The complete workflow path is verified over authenticated HTTPS/WSS with the
pinned SDK and production browser worker, including explicit unwatch, stop and
root removal. See [watch workflows](codex-native-workflows.md#watch-workspace-changes)
for setup and output mapping.

Feedback uses an exact `feedback/upload` ticket with one upload per fresh owned
child. Metadata, app and agent opt-ins do not grant it. The browser's message and
tags are checked for known vault credentials before dispatch; acknowledgements
must contain only the reviewed thread ID and optional prompt hash.
The basic event also includes the SDK's standard version/session and available
account metadata. The diagnostics opt-in controls attachments, not those event fields.

`includeLogs` and `extraLogFiles` explicitly select diagnostic sharing and require
the additional host grant. Codex owns runtime-log/rollout collection; these
contents are not previewed or redacted by the browser. A thread ID must belong to
this host generation/account. On the qualified Linux host, selected files are
confined to the workspace, exclude the credential home, reject hard links and
special files, and are frozen into private 0600 snapshots. Limits are eight files,
2 MiB each and 8 MiB total. Duplicate paths retain first order. Snapshots are
removed after acknowledgement or owned-child shutdown.

Uploads preserve the SDK's five-minute delivery deadline with ten seconds of
transport headroom. Only ticket acquisition can wait for a previous owned child
to close; an upload is never automatically replayed. Cancellation cannot undo
an accepted report, and an unverified acknowledgement requires checking delivery
before retrying. The host's existing Codex feedback configuration can still deny
an upload even when the companion opt-in is enabled.

Saved profiles live inside the pairing key's encrypted vault record and bind the
current schema fingerprint, key hash, runtime generation/version, configuration,
workspace and host-owned account epoch. Reload locks the vault and releases the
socket. After unlocking, reconnect is explicit. Changed runtime/account authority
requires removing the old pairing and explicitly pairing again. Replacing or
removing its vault key invalidates the saved pairing.
The workflow adapter handles its own explicitly initiated public sign-in as a
managed account transition, then saves a new encrypted profile revision.

Disconnect, cancellation and vault lock revoke the owned transport and stop only
its child. Closing attempts are tracked before pairing completes as well. The
companion waits for that child to exit; it preserves the isolated credential and
thread files and never logs out or stops another native daemon. An unreachable
network makes immediate remote cleanup unconfirmed; heartbeat/session limits
bound abandoned ownership. Profiles can be removed locally without remote access.

## Qualification and mobile limits

Deterministic Gherkin covers TLS/Origin/key/ticket rejection, queues, correlation,
expiry/cancel, source and account changes, encrypted reload, file authority and
owned shutdown. Browser scenarios use the actual production worker and companion
HTTPS/WSS handlers with production cross-origin headers. Test certificates are
trusted only in explicitly tagged fixtures; another case proves normal certificate
validation rejects them. An opt-in Gherkin evaluation under `tests/evaluations/`
uses the verified real binary, a temporary private home/workspace and no account
login, provider request or agent turn. The [recorded evaluation](evidence/codex-native-runtime-0.163.0.json) retains the binary and implementation pins. Run that opt-in feature with `OPERATIONS_CODEX_QUALIFICATION_BINARY` and `OPERATIONS_CODEX_QUALIFICATION_SHA256` configured, using `node tests/gherkin/run.mjs browser tests/evaluations/native-runtime.feature` inside the declared isolated CI-equivalent resource boundary.

A phone or tablet cannot use a different computer's `localhost`; it needs a
reachable host and a certificate trusted by that device. Deployed CSP/network
permissions, real host/certificate/origin/workspace provisioning, Safari/Firefox
and an authorized provider account remain live qualification inputs. Pairing does
not inherit the desktop account, prove provider credentials/model entitlement or
deploy a shared runtime.

On Linux, thread workflows need the pinned SDK's sandbox support. Install the
matching full Codex distribution with its `codex-resources/bwrap` helper, or a
supported system bubblewrap. A standalone executable may support account and
metadata reads while failing to create a sandboxed thread. The host must permit
the SDK's user/mount namespaces; keep the Operations permission profile enabled.

## Configuration migration

`OPERATIONS_CODEX_ALLOW_MIGRATION=1` independently permits
`externalAgentConfig/detect`, `externalAgentConfig/import`,
`externalAgentConfig/import/readHistories` and
`externalAgentConfig/import/recordHistory`. It requires
`OPERATIONS_CODEX_MIGRATION_HOME` to name a canonical, runtime-user-owned 0700
directory. CODEX_HOME must be its direct child. Keep this protected source home
separate from the paired workspace and the operating-system account's actual
home. Stage `.claude` or `.cursor` configuration there; the child receives that
directory as HOME. No provider login or agent-workflow approval is required.

The input profile retains every native item kind: instructions, configuration,
skills, plugins, MCP servers, subagents, hooks, commands, memory and sessions.
Repository inputs resolve to the SDK's actual repository scope; plugin imports
are home-only. Sources, native caches and destinations reject aliases and paths
outside their authorized roots. Inventories allow 4096 entries, 64 MiB total and
8 MiB per file. Migration frames retain the 64 KiB transport limit and reserve
512 bytes for the request envelope.

Imports wait for verified file/configuration effects and the exact newly
persisted native history row. The encrypted pairing then adopts the matching
identity and imported private values under storage CAS. Session-derived titles
and raw failure messages do not enter public results; connector metadata does.
Recording external history grants no thread authority. Cancellation and failed
adoption close the owner without replaying or undoing applied files; inspect
the runtime and import history before another attempt.


### Plugin catalog reads

`OPERATIONS_CODEX_ALLOW_PLUGINS_READ=1` independently grants `plugin/installed`, `plugin/list`, `plugin/read`, `plugin/skill/read` and `plugin/share/list`. It does not grant agent execution, installation, marketplace writes or share publishing. The grant is part of the pinned runtime identity. Local marketplace discovery and plugin resources stay within the paired workspace or dedicated plugin caches; redirected components and changed workspace source witnesses reject the request. Remote catalog, skill and share reads use the companion's signed-in ChatGPT account. Plugin results retain the native typed shape and pass account-credential and encrypted-vault privacy checks. A forced catalog refresh can update caches and refresh configured MCP/hook runtimes.


### Marketplace management

`OPERATIONS_CODEX_ALLOW_MARKETPLACES=1` independently grants `marketplace/add`, `marketplace/remove` and `marketplace/upgrade`. It does not enable agent execution, preference writes, plugin installation or share publishing. The owner grant and private HOME Git configuration are included in runtime identity. Local sources/resources stay within the paired workspace; Git origins and activated revisions are verified in the private marketplace cache. Adding registers or clones a source, removal deletes only its private cached clone and registration, and upgrade may refresh configured extension runtimes. Exact configuration/cache effects produce a method/input/result-bound receipt before the encrypted pairing advances. Applied effects are not retried after cancellation, changed authority or a failed verification.


### Plugin installation and reconciliation

`OPERATIONS_CODEX_ALLOW_PLUGIN_MANAGEMENT=1` independently grants `plugin/install`, `plugin/uninstall` and `plugin/reconcile`. Agent, plugin-read, marketplace and preference-write grants remain separate. The companion privately resolves selected plugin metadata, confines local manifests/resources to its workspace or private plugin caches, and rejects credential-bearing Git/npm URLs and option-shaped source selectors. Private HOME Git/npm configuration is part of runtime authority. Installation may activate MCP servers, start configured OAuth and refresh hooks; its native authentication policy and apps-needing-auth result remain unchanged. Uninstall verifies selected package removal and preserves workspace sources. Local enablement/removal and eligible listed-workspace hook trust are checked against exact user configuration effects; unrelated layers/settings/packages invalidate the result. Verified effects advance the existing encrypted pairing through an exact method/input/result receipt. Accepted effects are not automatically retried after a lost result or cancellation.

Reconciliation returns changes observed by that pass, not runtime readiness or a cumulative diff. Changed flags retain the SDK's old/new capability semantics; enablement/removal hints need not imply new files. Failure identifiers and previously cached bundles remain meaningful even when a new bundle cannot be downloaded. Identical metadata rewrites do not count as unrelated package content changes. Remote HTTPS bundle trust can use the owner CA configuration below; normal certificate and hostname checks remain enabled.

### Private CA trust for outbound SDK HTTPS

Set `OPERATIONS_CODEX_CA_CERTIFICATE` to an absolute, canonical PEM certificate file inside the dedicated runtime home when its outbound SDK HTTPS services use a private CA. The file must belong to the runtime user, contain certificate blocks only, fit 64 KiB and 32 certificates, and have no links or shared write access. The companion supplies the SDK's `CODEX_CA_CERTIFICATE` variable through its clean child environment and includes the certificate digest in runtime authority. Changing the CA file invalidates the current binding. Certificate and hostname verification remain enabled; this setting does not supply a client private key.

### Plugin sharing

`OPERATIONS_CODEX_ALLOW_PLUGIN_SHARING=1` independently grants `plugin/share/save`, `plugin/share/updateTargets`, `plugin/share/checkout` and `plugin/share/delete`. These operations require the companion's ChatGPT sign-in. Agent execution, marketplace/installation management, public plugin reads and preference writes remain separately granted. Sharing privately queries account and selected share metadata; native authenticated APIs enforce remote authorization. Source folders must be canonical owned workspace packages or personal plugin checkouts, without redirected files or managed runtime data. File witnesses and checks for this runtime's credentials precede uploads. Native failures, changed source/configuration/associations, mismatched permissions, cancelled requests and missing or substituted receipts cannot confirm completion. Dispatched effects are not automatically retried.

Save uploads the selected directory as a gzip plugin bundle, then creates a share or updates the supplied remote ID. Upload URLs/ETags remain private to the SDK, and blob requests carry no account authorization header. New shares accept nullable/omitted policy or explicit PRIVATE/UNLISTED; existing shares change access through updateTargets. Clients supply user/group reader/editor targets. The native service manages the authenticated workspace reader for UNLISTED shares; LISTED publishing uses updateTargets. Typed native response metadata is preserved.

Checkout retains the SDK's personal HOME layout: `plugins/<name>` and `.agents/plugins/marketplace.json` beneath the dedicated private home, with its remote/local association under `.tmp`. An existing mapped checkout keeps local edits; unrelated personal packages and marketplace entries remain unchanged. A share mapped to a workspace source outside that personal area must reuse its existing source for editing/publishing, as required by the native checkout contract. Delete removes the remote share and only its selected association, preserving local source/checkout files. Personal discovery supports these owned packages while excluding credential files and managed runtime data. Successful method-bound receipts retain the runtime reference when configuration/credential authority is unchanged.

### Windows sandbox readiness

`OPERATIONS_CODEX_ALLOW_WINDOWS_SANDBOX_READINESS=1` independently grants `windowsSandbox/readiness` through the paired runtime without agent or account approval. Its result retains the native `ready`, `notConfigured` and `updateRequired` statuses. The qualified Linux companion verifies that its producer reports `notConfigured`, with unchanged runtime authority. On Windows the SDK readiness handler may refresh registered provisioning before returning; the current companion's dedicated-home/security implementation remains Linux-only.

`windowsSandbox/setupStart` is omitted from the active catalog until Windows host/provisioning qualification is complete. Its native schema remains intact and existing direct model execution stays guarded. The native `{started:true}` response acknowledges an attempt; completion is a separate `windowsSandbox/setupCompleted` event with mode, success and error. Both real Linux setup modes acknowledge and then fail as unsupported without persisting a Windows sandbox mode. Omitting/nulling cwd deliberately supplies no project workspace roots; it must not be rewritten to grant the process installation directory. Those failure-path tests do not establish Windows provisioning success or Windows companion support.
