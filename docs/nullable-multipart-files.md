# Nullable multipart files

A nullable file declaration now retains its bounded binary input in a multipart
request. The source still declares nullability and requiredness; a valid file
does not become a string or JSON attachment because null is also mentioned in
the schema.

The representative bundled operation is `gitlab:postApiV4ProjectsIdUploads`.
GitLab's [Markdown uploads documentation](https://docs.gitlab.com/api/project_markdown_uploads/)
requires a file and uses multipart upload. It does not establish a literal null
encoding. The current implementation qualifies native preparation and synthetic
HTTP transport, rather than live GitLab credentials or deployment behavior.

## Values and constraints

- An absent optional file sends no file part. An entirely absent optional body
  remains absent.
- A required file is required whenever its containing body is supplied. A
  required body cannot silently omit that field.
- A valid file retains its filename, media type and exact bytes. A zero-byte
  file remains a file when its declared minimum permits it.
- Explicit null fails before dispatch, including when the source is nullable.
  It is not converted to an omitted part, an empty file or the text `null`.
- File `minLength`/`maxLength` retain the existing byte-bound interpretation.
  The global per-file ceiling remains 500,000 bytes; malformed bounds fail
  rather than disappearing during inspection.

Nullable primitive form siblings also accept valid non-null text, numeric and
Boolean values. Their declared enums and bounds still apply. The literal string
`null` remains ordinary text when allowed by the schema; an actual null is
rejected. This distinction matters for native upload schemas whose optional
text fields are nullable as well as their required file.

File enums, consts and patterns have no reviewed file-content encoding and stay
unavailable. Nullable raw-file bodies, nullable form roots, nullable arrays or
array items, file arrays, custom multipart encodings and unsupported union
constraints remain guarded. A nullable union cannot discard an outer constraint
or lose its binary marker by becoming a text field. This change does not qualify
every historical GitLab file/form failure.

## Private preparation and verification

The canonical model and private approval fingerprint retain nullability and
file constraints. Changed constraints cannot reuse stale private bindings.
Both HTTP executors use the same validated file envelope and multipart builder;
Fetch supplies the multipart boundary and Content-Type. Null form parts are
also rejected by the builder when called directly.

`src/nullable-form.feature` covers native GitLab preparation, both supported
nullable type declarations, exact private multipart bytes, omission/requiredness,
null rejection, byte limits and unsupported constraints. The browser cases use
the production vault worker and real loopback HTTP at desktop and phone widths:
null sends no request, then a selected file arrives with its original identity
and bytes. No live provider request or schema-source replacement is required.

Checks use one owned sds-01 Swarm job at a time, with four CPUs, 16 GiB RAM,
zero additional swap, 512 PIDs and no GPU. Full regression suites remain in CI.
