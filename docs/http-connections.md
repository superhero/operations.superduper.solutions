# Saved HTTP connections

The workflow credentials panel can save an existing selection as a named HTTP
connection. Choose the existing authentication alternative and vault keys, open
**Save as connection**, and provide a connection name and account label. Other
compatible operations can select it from **Saved HTTP connection** after unlock.
Basic connections retain separate username and password references. Existing
direct credential selections continue to work without migration.

**Edit connection** updates the name, account label or reviewed token format.
The endpoint comes from the operation's configured schema server. Changing a
schema endpoint requires a connection approved for that destination. Account
labels identify the user's selections locally; they are not provider-verified
account identities or evidence that a token is still valid.

## Private authority and persistence

A profile contains provider/schema ID, account label, exact endpoint base path,
`browser-http` runtime, original authentication-alternative index, complete AND
scheme placement, opaque credential references, token format and optional expiry.
A UUID, monotonic revision and SHA-256 fingerprint bind that configuration.
The worker checks the active schema and exact operation fingerprint in addition
to the profile on each use. It does not infer missing credentials, switch
accounts, choose a different auth alternative or fall back to an older profile.

Profiles are optional metadata inside existing encrypted credential records.
The credential with the lowest referenced UUID owns a profile; Basic and AND
profiles may refer to additional records. No new credential kind or database is
introduced. There are at most 128 profiles in a vault and 32 per owning record,
subject to the existing encrypted-record byte limit. Existing vaults work as-is;
new profiles travel inside encrypted vault backups. Older application versions
that do not understand this added record metadata may refuse such records.

Workflows save only the connection UUID/revision/fingerprint and the operation's
fingerprint/alternative; the direct credential map is empty. Local reload keeps
that reference. Existing portable-workflow export/import processing strips it,
including nested workflows. Connection labels and account metadata are not added
to workflow history or exports. Secrets already pasted into document text are
outside this mechanism.

Editing configuration invalidates older selections. Rotating an underlying
credential value or kind advances affected connection revisions. Removing a
credential removes profiles that need it; removing a profile leaves existing
keys intact. Stale, missing, mismatched or expired references fail before
dispatch. A response completing after a known expiry is withheld. Other accounts
keep independent references, even when operations or credentials are shared.

## Reviewed raw token formatting

| Profile | Qualified scheme and endpoint | Wire value |
| --- | --- | --- |
| Discord bot | `BotToken`, API key in `Authorization`, `https://discord.com/api/v10` | `Bot <raw token>` |
| Opsgenie | `GenieKey`, API key in `Authorization`, `https://api.opsgenie.com` or `https://api.eu.opsgenie.com` | `GenieKey <raw key>` |

These formats are offered for those schema identities and exact endpoints, and
are the suggested format when saving such a connection. Other connections keep
their declared bearer, Basic or literal API-key transport. Explicit schema-format
selection preserves the existing wire behavior. A raw-token format rejects
whitespace or an already prefixed value. Prefixes are constructed privately and
included in response redaction along with the original secret. There are no
user-supplied header templates or prefix guesses.

Reviewed 2026-10-24 against [Discord authentication](https://github.com/discord/discord-api-docs/blob/main/developers/reference.mdx#authentication)
and [Opsgenie authentication](https://docs.opsgenie.com/docs/authentication)
and [account endpoints](https://docs.opsgenie.com/docs/account-api), plus
the bundled Discord v10 and Opsgenie 2.0.0 declarations. Native schema bytes are
unchanged. Requalify the format identifier, endpoint and scheme constraints when
these provider contracts change.

## Authorization lifecycle

`createConnectionAuthorization` supplies `needs-action`, `waiting`, `ready`,
`failed`, `cancelled` and `expired` states. Existing-token selection uses the same
controller to ask the worker for a current binding. Readiness means that local
references and authority were checked, not that a provider accepted the token.
Only explicitly enabled selections invoke an authorization handler. No provider
SDK, network probe or native process initializes on module import or for a
disabled selection. The UI's helpers do not import the vault's password KDF.

Interactive waiting is separate from the HTTP executor and bounded to five
minutes. Cancellation, lock, replacement and account changes abort the handler
and invalidate late completions. Known expiry invalidates readiness. State
notifications carry only the state and opaque reference; provider results and
raw errors are not copied into progress events. Actual OAuth login, acquisition,
refresh, SDKs and native runtimes remain separate tasks.

Focused fixtures live in [`http-connections.feature`](../src/http-connections.feature)
and the selected connection scenarios in
[`vault.feature`](../tests/browser/vault.feature). Provider calls use synthetic
responses; mobile/desktop selection, reload and the production vault worker are
checked separately. This is not live account, token-validity or browser-CORS
qualification.
