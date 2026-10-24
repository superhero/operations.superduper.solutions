# GitLab public OAuth

GitLab.com connections support the bundled GitLab 19.5 `GET /api/v4/user`
operation through its existing `oauth2` alternative. Bearer tokens and
`PRIVATE-TOKEN` remain separate choices. Other GitLab resources and self-hosted
issuers are outside this initial profile.

Register a **non-confidential** GitLab application with `read_user` access. In
the operation's authentication controls, unlock the vault, expand **Connect
GitLab account**, and enter its public application ID. Register the exact
read-only redirect URL shown there, then select **Connect GitLab**. The URL uses
the current application origin and path with
`?operations_oauth_callback=gitlab`; HTTPS is required except on loopback.
Allow the sign-in window. No client secret is required or accepted.

The vault worker creates independent random state and a PKCE verifier, sends
an S256 challenge, and consumes the callback once. Callback code/state are
removed from the URL before application startup. Consent has a five-minute
deadline; the private token/identity exchange has a separate 15-second deadline.
Denied, expired, cancelled, locked and stale-schema requests cannot complete
later. Use **Cancel GitLab sign-in** to stop waiting after closing a sign-in
window. Origin isolation can make a live popup appear closed to its opener;
a same-origin callback channel supports that case without an early cancellation.

Access and refresh tokens occupy a private field inside the encrypted vault
record. Ordinary credential reads/copies expose only its opaque placeholder;
workflows store a saved connection reference. Refresh updates tokens without
changing that reference. Concurrent use shares one refresh. Before attempting a
rotating refresh, an encrypted pending marker is committed: interruption or
failure requires reconnecting rather than replaying the old refresh token.
Resource requests are not retried automatically. Tokens and their URI/form
encodings are scrubbed from results.

The connection binds the fixed issuer, application ID, callback, `read_user`
scope and verified GitLab user ID. Reconnect must return that same account and
advances the reference revision. Remove deletes the managed record. Reload
requires unlocking again; no pending consent survives reload. Moving to another
application origin requires a new registration/connection.

This profile follows GitLab's [OAuth API](https://docs.gitlab.com/api/oauth2/),
[application API](https://docs.gitlab.com/api/applications/) and
[provider registration instructions](https://docs.gitlab.com/integration/oauth_provider/),
reviewed 2026-10-24. Validation uses synthetic token/resource responses and
browser popup flows. No live application registration, account consent or live
CORS qualification is claimed. An authorized application ID and exact registered
callback are needed for that qualification. Browser popup, Web Crypto and vault
storage support remain required on phones and tablets.
