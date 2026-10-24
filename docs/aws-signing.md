# AWS request signing

The Lambda AWS profile supports the bundled `ListFunctions` operation,
`GET /2015-03-31/functions/`, using Signature Version 4 and a JSON response.
Configure an explicit HTTPS regional server such as
`https://lambda.us-east-1.amazonaws.com` in the schema's server settings. Its
configured region is part of the private approval and saved connection.
The original pack's first HTTP server cannot receive credentials.

Add the access key ID and secret access key as separate vault entries. For
temporary credentials, also store the session token. In the operation's
authentication controls, unlock the vault, select `hmac`, choose those entries,
and optionally save the selection as an HTTP connection with an account label.
The optional session-token control can be cleared with **No session token**.
Reload requires unlocking again; the workflow retains references, not key values.

Smithy `@smithy/signature-v4` 5.7.4 and `@smithy/core` 3.36.2 perform signing in
the vault worker using Web Crypto. No ambient SDK credential provider is used.
The worker binds the final method, URI, repeated query values, headers and payload
hash to the approved service/region. It sends the exact signed payload copy;
unspecified multipart boundaries and streaming bodies are rejected. Browser
controlled Host is derived from the final URL for signing and is not set as a
Fetch header. Signing-key caches are cleared after each signing attempt.

The initial profile fixes the signing service to `lambda` and accepts standard
regional `lambda.<region>.amazonaws.com` HTTPS endpoints for the reviewed regions
in `src/lib/aws-signing.ts`. FIPS, dual-stack, China/GovCloud, custom endpoints,
SigV4a and presigned URLs are not included. Changing the region or account/key
selection requires a current connection reference. Public forms cannot supply
Authorization, date, token, hash or other signing-protocol fields. The worker
checks current schema/vault authority after signing and rejects a signature
delayed by more than a minute before dispatch. It does not correct the device
clock automatically.

Temporary credentials are supplied as a key pair plus session token; obtaining
them from STS is separate. A configured connection expiry is enforced locally;
otherwise AWS determines token expiry and permissions. Credential/signature
echoes and URI/form encodings are scrubbed from results and failures. Requests
are not automatically retried.

Both `awsSigv4` and `awsS3` declarations require a signing profile. Reviewed
[S3 object file profiles](s3-files.md) now support signed raw PutObject/GetObject
transfers. Other S3 methods and AWS action/target,
Query/XML and AWS-JSON operations retain their independent limitations. Native
schemas and operation identities remain unchanged; discovery indexes are updated.

The profile follows the [AWS signing rules](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html),
[Lambda ListFunctions contract](https://docs.aws.amazon.com/lambda/latest/api/API_ListFunctions.html)
and [regional endpoints](https://docs.aws.amazon.com/general/latest/gr/lambda-service.html),
reviewed 2026-10-25. Tests include published [Smithy signature vectors](https://github.com/smithy-lang/smithy-typescript/blob/main/packages/signature-v4/src/SignatureV4.spec.ts),
an independent signature verifier, encrypted connection reload and production
worker requests at phone/desktop widths. These are synthetic checks. No live AWS
account, IAM permission or browser CORS qualification is claimed; an authorized
sandbox and a service allowing browser requests are required for that check.
