# EFS account-preferences companion

EFS DescribeAccountPreferences accepts optional MaxResults and NextToken in a
JSON GET body. Browser fetch cannot send that body. This optional companion
forwards that single read through Node HTTPS, retaining the exact signed bytes.
Bodyless reads continue directly from the browser.

Run with the project's pinned Node version and npm run companion:efs.
Configure OPERATIONS_EFS_PUBLIC_ORIGIN as a dedicated HTTPS origin,
OPERATIONS_EFS_ALLOWED_ORIGINS as a JSON array of Operations application
origins, and OPERATIONS_EFS_PAIRING_KEY_FILE as an owner-only regular file
containing a random base64url key of 43–256 characters.

Provide OPERATIONS_EFS_TLS_KEY_FILE and OPERATIONS_EFS_TLS_CERT_FILE for
trusted HTTPS. Alternatively terminate trusted TLS at a local reverse proxy,
set OPERATIONS_EFS_TRUSTED_TLS_PROXY=1, and preserve the public Host header.
The default listen address is 127.0.0.1:8448; OPERATIONS_EFS_PORT overrides it.
Only a loopback listener may use the trusted-proxy mode.

Save the pairing key in Secrets. In the EFS operation's saved HTTP connection,
choose its companion HTTPS origin and pairing key. This is an explicit
connection setting; it never changes other operations' transport. Rotating
the pairing key requires saving the connection again.

The companion accepts only the pinned EFS regions and account-preferences
path, validates signed headers/body hash/date/scope, rejects redirects, and
bounds concurrency, time and response size. It receives a signed request,
never the AWS secret access key. It stores no request or credential state
and logs no request bodies or headers. Stop it with SIGTERM or SIGINT.
