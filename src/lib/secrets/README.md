# Browser secrets vault

This directory owns encrypted credential storage and authorized credential use.
Keep plaintext out of document models, Git, shared stores, caches and diagnostics.
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
| `bindings` | Strict opaque workflow references, without credential values or grants |

## Adding capabilities

Add operations to the reviewed RPC allowlist, never a generic decrypt or secret
getter. Credential changes use the unlocked session. Unlock-method
changes require fresh authentication. Preserve independent
passwords and passkeys by authenticating each before key rotation. Generate a new
128-byte recovery key automatically during rotation; never request the old one.
Validate untrusted format and KDF bounds before allocation or expensive work.

Credentialed requests originate in the worker from a validated operation descriptor.
Any compatible saved credential can be selected without destination approval.
Changed operations invalidate stale bindings. Anonymous and credentialed
alternatives must be selected explicitly.

## Persistence

`v1/secrets` contains encrypted snapshots and public monotonic counters; it is
outside LightningFS. Crypto finishes before one atomic transaction promotes the
new state. Competing writers use compare-and-swap checks. Lock notifications are
hints; durable checks reject suspended or stale tabs even after a missed message.
Idle preferences live separately in `v1/settings`.

Workflow document versions 1–3 accept optional opaque credential bindings. Local
history retains them; portable exports and imports remove them, and older readers
may discard them. Bindings never contain credentials or authorize a destination.

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
workers, actual requests and UI behavior. All participate in Cucumber reporting.
Use synthetic canaries only. Native WebAuthn PRF checks use Chromium's virtual
authenticator. Physical mobile devices, platform and roaming providers, synced
credentials and cross-provider portability remain unverified. Browser engine
checks do not establish those guarantees; record provider qualification separately.

Coverage includes pure crypto, session, policy, lifecycle and binding logic.
Browser storage, worker/client adapters and type-only RPC declarations sit outside
the source coverage scope; their observable behavior is exercised in browsers.
