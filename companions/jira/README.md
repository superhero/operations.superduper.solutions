# Jira OAuth companion

This optional Node service implements the Operations `atlassian-jira-3lo-v1`
profile. Run it separately from the static application. It exchanges Jira 3LO
codes, holds rotating provider tokens, and forwards only the selected site's
current-user request. Its source and private configuration are excluded from the
application bundle. No host is deployed automatically.

Use one process and one writer per data directory. The encrypted file store is
not a distributed database; do not mount it into multiple replicas. Use Node 26,
an unprivileged service account, a private writable data directory and explicit
process/container resource limits. Development verification uses the project's
4 CPU / 16 GiB / zero extra swap / 512 PID / no GPU Swarm boundary.

## Configure

Register an Atlassian Jira Cloud OAuth 2.0 (3LO) application with audience
`api.atlassian.com`, `read:jira-user offline_access`, and the exact callback
`https://YOUR-COMPANION/oauth/jira/callback`. Put its client secret on the host.
Generate two independent random 32-byte base64url keys: one companion access key
and one storage encryption key. Keep the latter private to this service. Store
its access key as an ordinary Secret in the Operations vault for explicit pairing.
Choose a stable UUID for this host. Keep that UUID and storage key across restarts.

The CLI reads secret files when the corresponding `_FILE` setting is present;
otherwise it accepts the named environment variable. Secret files should be owned
by the service account and readable only by it. Never add them to this repository
or to a static hosting directory. Example private configuration behind a local
TLS reverse proxy:

    OPERATIONS_JIRA_PUBLIC_ORIGIN=https://jira-companion.example
    OPERATIONS_JIRA_HOST_ID=YOUR-STABLE-UUID
    OPERATIONS_JIRA_CLIENT_ID=YOUR-REGISTERED-CLIENT-ID
    OPERATIONS_JIRA_CLIENT_SECRET_FILE=/private/jira/client-secret
    OPERATIONS_JIRA_ACCESS_KEY_FILE=/private/jira/access-key
    OPERATIONS_JIRA_STORAGE_KEY_FILE=/private/jira/storage-key
    OPERATIONS_JIRA_DATA_DIRECTORY=/private/jira/data
    OPERATIONS_JIRA_ALLOWED_ORIGINS=["https://operations.example"]
    OPERATIONS_JIRA_TRUSTED_TLS_PROXY=1
    OPERATIONS_JIRA_LISTEN_HOST=127.0.0.1
    OPERATIONS_JIRA_PORT=8085

Export these values through your service manager, then run
`node companions/jira/server.mjs` or `npm run companion:jira`.
The proxy must serve the configured HTTPS origin, preserve the browser Origin,
and forward the companion paths to its private listener. Keep Authorization,
request bodies and callback query strings out of proxy request logs. The service
itself logs no requests, codes, tokens or raw errors.

For direct TLS, provide `OPERATIONS_JIRA_TLS_KEY_FILE` and
`OPERATIONS_JIRA_TLS_CERT_FILE`, set the listener/port to the configured origin,
and omit the trusted-proxy flag. Plain HTTP is accepted only for loopback
local development unless that explicit TLS-proxy flag is set. Public browser
connections require HTTPS; a loopback Operations page may use a loopback companion.
There are no cookies or credentialed CORS permissions. Every API request requires
an exact allowed origin and the companion access key; consent tasks and saved
connections additionally require independent opaque private capabilities.

## Storage and lifecycle

`connections.aes-gcm.json` contains an AES-256-GCM encrypted snapshot. New files
use mode0600, and newly created directories use0700. Writes fsync encrypted bytes,
rename atomically, and sync the directory before publishing the new in-memory
snapshot. Keep an encrypted file backup together with a separately protected
storage key and host ID. Losing the storage key requires new consent; there is
no plaintext recovery fallback. Pending sign-ins are memory-only and expire after
five minutes, so a restart during consent requires starting again.

Refresh is serialized per connection. The service durably records refresh intent
before exchanging the one-use refresh token. It stores the new pair atomically
before returning a resource result. An interrupted or unverifiable exchange
requires new consent; it does not replay the old token or the resource request.
Host/registration/access-key/origin configuration changes invalidate previous
references. Start a new connection after an intentional configuration change.

Disconnect deletes the host's local grant when reachable. Operations always
removes its own reference and reports unconfirmed host cleanup if unreachable.
This is separate from revoking the app's authorization in the Atlassian account.
The companion does not implement an undocumented provider revocation endpoint.

## Bounded API

The service exposes config, consent-task create/status/site selection/cancellation,
connection deletion, and current-user execution under `/v1/jira/`. Its callback
terminates at `/oauth/jira/callback`, then redirects to a fixed clean completion
page. No provider token is returned to Operations. Allowed current-user requests
are GET `/rest/api/3/myself`, with optional `groups`/`applicationRoles` expansion,
forwarded to `https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/myself`.
The reviewed site URLs are standard `*.atlassian.net` origins. There is no
arbitrary-URL relay, custom-domain/Jira Data Center enrollment, other Jira method,
role federation or token export.

At most128 saved connections,64 pending tasks (8 per allowed origin), and8 MiB
resource responses are supported. Configuration/task messages have smaller bounds.
See [application setup and evidence](../../docs/jira-oauth.md).
