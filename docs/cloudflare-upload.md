# Private Cloudflare asset uploads

Cloudflare upload operations use worker-owned temporary sessions. Only opaque
references cross workflow connections; JWTs remain in memory in the unlocked
vault worker. They are never saved as vault entries or ordinary workflow values.
References become invalid on reload, vault lock/mutation, cancellation, failure or
expiry. A new run must acquire a new session; writes do not replay automatically.

For Workers, start with **Create Assets Upload Session** using an existing account
API token or the native email/key alternative. Provide the account, Worker name
(and dispatch namespace for Workers for Platforms) and manifest. The public result
contains `result.session`, `result.expiresAt`, `result.phase` and `result.buckets`.
The native wire JWT is removed before creating workflow outputs or history.

Connect `result.session` to **Private upload session** on **Upload Worker Assets**.
This Authorization input contains the opaque reference, not the bearer token.
The private executor resolves it and rejects a conflicting credential selection.
Set `base64` to true and provide `files` as an object mapping each bucket's hashes
to ordinary Binary file values. Send exactly one returned bucket per request.
The adapter sends a multipart file part for each hash: its content is the file's
base64 text and its MIME type is the original file type. Ordinary multipart files
continue to send their original bytes.

A 202 response retains the upload reference and remaining buckets. The final 201
response replaces it with a completion reference. When the initial bucket list is
empty, its initial reference is already a completion reference and uploading is
unnecessary. Use the completion reference as `metadata.assets.jwt` in **Upload
Worker Version**, **Upload Worker Module**, or the corresponding platform Worker
operation. Supply the original account credential and `files` keyed by module
part name, including `metadata.main_module`. The adapter privately replaces the
reference with the completion JWT and sends metadata as an application/json part.
The public result reports completion and a returned version/Worker ID when present.
This explicit final operation can create a version or update a Worker; uploading
assets alone does not do so.

Pages uses **Get Upload Token**, followed by **Check Missing**, **Upload Asset**
and **Upsert Hashes**. Wire the returned session reference to each temporary
operation. Check-missing returns `result.missing`; upload only those hashes using
the native base64 JSON format, then register the checked hashes. The JWT stays
bound to its originating schema/project. Workers sessions additionally validate
the account and exact Worker/namespace on completion, the original account
credential selection, phase, file sizes, bucket membership and one-time use.

The reviewed profile retains Cloudflare's original 4.0.0 native document and all
3,761 operation identities. Its versioned correction defines the four previously
undeclared temporary-token consumers and projects their private results. Generic
credential-returning operations and unrelated Cloudflare contracts retain their
existing restrictions. Current source/schema authority is checked before dispatch
and before returning a result; redirects, cookies and referrers are disabled.

This bounded implementation allows 32 active private sessions, 1,000 manifest
entries and up to 100 files per bucket, with the existing 500,000-byte limit per
Binary file and 8 MiB of decoded asset bytes per bucket. Tokens require a valid
future JWT expiry and are capped at the documented one-hour lifetime. These are
application bounds, not claims about provider/account capacity. Account access,
permissions and browser CORS need separate live qualification; automated tests
use synthetic tokens and intercepted HTTP and create no Cloudflare resources.

Provider contracts checked 2026-10-24:
[Workers direct uploads](https://developers.cloudflare.com/workers/static-assets/direct-upload/),
[platform Worker assets](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/static-assets/),
[Worker metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/),
[Pages upload tokens](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/get_upload_token/).
