# Bluesky browser OAuth

Operations supports a public AT Protocol OAuth connection for the native
`bluesky-app:app.bsky.actor.getPreferences` GET operation. It reads the selected
account's private preferences through that account's PDS and the Bluesky AppView
proxy. The other native App, DM and moderation identities and legacy bearer
alternatives retain their existing behavior.

The [AT Protocol OAuth profile](https://atproto.com/specs/oauth) requires identity
and authorization-server discovery, PAR, PKCE and DPoP. This implementation uses
the official `@atproto/oauth-client` **0.8.10** and `@atproto/jwk-webcrypto`
**0.3.4**, with exact direct versions and the transitive graph/integrities in
`package-lock.json`. It supplies private stores and a bounded Fetch adapter
inside the existing vault worker instead of the browser SDK's default database.

## Configuration

Configure the schema's server as the account's actual HTTPS PDS. In the
operation's existing connection selector, open **Connect Bluesky account**, enter
the handle or DID, check the client metadata and callback URLs, and sign in.
Discovery must agree with the configured PDS; it does not silently redirect an
approved operation to another host.

The build publishes `/oauth/bluesky-client-metadata.json` for the canonical
`https://operations.superduper.solutions/` deployment. A self-hosted deployment
must publish its own matching JSON document and callback address. Client ID and
callback must share the current application origin. The metadata declares a
public web client with no client secret and DPoP-bound tokens. Local development
at `http://127.0.0.1:<port>/` or `http://[::1]:<port>/` uses the specification's
virtual `http://localhost` client metadata; it needs no hosted metadata file.

The requested scope is exactly:

```
atproto rpc:app.bsky.actor.getPreferences?aud=did:web:api.bsky.app%23bsky_appview
```

This [granular RPC permission](https://atproto.com/specs/permission#rpc) selects
the preferences read and the Bluesky AppView audience. This profile neither
requests transitional full-account access nor enables write operations.

## Private authority and recovery

The worker holds pending PKCE verifiers and per-consent ES256 keys in memory.
Consent expires after five minutes and is cancelled by locking the vault.
Callback parameters are removed before application loading or diagnostics, then
returned through a same-origin popup/channel handoff. State is one-use; callback
issuer and final account must match discovery.

Access/refresh tokens and the private proof JWK are encrypted in the existing
vault. Public summaries, workflow documents, connection references, request
previews and credential copies contain metadata or opaque references. Proofs
use cryptographic UUID identifiers (strengthening the pinned core’s default)
and are newly signed for each request and bound to method, destination, token and
server nonce by the official OAuth core. Account, PDS, issuer, client, callback
and scope are part of the saved connection's authority.

Every execution resolves identity/server metadata again before sending private
material. Account migration or changed authority requires reconnecting with the
correct configured PDS. Authorization endpoints must share the issuer's origin;
PDS/issuer roots and discovery targets must be public HTTPS names. Multi-origin
authorization endpoints and private-network deployments are unqualified.

Refresh intent is encrypted before dispatch. New tokens are committed before a
result is returned. Interrupted, conflicting or otherwise ambiguous rotation
requires new consent; the old refresh token is not replayed. An explicit nonce
challenge may receive a fresh proof without treating an unknown network outcome
as a safe retry. Removing the connection deletes its local private state and
disables saved references; provider consent can be revoked at the provider.

Discovery responses are bounded to 128 KiB and resource JSON to 8 MiB, with 15 second
request deadlines. Requests omit cookies/referrers and reject redirects.
Results use the normal workflow response envelope and vault-secret redaction.

## Qualification boundary

Focused synthetic checks verify the official client's real ES256 signatures,
PKCE, PAR, account/destination binding, separate nonces, rotation and encrypted
restart. Browser checks exercise the production worker, connection UI and saved
references with a synthetic provider. These checks do not establish real PDS
CORS/header exposure, live account consent, server acceptance of the granular
permission, metadata reachability, or Safari/Firefox compatibility. Those need
separate live qualification with an authorized account and deployed HTTPS
metadata/callback. No provider registration, consent or deployment is performed
by adding this implementation.

Implementation owners: `src/lib/secrets/atproto-{config,state,oauth}.ts`, the vault
session/RPC, `BlueskyOAuthConnect.svelte` and the reserved startup callback.
The upstream [OAuth core](https://github.com/bluesky-social/atproto/tree/main/packages/oauth/oauth-client)
and [WebCrypto keys](https://github.com/bluesky-social/atproto/tree/main/packages/oauth/jwk-webcrypto)
offer MIT/Apache-2.0 licensing; their pinned notices are retained in
`src/lib/secrets/NOTICES.md`. Source and package integrity remain attributable to those
packages. Requalify this profile when SDK pins, provider permissions, discovery,
callback hosting or supported resource methods change.
