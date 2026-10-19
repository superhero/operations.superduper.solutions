# Runtime secrets

> [!IMPORTANT]
> Secrets are excluded from version control and supplied through runtime configuration.

## Version control

Secrets and credentials must not be committed.

## Runtime configuration

Secrets are supplied through environment variables or an appropriate
secrets-management mechanism.

## Browser vault

API credentials belong in an encrypted, origin-local IndexedDB vault, outside
workflow and schema Git repositories. Workflows retain opaque local selections;
imports and exports remove those selections, including nested workflows.
Existing secrets pasted into document text are not removed from earlier history.

### Encryption and unlocking

A random AES-256-GCM key encrypts credential values and destination grants.
Key names, opaque IDs and credential kinds are also stored in a public index, so
keys can be browsed and selected while locked. The index is advisory; requests
resolve IDs against authenticated encrypted records. Existing vaults populate
the index on their next successful unlock; imports rebuild it during authentication.
Each encryption uses a fresh 96-bit IV and authenticates its format, vault,
record, revision and key epoch. An encrypted inventory authenticates the exact
records and unlock envelopes. Selective rollback fails authentication; a complete
valid older export cannot be distinguished from an intentional import locally.

Independent password, recovery and optional PRF-capable passkey envelopes wrap
the same key. Passwords use pinned Argon2id v19: 64 MiB, three iterations,
parallelism one, a random 16-byte salt and 32-byte output. Password bytes are UTF-8
without trimming or normalization. Recovery and passkey PRF material use
domain-separated HKDF-SHA-256. Runtime keys are non-extractable; fresh
authentication supplies temporary extractable handles for method changes.

Web Crypto supplies encryption; `hash-wasm` supplies Argon2id. Ordinary passkey
support is insufficient: enrollment must obtain a real PRF result. Password and
recovery remain independent choices when a provider cannot supply it.

### Credential use

Saving, replacing and removing credentials use the unlocked vault session without another password prompt. Locked or stale
sessions cannot modify vault data. Unlock-method changes and vault replacement
retain their own authentication.

A dedicated worker decrypts credentials, validates the current operation, destination and
authentication placement, then sends
the request. Only an explicit Copy action returns a selected value to the page for the clipboard;
normal workflow execution keeps plaintext values in the worker. Vault-variable nodes retain
only a local entry ID and supply Text inputs, including nested request fields.
Portable workflows clear these selections. Values are resolved and validated in
the worker immediately before dispatch; the runner and request previews contain
placeholders. Vault variables cannot feed Switch or Cast nodes. The initial authentication scope supports
Bearer tokens and header or query API keys; unsupported requirements fail closed.
Credential destinations require HTTPS. HTTP is permitted only for literal
`localhost`, `127.0.0.1` or `[::1]` destinations when the application's own
origin is also loopback, to support local development. A hosted application or
an unavailable application origin cannot enable this exception.

Requests reject redirects, omit browser cookies and referrers, and disable
caching. Public inputs cannot overwrite credential headers or query parameters,
including those declared by an unselected authentication alternative. Query keys
are injected only into the worker's outgoing URL and omitted from request previews.
Known raw, percent-encoded and form-encoded credential echoes are scrubbed from
responses. Credentials selected
for an operation require no separate destination approval. Schema changes
invalidate stale operation bindings. Known credential echoes and authentication
headers are removed before results leave the worker. A redacted result stops
dependent workflow execution without repeating the successful upstream request.
Decoded responses are limited to 8 MiB and diagnostic responses to 16 KiB.
Arbitrary encoded echoes and newly issued remote secrets cannot be identified
reliably by this mechanism.

### Locking and recovery

Reload, page exit and explicit locking end access. Switching tabs or minimizing
the browser preserves access. An optional idle timeout defaults to ten minutes
when enabled; it starts disabled. Only trusted foreground activity resets it.
Expired deadlines and stale revisions cannot be revived by delayed results.
Returning to a visible tab checks the existing deadline without extending it.
Visibility changes alone neither lock the vault nor cancel pending operations.

Locking terminates the worker without draining secret operations. Manual locks
and changes use durable origin-wide counters as well as tab notifications.
An already dispatched API request may have taken effect; cancellation does not
undo it and never causes automatic resubmission.

Encrypted export protects against storage loss. Export copies encrypted storage
without requiring a password or unlocking the vault; importing still requires
a valid unlock method. A separately saved recovery key
protects against a forgotten password. Losing every valid unlock method makes
the vault unrecoverable, including its encrypted exports. Neither browser storage
nor a synced passkey synchronizes the vault to another origin or device. Passkeys
remain tied to their relying-party domain, while browser storage is isolated by
origin. Password or recovery access is needed when the original passkey's
relying-party domain is unavailable. Import authenticates
the complete snapshot before atomic replacement and removes imported grants.

Password replacement rewraps the existing key. Full key rotation re-encrypts
records after verifying each retained password and passkey. Recovery keys are
replaced automatically with one new 128-byte key (172 Base64 characters),
downloaded automatically and shown for copying. Rotation never asks for the
previous recovery key. A vault supports at most one recovery key; additional
keys and multi-recovery-key imports are rejected.

Rotation does not revoke stolen exports or API tokens already exposed; those
credentials must also be rotated at their providers. Deleting old records is
logical deletion, not guaranteed physical erasure.

### Trust boundary

This protects stored credentials while locked. It does not protect against
malicious same-origin code, extensions, a compromised device or an attacker
controlling the running application. Workers reduce accidental exposure and
main-thread work; they are not a separate security principal. JavaScript cannot
guarantee erasure of strings or garbage-collected memory.

References: [Web Crypto](https://www.w3.org/TR/WebCryptoAPI/),
[Argon2](https://www.rfc-editor.org/rfc/rfc9106.html),
[WebAuthn PRF](https://www.w3.org/TR/webauthn-3/#prf-extension),
and [hash-wasm](https://github.com/Daninet/hash-wasm).
