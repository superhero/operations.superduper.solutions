# Provider authentication profiles

Contract review: 2026-10-24. Decision: use **GitLab.com public PKCE** for the first
browser OAuth connection and **Atlassian Jira Cloud 3LO** for the first optional
confidential connection. This record qualifies their protocols and implementation
boundaries. Account sign-in, registration, resource access and host deployment
remain separate qualification evidence.

## Browser and confidential profiles

| Provider | Registration and client boundary | Resource, identity and refresh |
| --- | --- | --- |
| GitLab | Register a non-confidential application and exact redirect URI; public PKCE uses no client secret. The provider documents CORS for `/oauth/token`. | Select GitLab.com and `read_user`; use Bearer authorization for `/api/v4/user`. Refresh replaces both old access and refresh tokens. [Protocol](https://docs.gitlab.com/api/oauth2/), [application registration](https://docs.gitlab.com/api/applications/). |
| Microsoft Entra | A browser redirect must be registered as type `spa`; use authorization code with PKCE. The token endpoint's CORS behavior depends on this registration. Client secrets belong to confidential clients. | A future first profile should pin the tenant, Graph audience and `User.Read offline_access`. Bind tenant/account separately from display names. SPA refresh credentials have a 24-hour lifetime that rotation does not extend. [Contract](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow). |
| Google | GIS offers a browser token model and a code model whose token exchange/refresh runs on a backend. Register the appropriate web client, origins and callback; a desktop registration is a different client type. | Scopes must target the selected API. Browser token-model consent does not provide a reusable refresh-token flow. User identity sign-in does not itself grant a Google API's permissions. Enrollment is deferred. [Models](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model), [code exchange](https://developers.google.com/identity/oauth2/web/guides/use-code-model). |
| X | SPA/native registrations are public; web/automated-app registrations are confidential. Public token requests include the client ID; confidential client authentication uses the registered secret. | OAuth2 targets API v2. A future user-read profile needs its resource scopes and `offline.access` for refresh. Preserve OAuth1 and existing bearer choices. Enrollment is deferred. [Contract](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code). |
| Atlassian Jira | Select confidential 3LO with a registered callback and a secret held by the configured host. The authorization audience is `api.atlassian.com`. | Request `read:jira-user offline_access`; discover accessible resources and let the user select a cloud ID. Rotate refresh tokens atomically and restart consent after expiry/revocation. Resource requests use the API gateway and selected site. [3LO](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/), [current-user resource](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-myself/). |

Provider rows qualify different contracts. Existing OAuth access-token execution
does not implement enrollment, refresh or application-issued credentials.
Access tokens are opaque unless a selected provider contract requires verified
claims; an ID token must never substitute for a resource access token.

## Selected browser implementation contract

Profile identity: `gitlab-public-pkce-v1`. Fixed issuer/authorization authority
`https://gitlab.com`, authorization `/oauth/authorize`, token `/oauth/token`,
first resource `GET https://gitlab.com/api/v4/user`, scope `read_user`. The native
GitLab 19.5 pack already retains HTTP Bearer, OAuth2 and PRIVATE-TOKEN alternatives;
keep their original indexes and use its OAuth2/Bearer route for this profile.
Native canonical source SHA:
`e5ab69dc7cbfde3b2f2a6c27faccf33a57dabaa70967bb0b52697633050e13e3`.

The user supplies the public application ID. Its registration must be
non-confidential (`confidential=false`) and contain the exact displayed callback.
The application must implement that callback before claiming it is supported.
Use its current HTTP(S) origin/path with a reserved callback query, so the hosted
and single-HTML distributions can share the same entry. Production requires
HTTPS; loopback HTTP is a development exception. Self-managed GitLab is a
separate future profile and must not inherit arbitrary issuer URLs.

Implementation decisions for the browser consumer:

- Open the consent window directly from a user action. Keep the initiating page
  and its vault worker alive. Validate the exact callback origin, one-time state,
  selected registration, scope and pending task before consuming a code.
- Generate a fresh S256 verifier/challenge in the private worker. Keep the
  verifier in memory; do not put it in public storage, workflow data or history.
- Handle the reserved callback before ordinary startup/diagnostics and immediately
  remove code/state parameters from its URL. A callback transfers only the bounded
  code/state result to the initiating task. It must not start the workspace or
  choose an account implicitly.
- Lock, reload, denial, cancellation, timeout, changed configuration and late
  callbacks invalidate pending work. Popup failure needs a visible retry state.
  Interactive consent has its own lifetime outside the short HTTP deadline.
- Store connected token state encrypted in the vault and bind it to the client,
  issuer, scope, account ID and allowed resource. Persist a public connection
  reference in workflows. Re-unlock must be required before using it after reload.
- Refresh once under concurrent demand, replace both token values atomically,
  check the account/resource binding and return a safe failure after revocation.
  Never replay a dispatched resource write as a refresh retry.

No real application ID or registered callback was supplied in this review.
The implementation can accept configuration and verify synthetic authorization,
refresh and resource flows; live registration, consent and browser CORS remain
explicit qualification gates.

## Selected confidential implementation contract

Profile identity: `atlassian-jira-3lo-v1`. Use
`https://auth.atlassian.com/authorize` and `/oauth/token`, the documented audience
and scopes above, then discover resources at
`https://api.atlassian.com/oauth/token/accessible-resources`. Bind the selected
cloud ID and the account returned by the first resource:
`GET https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/myself`.

Supply an optional user-controlled companion as a separately configured service.
Its registration holds the client secret and its exact callback; the static
application must not receive that secret. This selects a service boundary, not
an existing deployment. Codex App Server is not an OAuth broker. Ordinary HTTP
connections continue to work without a companion.

The companion must accept an explicit Operations-origin allowlist, validate its
callback/CSRF task, hold provider refresh material privately and expose opaque
connection references. Resource forwarding must allow only the selected profile,
cloud/site, account and reviewed resource routes. Host/configuration changes
invalidate old references; arbitrary-URL forwarding is excluded. The browser must
bind every result to the host and connection selected for that task.

The implementation must provide a concrete companion artifact and synthetic
host/code/refresh/site-routing evidence. Live use additionally needs a configured
HTTPS host, callback/client registration, permitted Operations origin and selected
Jira site/account. None of those values or deployments is claimed by this review.

## Application and service-issued credentials

These issuer integrations are **explicitly deferred**, individually. They are
outside the first two OAuth consumers and need separate bounded implementation
tasks when selected. Their existing bearer transport is not issuer support.

| Issuer | Required separate contract and reason for deferral |
| --- | --- |
| Google service accounts | Signed service-account assertions and token exchange, or an explicitly selected impersonation/federation flow; bind scopes, subject/delegation and key authority. No service account or key/host choice supplied. [Primary contract](https://developers.google.com/identity/protocols/oauth2/service-account). |
| Entra service principals | Tenant-bound client credentials using a secret, certificate assertion or federation; resource `/.default`, application permissions/admin consent and reacquisition. No tenant/app/credential authority selected. [Primary contract](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow). |
| GitHub Apps | Separate app JWT signing from installation-token exchange and user authorization. Installation/repository permissions and key ownership need explicit selection; these are not PAT scopes. [JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app), [installation credentials](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps). |
| Atlassian Forge | Requires a real Forge app/installation and configured remote invocation; validate FIT and the provider's token/context delivery. No installation/runtime is selected. [Remote contract](https://developer.atlassian.com/platform/forge/remote/essentials/), [API tokens](https://developer.atlassian.com/platform/forge/remote/calling-product-apis/). |
| Atlassian ASAP | Service JWT signing, approved issuer/audience and registered discoverable keys; no participating service/audience/key registration selected. [Protocol](https://s2sauth.bitbucket.io/spec/). |

Cloudflare upload JWTs form a separate short-lived, resource-scoped lifecycle,
implemented in [PR511](https://github.com/superhero/operations.superduper.solutions/pull/511).
They are not OAuth refresh credentials. That implementation keeps them in worker
memory and explicitly consumes completion references.

## Evidence, remaining inputs and review triggers

This review changed documentation only. It used the primary links above and the
current local GitLab pack/runtime boundaries. It performed no sign-in, client
registration, live API/resource call or host deployment. The public OAuth and
confidential OAuth tasks remain implementation work and own their focused tests.

For live qualification, obtain the GitLab public client ID and exact registered
Operations callback. For the confidential consumer, obtain the companion host,
origin allowlist, client registration and selected Jira site/account. Collect
those inputs for a later session; do not fabricate them or deploy a host silently.

Recheck the relevant primary contract before implementing another provider or
issuer, changing a client type/redirect/host, refreshing native source pins, or
qualifying a real account. Additional issuer tasks must keep their own registration,
key custody, audience, expiry and account/resource evidence.

## Implementation follow-up: 2026-10-25

The configurable [GitLab public consumer](gitlab-oauth.md) and [Jira confidential consumer](jira-oauth.md) now have implementation artifacts and synthetic verification. The optional [Jira companion](../companions/jira/README.md) owns confidential exchange/storage and only the reviewed site/account/resource route. The live registration/host/site inputs above remain separate; no deployment or real provider qualification is implied.

The [Bluesky public consumer](bluesky-oauth.md) adds the reviewed AT Protocol PAR/PKCE/DPoP profile in the vault worker. It selects only the private preferences read, its granular RPC permission and the discovered account/PDS. Live metadata hosting, account consent, provider CORS and cross-browser qualification remain separate.
