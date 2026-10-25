# Signed S3 object files

The reviewed S3 profile supports `PutObject` and `GetObject` for files up to
500,000 bytes. It preserves the original binary data, including JSON/text files,
and uses the existing File nodes, ordinary Binary casts and saved AWS connections.
The bundled S3 schema retains all 97 operation identities. A source-pinned
correction replaces these two operations' XML wrappers with raw object bytes;
their original parameters, body and response definitions remain in
`x-upstream-s3-object-contract`. XML service errors remain text.

Configure an explicit HTTPS standard regional endpoint, for example
`https://s3.us-east-1.amazonaws.com` for path addressing or
`https://operations-files.s3.us-east-1.amazonaws.com` for virtual hosting.
Use the object's actual region. Supply Bucket and the original, unencoded Key;
the virtual-hosted bucket must match Bucket. Dotted buckets use path addressing.
Global, legacy dash, FIPS, accelerate, directory-bucket, access-point, other
partition and custom endpoints are outside this profile. Redirects are rejected.

Keys retain UTF-8 characters, spaces, literal percent sequences and repeated,
leading or trailing slashes. The limit is 1,024 UTF-8 bytes. Standalone `.`/`..`
segments and control characters are rejected because browser URL normalization
cannot preserve those object addresses safely.

Unlock the vault and select the existing AWS access key ID, secret access key
and optional temporary session token. Save the selection as an HTTP connection
to reuse it for both object operations after re-unlocking. Region/account/key
changes require a current connection reference. No bucket or credential is
created automatically.

For upload, choose **Object data** or connect File/Binary output to it. Optional
Metadata is a JSON object of printable ASCII strings, expanded into real
`x-amz-meta-*` headers with unique names, at most 32 entries and 2 KiB total.
Cache-Control, Content-Disposition, Content-Language and `If-None-Match: *` are
also supported. Content-Type comes from the file. Content-Encoding, SSE-C keys,
ACLs, multipart/resumable and other unimplemented inputs are rejected.
Downloads support an optional version ID and If-Match condition; partial ranges
are outside this profile.

Each upload signs the exact payload and sends its SHA256 checksum. Downloads
request stored checksums and verify a full-object SHA256 value, or a matching
legacy single-part MD5 ETag. Composite checksums, missing/unexposed integrity
headers or mismatched bytes cannot release a file. This also prevents transparent
decompression from silently changing stored object bytes. SSE-KMS objects need
an exposed usable full-object checksum and the applicable IAM/KMS permissions;
their opaque ETag is not treated as an MD5 checksum.

Configure bucket CORS for the exact Operations origin, GET/PUT, required request
headers and exposed integrity headers. S3 answers OPTIONS preflight for that rule;
OPTIONS is not an AllowedMethods entry. This example must be adapted to your
deployed origin:

```json
[
  {
    "AllowedOrigins": ["https://operations.example"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": [
      "authorization", "content-type", "x-amz-date", "x-amz-content-sha256",
      "x-amz-security-token", "x-amz-checksum-sha256", "x-amz-checksum-mode",
      "x-amz-meta-*", "cache-control", "content-disposition", "content-language",
      "if-match", "if-none-match"
    ],
    "ExposeHeaders": [
      "ETag", "x-amz-checksum-sha256", "x-amz-checksum-type", "x-amz-version-id",
      "Content-Disposition", "Content-Encoding", "x-amz-bucket-region"
    ],
    "MaxAgeSeconds": 300
  }
]
```

An interrupted upload or a success response without verifiable integrity can
mean the object was already stored. Check the object and CORS settings before
retrying. The application never replays a request automatically. A secret-bearing
download is withheld entirely rather than edited into a different file.

Contracts reviewed 2026-10-25: [PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html),
[GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html),
[addressing](https://docs.aws.amazon.com/AmazonS3/latest/userguide/VirtualHosting.html),
[integrity](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html),
[ETag semantics](https://docs.aws.amazon.com/AmazonS3/latest/API/API_Object.html)
and [CORS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html).
Evidence is synthetic: production-worker transfers at phone/desktop widths and a
separate native browser preflight/header-exposure probe. Intercepted S3 requests
are not presented as native CORS evidence. Real bucket, IAM and deployed-origin
CORS qualification require a separately authorized test bucket and remain pending.
