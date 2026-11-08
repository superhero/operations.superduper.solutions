# GitHub migration archive companion

GitHub returns 302 with a private download location for user and organization
migration archives. Browser manual redirects hide that location. This companion
performs exactly those two GET routes, then downloads the archive with no
GitHub authorization headers, cookies or referer on the storage request.
It exposes the downloaded file as a logical 200 workflow response; the original
catalog 302 declarations remain intact. The signed location stays on the host.

Run `node companions/github-archive/server.mjs` with the project's pinned Node.
Configure these environment variables:

- `OPERATIONS_GITHUB_ARCHIVE_PUBLIC_ORIGIN`: dedicated trusted HTTPS origin.
- `OPERATIONS_GITHUB_ARCHIVE_ALLOWED_ORIGINS`: JSON array of application origins.
- `OPERATIONS_GITHUB_ARCHIVE_STORAGE_ORIGINS`: JSON array of exact HTTPS storage
  origins approved by the owner. There is no inferred host or wildcard default.
  An unlisted redirect fails without contacting its destination. Confirm the
  storage origin through your migration administration before allowing it.
- `OPERATIONS_GITHUB_ARCHIVE_PAIRING_KEY_FILE`: owner-only regular file with a
  random base64url key of 43–256 characters; symlinks are rejected.
- `OPERATIONS_GITHUB_ARCHIVE_TLS_KEY_FILE` and
  `OPERATIONS_GITHUB_ARCHIVE_TLS_CERT_FILE`: trusted TLS certificate and key.

Alternatively terminate trusted HTTPS at a local reverse proxy, preserve the
public Host header and set `OPERATIONS_GITHUB_ARCHIVE_TRUSTED_TLS_PROXY=1`.
Only loopback listeners may use proxy mode. The default listener is
127.0.0.1:8449; `_LISTEN_HOST` and `_PORT` under the same prefix override it.

Save the pairing key in Secrets. For either archive operation, save an HTTP
connection with the companion HTTPS origin, pairing key and a classic user
OAuth/PAT credential. GitHub requires the authenticated account/organization
owner, an exported migration and a still-available archive (seven days).
Fine-grained and GitHub App tokens remain excluded for these operations.

The companion receives your GitHub token: pair only a host you control. It keeps
no request state or logs and never returns signed locations or upstream error
bodies. Only one 302 hop is allowed; storage redirects are rejected. Downloads
retain exact compressed bytes and use Operations' existing 500 kB file limit.
Larger archives need an external migration client. Concurrency is 4 with a 20s
deadline. SIGTERM/SIGINT stop the server and cancel active requests. This
transport does not change any other GitHub operation.
