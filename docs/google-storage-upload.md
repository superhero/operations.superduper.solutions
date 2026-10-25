# Google Cloud Storage media upload

`storage.objects.insert` supports a single media-only upload through the existing
private bearer executor. Select a Binary file, bucket and object name. The upload
mode is fixed to `media`; the file's MIME type becomes `Content-Type`, and its
decoded bytes form the complete request body. The application limits files to
500,000 bytes, including an empty file. Fetch manages the wire content length.

The destination is
`https://storage.googleapis.com/upload/storage/v1/b/{bucket}/o?uploadType=media&name=...`.
Object names are query values, including slashes and Unicode; they are encoded
once. Existing precondition inputs remain available: `ifGenerationMatch=0` avoids
replacing an existing live object. Otherwise, an upload can replace the same name.
The successful result is the bounded JSON Object resource. Failed requests are
reported without automatic retry or fallback to another credential.

Google requires the appropriate object-create permission and object-delete
permission when replacing an existing object. Existing OAuth grant alternatives
and scopes are preserved. Credential selection does not prove IAM access, token
validity or browser CORS support.

The reviewed, source-pinned `google-storage-media` correction retains all 76
native method/path/operation identities, the original request/parameters and
all peer contracts. Only this operation selects the upload server; list and
other methods retain the metadata server. The original conversion incorrectly
combined an Object metadata schema with a binary body at the metadata endpoint.

Custom object metadata, multipart/related, resumable sessions, customer-supplied
encryption headers and Artifact Registry uploads require separate contracts.
The qualification uses synthetic private dispatch; no live object is created.
Focused cases cover exact URL/body/MIME, invalid and oversized files, missing
inputs, unsupported modes, credential privacy, stale authority, drift rejection
and recovery after a denied request.

First-party references checked 2026-10-25:

- [Objects: insert](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert)
- [Media upload example](https://docs.cloud.google.com/storage/docs/uploading-objects)
