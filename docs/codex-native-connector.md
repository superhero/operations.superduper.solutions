# Codex native connector contract

Status: transport and ownership qualified on 2026-10-25. Application model
loading, pairing and agent execution remain separate deliveries; the existing
execution limitation stays in place until those implementations pass.

## Selected transport

Use profile **`codex-stdio-paired-v1`**: an optional user-controlled companion
accepts an authenticated browser WSS connection and runs the pinned Codex App
Server through its documented stdio JSONL transport. A desktop can run the
companion locally; a phone or tablet connects to a reachable user-controlled
host. No mandatory hosted service or shared application account is selected.

Keep the native schema and runtime at **0.163.0** initially. Preserve all 105
`codex:<native-method>` identities. The operator configures a complete Codex
installation, an isolated runtime home, an allowed Operations origin and a
workspace root. Browser requests cannot select executables, environment,
configuration files or arbitrary host directories.

Direct native WebSocket is unsuitable for this browser profile. The pinned
[listener rejects every Origin header](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server-transport/src/transport/websocket.rs#L89),
and its [bearer authenticator reads Authorization](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/websocket-auth/src/lib.rs#L383).
The standard [browser WebSocket constructor](https://websockets.spec.whatwg.org/#the-websocket-interface)
accepts a URL and subprotocols, without an arbitrary request-header option.
Changing native auth from capability tokens to signed bearer tokens does not
remove the listener's Origin rejection. A proxy that merely strips Origin and
inserts a credential would remove that protection without supplying the missing
browser authorization boundary.

The [recorded isolated probe](evidence/codex-native-host-0.163.0.json) observed 101
for an authenticated non-browser handshake, 401 without its token, and 403 with
Origin even when the token was valid. A real Chromium WSS handshake through
transparent TLS termination also received 403. The paired stdio alternative
successfully initialized and read `account: null` with no login. This proves
transport feasibility, not a working application connector or agent turn.

## Pairing and transport authority

The companion exposes only its reviewed profile, with the following contract:

1. The operator starts one companion for one human owner and a dedicated
   `CODEX_HOME`. It must not reuse the desktop CLI's default home, auth state,
   keyring namespace, project configuration or existing daemon. Initially use
   Codex's file credential store inside the private home so another client's
   keyring entry cannot be overwritten. Protect the home as owner-only storage;
   separate human owners require separate OS/container authority and volumes.
2. The operator grants a strong pairing key for an exact allowed web origin.
   The browser stores that key encrypted in the existing vault. HTTPS reads and
   ticket creation require both the key and matching Origin. No unauthenticated
   endpoint may spawn Codex or reveal account/workspace data.
3. An authenticated `POST /v1/codex/tickets` returns a short-lived, one-use
   ticket bound to origin, runtime identity/generation, workspace and connection
   scope. The private worker opens `/v1/codex/socket` over WSS and sends the
   ticket in its first pairing frame. Do not place credentials in URLs,
   subprotocols, cookies, access logs or native command arguments.
4. Validate Origin at upgrade, then the ticket before attaching a child or
   accepting native messages. Consume tickets atomically; bound pending tickets,
   unauthenticated sockets, frame size, queued messages and pairing time. Use a
   five second first-frame deadline and at most 30 seconds for a ticket. No
   redirect or generic network/command proxy is part of this profile.
5. Return a private paired acknowledgement containing the runtime ID, schema
   version, generation, workspace reference and account epoch. Pin them in the
   encrypted connection. Changing host identity, binary/configuration, approved
   workspace or account invalidates authorization until explicitly confirmed.

Initially one active browser transport owns a companion instance. Parallel
workflow requests can share that transport with separately correlated IDs;
another client must receive a busy result rather than silently taking control.
Separate companion instances can serve independent sessions. Host-side workspace
policy constrains native `cwd`, sandbox, approval and configuration overrides;
receiving a valid native parameter shape does not grant host authority.

## Native protocol and lifecycle

After pairing, preserve native frames: requests carry `id`, `method`, `params`;
responses carry the matching `id` and `result` or `error`; notifications omit the
ID. Do not fabricate HTTP URLs/statuses or add HTTP credential requirements.
Send `initialize`, await its result, then send `initialized`. Provider login is
in-band and can follow initialization. Runtime version mismatch leaves native
execution unavailable; it does not silently upgrade the bundled schema.

Keep provider authentication separate from transport pairing. API keys, browser
authorization URLs and device codes pass through dedicated private account
controls, never ordinary workflow output/history. Correlate login completion by
`loginId`; an acknowledgement alone does not authenticate the account. Read and
confirm the resulting account before allowing an agent turn. The pinned
[native contract](https://raw.githubusercontent.com/openai/codex/rust-v0.163.0/codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.schemas.json)
does not provide a universal account ID: API-key account metadata has only its
type. Bind to a host-owned account epoch as well as available account metadata;
invalidate on managed login/logout, account updates or changed credential-store
authority. Email or plan type is insufficient as the authorization identity.

Route server requests by direction and their owning thread/turn. Require an
explicit correlated response for approvals and user input; unknown/unavailable
interactions must fail or cancel safely. Bound the event log and pending maps.
Only reviewed methods receive dispatch capability; loading all 105 models does
not enable arbitrary commands, filesystem calls or configuration mutation.

Cancel a managed login with `account/login/cancel` and its login ID. Interrupt
an owned turn with `turn/interrupt` and its thread/turn IDs; wait for its terminal
notification where possible. A lost connection produces an unknown outcome,
without automatic turn/write replay. `turn/start` is an acknowledgement; the
workflow result comes from the matching terminal `turn/completed` state and
bounded final output. Authentication/approval waiting has its own deadline,
separate from short RPC request timeouts.

Vault lock/disconnect closes or revokes this transport and best-effort cancels
only its owned work. Stop only the companion's own child when detaching. Leave
the isolated credential/thread store intact. Never send `account/logout`, erase
auth/config or stop another client's daemon as a disconnect side effect. Logout
is a separate explicit action confined to this runtime; unreachable cleanup must
be reported as unconfirmed while local references become unusable.

## Login candidates

Use only reviewed variants from the pinned schema and the documented
[Codex authentication model](https://developers.openai.com/codex/auth/):

| Native variant | Qualified direction for implementation |
| --- | --- |
| `apiKey` | Public candidate; user-supplied key goes privately to this runtime. OpenAI API billing remains separate from a ChatGPT plan. |
| `chatgpt` | Public managed-login candidate. Enable only when the runtime's callback can be completed; remote/mobile browser-to-localhost callback routing needs qualification. |
| `chatgptDeviceCode` | Public managed-login candidate for reachable headless/remote hosts. Display its `verificationUrl` and one-use `userCode` privately; availability still depends on account/organization policy. |
| `chatgptAuthTokens` | Pinned schema explicitly marks it unstable and internal-only. Preserve its schema identity, but exclude it from public login controls and dispatch. |
| `amazonBedrock`, `amazonBedrockAccessKeys` | Experimental/unqualified for this delivery. They neither establish a public OpenAI login nor make Codex a general AWS connector. |

Codex owns managed provider tokens and refresh inside its dedicated home.
Pairing with an existing desktop installation does not inherit that desktop's
account. An agent-session connector also does not grant Operations' separate LLM
interface subscription-backed inference; that eligibility and API integration
remain independent.

## Network and qualification limits

Require trusted HTTPS/WSS for the application profile. The isolated probe used
its own test certificate with a test-only certificate exception; production must
validate TLS. A phone cannot reach another computer's `localhost` or run the
native CLI in its browser. It needs a reachable host, device-trusted certificate
and operator-approved origin, possibly over the user's private network/VPN.
Public-site to local-network permissions, deployed CSP/connect policy, mobile
reachability and Safari/Firefox behavior remain explicit qualification gates.
The direct WebSocket interface remains experimental upstream; no production
support or real account/model entitlement is inferred from this probe.

The experiment sent only initialization and an account read with
`refreshToken: false`. It exercised real TLS/browser preflight, ticket rejection
and stdio framing, then stopped owned children without logout. Login, approvals,
turn execution/cancellation and provider access still need their implementation
and focused evidence. No shared Codex account/config or deployment was changed.

## Dependent deliveries

- **26, model loading:** add an explicit native protocol/version/method/params/
  result model through canonical hydration, caching and workflow persistence.
  Keep source/version fingerprints and all 105 IDs; preserve HTTP behavior and
  execution guards. Native output ports must not invent HTTP response fields.
- **27, pairing:** implement the optional companion, private worker connection,
  ticket/Origin/TLS checks, runtime/workspace/account authority and scoped
  disconnect. Test with the production worker and actual response-header policy.
- **28, workflow:** qualify the permitted account controls, thread start/resume,
  turn execution, notifications, approvals, cancellation and terminal JSON result.
  Complete a supported workflow before calling Codex operational.
- **29, Docker:** qualify a separate Docker authority/transport module. Codex
  pairing grants no daemon/socket authority; preserve configured ordinary Docker
  HTTP deployments.
- **30, diagnostics:** report transport, pairing, schema, account, method and
  result requirements independently.

Revisit this contract when the native pin/auth modes, listener Origin policy,
browser networking rules, host isolation or supported RPC subset changes. Live
host/certificate/origin/workspace and account choices are inputs for later
qualification, not permission to reuse the current developer account.
