# Browser secrets vault

This directory owns encrypted credential storage and authorized credential use.
Keep plaintext values out of document models, Git, shared stores, caches and diagnostics.
The decision and threat boundary are described in
[runtime secrets](../../../docs/adr/runtime-secrets.md).

## Files and boundaries

| Files | Responsibility |
| --- | --- |
| `types`, `crypto`, `format` | Bounded format, Argon2/HKDF, AES-GCM and authenticated inventories |
| `storage`, `schema-policy-storage` | Atomic vault snapshots, expected revisions and durable checks of current schema approvals |
| `session` | Worker-private unlocking, credential management, independent methods, restore and key rotation |
| `policy`, `execution` | Immutable operation descriptors, request construction, credential injection and bounded sanitized responses |
| `protocol`, `vault.worker`, `client`, `vault-executor` | Narrow RPC, cancellation, safe errors and application execution bridge |
| `lifecycle`, `passkeys` | Activity deadlines and the window-only WebAuthn PRF ceremony |
| `key-index` | Bounded public key names and IDs for locked browsing; never an authorization source |
| `bindings`, `variables` | Strict opaque workflow and Text-variable references, without credential values or grants |

## Adding capabilities

Add operations to the reviewed RPC allowlist, never a generic decrypt interface.
The explicit copy action returns only the selected value for clipboard use;
keep it out of stores and clear the temporary reference afterward. Credential changes use the unlocked session. Unlock-method
changes require fresh authentication. Preserve independent
passwords and passkeys by authenticating each before key rotation. Generate a new
128-byte recovery key automatically during rotation; never request the old one.
Validate untrusted format and KDF bounds before allocation or expensive work.

Credentialed requests originate in the worker from a validated operation descriptor.
Any compatible saved credential can be selected without destination approval.
Vault-variable nodes inject saved values into Text inputs inside the same worker,
including nested request fields. Saved workflows hold IDs; portable documents
clear selections. Previews contain placeholders or sanitized values.
Changed operations invalidate stale bindings. Anonymous and credentialed
alternatives must be selected explicitly.

## Persistence

`v1/secrets` contains encrypted snapshots, a public key-name index and public monotonic counters; it is
outside LightningFS. Crypto finishes before one atomic transaction promotes the
new state. Competing writers use compare-and-swap checks. Lock notifications are
hints; durable checks reject suspended or stale tabs even after a missed message.
Idle preferences live separately in `v1/settings`.

Key names can be selected while locked. Values, copying and changes still require
an unlocked session. Existing vaults publish their key index after one unlock;
imports rebuild it from authenticated records. Encrypted exports retain their
existing format.

Workflow document versions 1–3 accept optional opaque credential bindings. Local
history retains them; portable exports and imports remove them, and older readers
may discard them. Bindings never contain credentials or authorize a destination.
Bearer/API-key references remain single vault IDs. Basic uses an exact two-ID
`{ username, password }` value under its scheme name, with the same local-only
history/export boundary. Existing key/value vault entries supply both roles;
the private executor validates visible ASCII and username delimiters, constructs
the Basic header, and registers its source and derived forms for redaction.

When reviewed schema metadata adds an API-key requirement to an existing header,
an unambiguous direct vault connection can supply the same local credential ID.
Explicitly clearing the selection blocks fallback. The private executor consumes
a connected auth header only if it equals the selected injected value; conflicting
private values and public header overrides reject. This preserves existing vault
entry kinds for that exact direct connection without relaxing ordinary selections,
canonical current-schema approval or portable-export stripping.

The initial managed OAuth profile is [GitLab public PKCE](../../../docs/gitlab-oauth.md).
Its access/refresh state is encrypted in `oauthState`, omitted from summaries and
ordinary key/value copies. The record's `value` is an opaque placeholder.
Connection metadata binds the client, callback, scope and account; worker-owned
renewal preserves the connection reference and records a durable pending marker
before exchanging a rotating refresh token.


[AWS SigV4](../../../docs/aws-signing.md) references an access key ID, secret
access key and optional session token separately. The worker signs final bytes
with the pinned Smithy signer and clears derived-key caches after each attempt.
Its initial Lambda REST profile binds the configured HTTPS region and service;
signing-protocol fields are not public operation inputs.

Operations marked `credentialResult` require private credential acquisition and
cannot execute through ordinary JSON request/result paths. Both request preparation
and canonical private approval reject them. Newly issued tokens, signed URLs,
API keys and webhook secrets therefore remain outside workflow outputs until a
private handler exists. An anonymous authentication choice also cannot send a
declared credential header or query parameter through ordinary input fields.

Declared binary responses use the shared bounded reader and the existing
500,000-byte Binary envelope. Raw UTF-8/UTF-16 credential echoes and sensitive
filenames withhold the complete file and mark the response redacted; base64 bytes
are never edited by the text redactor. The runner completes the request, blocks
dependent outputs and offers no automatic retry of that completed write.

Replacing an existing vault requires its current authentication as well as the
export's. If local data cannot authenticate, import the export in a fresh browser
profile and verify access before removing any damaged copy.

## Cancellation and diagnostics

Terminate secret workers on lock or cancellation; persistence workers' draining
behavior is inappropriate here. Keep only fixed vault error codes, bounded safe
field errors and sanitized HTTP diagnostics at the RPC boundary. Native worker
failure events must not enter ordinary error recording with sensitive context.
One-time recovery-key presentation is an intentional exception and must clear
on confirmation, cancellation, page-exit locking and unmount.

## Verification

Source `vault-*.feature` scenarios cover cryptography, format, policy, lifecycle,
recovery and application integration. Browser scenarios exercise IndexedDB,
workers, actual requests and UI behavior. These Gherkin cases share the combined
Vitest report.
Use synthetic canaries only. Native WebAuthn PRF checks use Chromium's virtual
authenticator. Physical mobile devices, platform and roaming providers, synced
credentials and cross-provider portability remain unverified. Browser engine
checks do not establish those guarantees; record provider qualification separately.

Coverage includes pure crypto, session, policy, lifecycle and binding logic.
Browser storage, worker/client adapters and type-only RPC declarations sit outside
the source coverage scope; their observable behavior is exercised in browsers.

### AT Protocol public OAuth

The [Bluesky connection](../../../docs/bluesky-oauth.md) keeps per-session proof keys and rotating tokens encrypted in the vault. The official OAuth core runs in the owning worker with private stores; saved references permit only the reviewed account-bound preferences read. Legacy bearer references remain separate.
