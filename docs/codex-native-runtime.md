# Pair a private Codex runtime

Operations can pair with an optional companion that you control. The production
vault worker owns its HTTPS ticket request, WSS connection, native initialization
and read-only account check. Pairing does not enable agent turns or ordinary
workflow execution by itself. All 105 native methods remain discoverable.
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
no browser-supplied command, environment or configuration override is accepted.
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
