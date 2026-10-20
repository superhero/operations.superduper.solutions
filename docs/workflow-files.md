# Workflow files

A file node accepts any file up to 500,000 bytes. JSON and CSV retain their parsed
values and typed output panels. Other files expose a Binary value and display
their media type and byte count without decoding or previewing the contents.
CSV delimiter, header and quote options continue to affect only the parsed data.
JSON and CSV uploads must parse successfully.

Connecting the file node itself to a Binary input inserts an editable **Cast →
Binary** node. That connection uses the original bytes, including a JSON/CSV
file's encoding and byte-order mark. Its parsed output panels remain available
for other connections. There is one output handle on the file node; no output
mode needs to be selected.

Binary is also a manual Cast destination. Text is encoded as UTF-8 text; finite
JSON values use UTF-8 JSON. An existing Binary value passes through unchanged.
A connection from a parsed output panel casts that selected data rather than
the whole original file. These casts apply the same file-size limit.

Original bytes, filename and media type persist in history, reloads and workflow
imports/exports as a validated, versioned base64 envelope. Base64 is an encoding,
not encryption. Binary contents are part of the workflow, subject to its existing
2 MB document limit. Previously saved JSON/CSV nodes remain readable but cannot
reconstruct an original encoding they did not save; a manual cast of their parsed
data remains possible.

Both HTTP executors support raw file bodies for non-JSON media types and individual file fields in
`multipart/form-data`. A file input must be declared as `type: string` with
`format: binary`. Raw media alternatives must use the same file schema. Specific
media types accept matching files; `application/octet-stream` accepts any file
and sends its actual media type. The browser's file type is used when available,
with common filename-extension fallbacks and then `application/octet-stream`.
This identifies a transport type; it does not certify a file's contents.

Multipart files retain their filename and media type, and Fetch supplies the
boundary. Custom part encodings, structured form fields, arrays of files,
streaming/resumable upload protocols and binary response downloads remain
unsupported. Ordinary JSON objects are never automatically decoded into bytes.
Credential bindings and browser CORS restrictions still apply.

Service schemas that annotate JSON or query strings as files retain their text
transport, including base64 attachment content. Those annotations do not make a
JSON or query field accept raw bytes. Existing request-media selection is retained
when a service advertises both JSON and multipart alternatives.

The Google Workspace conversions that describe metadata schemas under upload
media types remain unavailable. Merely enabling a file body would use incorrect
routes for some of them. For example, Google Drive sends raw media to
`/upload/drive/v3/files?uploadType=media`, while `/drive/v3/files` is the metadata
route. See [Google Drive upload protocols](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
and [OpenAPI file upload semantics](https://spec.openapis.org/oas/v3.0.3.html#considerations-for-file-uploads).
