# Confidential Jira connection

Operations can connect the reviewed Jira Cloud current-user operation through an
optional [Jira companion](../companions/jira/README.md). Ordinary HTTP token and
Basic connections continue to work without one. The first companion profile is
`atlassian-jira-3lo-v1`, using `read:jira-user offline_access` and audience
`api.atlassian.com`. Other services and application-issued credentials are separate
profiles; this does not turn Codex App Server into an OAuth broker.

Deploy/configure the companion separately with an exact Operations-origin
allowlist, registered client/callback, private client secret and independent
access/storage keys. No actual host, registration or site is supplied or deployed
by this implementation. Store the companion access key in the existing vault as
a Secret. The application sends that selected key only to the configured host.

Configure the operation's schema with your actual HTTPS Jira site origin, for
example `https://team.atlassian.net`, and select GET `/rest/api/3/myself` with its
OAuth2 alternative. The bundled Jira source retains all630 native operation
identities and its existing Basic/OAuth2 alternatives; its placeholder site is
not a valid account binding. This profile qualifies the current-user route on
standard `*.atlassian.net` sites; custom domain aliases and Jira Data Center are
outside its reviewed endpoint contract.

Unlock the vault and open **Connect Jira account**. Enter your companion URL,
select its stored access key and choose a connection name. **Connect Jira** opens
Atlassian consent. After consent, select a discovered Jira site and confirm
**Connect selected Jira site**. Only sites matching the operation's configured
endpoint are selectable. The cloud ID and the account returned by that site's
current-user request become immutable connection authority. No first site or
account is selected silently for execution.

The companion handles the provider callback and private token exchange. The
initiating application polls status using short vault-worker calls, so it does
not rely on a cross-origin opener or hold one RPC open during the consent window.
Denial, cancellation, timeout, lock/reload and changed schema/key authority prevent
late completion. The callback redirects to a fixed code-free completion page;
it never starts the Operations workspace or returns provider credentials.

A workflow saves only the usual public connection reference. The vault stores
the opaque host capability, selected key reference and host/site/account metadata
encrypted; ordinary key reads and summaries do not export the managed state.
After reload, unlock and reuse the saved connection. Jira access/refresh tokens
and the client secret remain on the companion in encrypted host storage. Both
stores survive an ordinary restart; an interrupted sign-in must start again.

Resource requests use the discovered cloud ID on the fixed Atlassian API gateway.
The host verifies the account on each successful response and checks site access
when refreshing. It serializes rotating refresh and commits the replacement
before returning a result. Expiry/revocation, changed accounts/sites, altered host
configuration or changed access keys fail closed. An ambiguous refresh requires
consent again; requests and refresh credentials are not replayed automatically.
Reconnect preserves the selected account, replaces its grant and invalidates the
old capability. Host/site/account changes require a new explicit connection.

The reviewed resource has optional `groups`/`applicationRoles` expansion and an
8 MiB response limit. Arbitrary destinations, other methods and private-variable
substitution are outside this profile. HTTP status/errors remain bounded JSON,
with registered host and vault secrets removed before public workflow results.
A redacted result cannot feed dependent steps. Disconnect removes local authority
and attempts host cleanup; an unreachable host produces an explicit unconfirmed
cleanup notice. Atlassian account-level app revocation remains a separate action.

Source fixtures exercise the native Jira identity, confidential exchange, callback
and origin/capability guards, encrypted restart, concurrent/ambiguous refresh,
site/account/host/key changes, reconnect/disconnect and result secrecy. Phone and
desktop UI checks use the production vault worker with a real loopback companion
and native browser CORS; Atlassian consent and provider responses are synthetic.
They do not qualify a real registration, IAM/account permissions, public TLS or
deployed-origin access. Live qualification remains pending authorized host/client
and Jira site values.

Primary contracts reviewed2026-10-25: [Atlassian 3LO](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/)
and [Jira current user](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-myself/).
The explicit registration/authority decision is recorded in
[provider profiles](provider-authentication-profiles.md). Requalify this profile
when its provider scope, callback/host authority or pinned Jira contract changes.
