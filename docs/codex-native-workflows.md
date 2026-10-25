# Codex native workflows

The optional [paired Codex companion](codex-native-runtime.md) supports a bounded
text workflow on the pinned **0.163.0** protocol. Operations exposes three native
operations: `thread/start`, `thread/resume` and `turn/start`. Account sign-in and
turn interruption are private controls. Other native methods stay unavailable;
the catalog retains all 105 identities.

## Enable and connect an account

The host operator enables `OPERATIONS_CODEX_ALLOW_AGENT=1` before starting the
companion. Use an isolated service identity/container and an approved workspace.
The companion selects a named read-only permission profile, denies agent tool
reads of its dedicated credential home and disables tool network access. Browser
parameters cannot override the workspace, provider, sandbox, configuration,
environment, approval reviewer or persisted history. The host configuration is
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
and a fresh account read. An API-key acknowledgement has no login ID; an account
read confirms that the runtime is configured for API-key authentication. This
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
