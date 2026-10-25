# Docker native host

Operations can list containers through an optional, separately paired Docker
companion. The initial native mode is an operator-configured Linux Unix socket.
It supports only the bundled `docker:ContainerList` operation, using
`GET /v1.57/containers/json`. Configured ordinary HTTP Docker servers remain a
separate destination choice.

## Operator configuration

Run the companion as an account explicitly authorized to access the selected
socket. Docker socket access is privileged; the companion's finite read surface
does not reduce the privileges of its host account. No default socket, shell,
Docker CLI, SSH, arbitrary HTTP path or registry credential is accepted from the
browser. A Codex pairing grants no Docker authority.

Use this project's pinned Node runtime and `npm run companion:docker`. Configure:

| Environment variable | Required value |
|---|---|
| `OPERATIONS_DOCKER_HOST_ID` | Operator-owned UUID identifying this host |
| `OPERATIONS_DOCKER_SOCKET` | Explicit absolute canonical Unix socket path, without symlinks or world-write permission |
| `OPERATIONS_DOCKER_PUBLIC_ORIGIN` | Companion's HTTPS origin, without a path |
| `OPERATIONS_DOCKER_ALLOWED_ORIGINS` | JSON array of exact Operations origins; HTTPS except explicit loopback development |
| `OPERATIONS_DOCKER_PAIRING_KEY_FILE` | Owner-only regular file containing a separate base64url key of 43–256 characters |
| `OPERATIONS_DOCKER_TLS_KEY_FILE`, `OPERATIONS_DOCKER_TLS_CERT_FILE` | Trusted HTTPS certificate and private key files |

Listening defaults to `127.0.0.1:8447`. Set `OPERATIONS_DOCKER_LISTEN_HOST` and
`OPERATIONS_DOCKER_PORT` explicitly when needed. As an alternative to direct TLS,
`OPERATIONS_DOCKER_TRUSTED_TLS_PROXY=1` permits a loopback-only HTTP listener
behind an operator-managed HTTPS proxy. The public origin and browser trust
requirements still apply. This change does not install or deploy a companion.

The daemon must advertise an API range containing **1.57**. The bundled schema
is pinned to that version; the adapter does not silently downgrade. Docker's
[version history](https://docs.docker.com/reference/api/engine/version-history/)
listed 1.56 during the 2026-10-25 review, and its 1.57 reference page was
unavailable. Consequently, this delivery proves the pinned synthetic contract,
not compatibility with an existing production daemon. Selecting an authorized
compatible daemon or changing the schema pin requires separate qualification.
See Docker's [daemon access guidance](https://docs.docker.com/engine/security/protect-access/)
for the host's socket and TLS authority.

## Settings and workflows

1. Enable the Docker schema. In Settings → Secrets, save the companion key as a
   secret credential.
2. In **Docker hosts**, enter a name and HTTPS companion URL, select that key
   reference, and choose **Pair Docker host**.
3. Verify the displayed engine identity and API. Saved profiles are encrypted;
   reconnect and check actions retain the original identity pins.
4. Add Docker's container-list operation to the workspace. In its run dialog,
   unlock Docker hosts if necessary and choose the named **Docker destination**.
   A configured absolute HTTP server can instead be selected explicitly.

Changed daemon/socket/companion identities require removing the old pairing and
pairing again. A stale saved native destination cannot silently select HTTP.
Editing or deleting its secret key revokes its profiles. Locking the vault
aborts owned reads and clears live sessions. Portable workflow exports remove
private Docker bindings.

## Boundaries and evidence

The worker independently resolves the current enabled schema, approved scoped
model, profile revision and key hash before and after requests. The companion
checks the exact allowed origin and bearer key before touching the daemon, and
binds pairing to host generation, configuration, socket, daemon, API and source
fingerprint. It checks daemon identity around each container read.

Only `all`, `limit`, `size` and bounded JSON `filters` are accepted. Responses
retain actual Docker HTTP status, permitted headers and JSON body. Writes,
upgraded/hijacked streams and non-JSON responses remain unavailable. There is
no automatic replay. Registered secret values cannot be sent as parameters or
returned in a workflow result.

Limits are 64 KiB request frames, 2 MiB daemon JSON responses, four in-flight
requests, 15-second browser requests, five-second socket requests and 15-minute
pairing sessions. Response metadata and framing have a separate 64 KiB browser
allowance. The host retains at most 64 pairings; the worker retains four live
sessions and at most 32 encrypted profiles.

`src/docker-native.feature` covers the source, companion, private vault,
identity/version, cancellation, secret handling and HTTP/native graph boundary.
`tests/browser/docker-native.feature` exercises the built application with its
real private worker and HTTPS/CORS at desktop and phone widths. Fixtures create
their own synthetic Unix socket and never mount a production Docker socket.
The related Codex pairing case protects shared worker settings behavior.

Checks run on sds-01 through an owned Docker Swarm job with four CPUs, 16 GiB,
zero additional swap, 512 PIDs and no GPU; stages have a 300-second deadline.
Real daemon, remote network, mobile certificate trust and deployment access
remain operator qualification work. No live daemon or production resources are
changed by these connector tests.
