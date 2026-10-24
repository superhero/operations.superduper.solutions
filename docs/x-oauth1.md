# X OAuth 1.0a requests

Choose **UserToken** in an X operation's authentication alternatives, then select
four existing vault values: consumer key, consumer secret, access token and access
token secret. Save them as an HTTP connection to reuse the account across X
operations. Values remain in encrypted vault records; workflows retain references.
Portable exports remove those bindings. Creating or authorizing X credentials is
still external to the application.

The vault worker signs the final method, URL/query and URL-encoded form body with
HMAC-SHA1. Each dispatch uses a fresh 256-bit nonce and current Unix timestamp.
JSON and multipart bodies do not contribute OAuth signature parameters. Protocol
parameters cannot be supplied through ordinary query or form fields. Existing
bearer and OAuth2 alternatives keep their positions and execution behavior.

This reviewed profile targets `https://api.x.com/2/` only. Redirects, cookies and
referrers are disabled. Current schema authority, binding fingerprints and saved
connection revisions are checked before dispatch. Rotating or removing any of the
four values invalidates old connection references. Derived signatures,
Authorization headers and encoded signing material are scrubbed from results and
errors, alongside the original credentials.

The native X 2.159 document is retained byte-for-byte. The source-pinned
`x-oauth1-signing` correction annotates its existing HTTP OAuth scheme; it does
not replace OAuth2, change scopes or enable unsupported request serialization.
Browser CORS permission, X account access, token privileges and provider behavior
still require separate live qualification. Automated tests use synthetic keys
and intercepted HTTP; they do not prove live X account access.

The implementation follows [OAuth 1.0a Core](https://oauth.net/core/1.0a/),
[RFC 5849](https://www.rfc-editor.org/rfc/rfc5849.html) and
[X's signature documentation](https://docs.x.com/fundamentals/authentication/oauth-1-0a/creating-a-signature).
The test vectors include the published photo signature and RFC parameter
normalization, checked independently with Node's HMAC implementation.
