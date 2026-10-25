# GitHub authentication contracts

The bundled GitHub schema omits authentication on all 1,242 operations. The
`github-authentication` correction supplies operation-specific choices while
retaining the complete original schema and stable operation IDs.

The reviewed matrix retains 214 anonymous public-resource choices. Permission-free
token access is a separate concept: `GET /user` still requires a user credential,
and installation routes require an installation token. Public-read flags do not
authorize caller-specific endpoints or resource mutations. The revocation endpoint
is explicitly anonymous-only; its provider contract rejects authenticated requests.

| Choice | Required existing credential |
|---|---|
| GitHubPersonalAccessToken | A personal token accepted by the endpoint |
| GitHubAppUserToken | A GitHub App token acting for a user |
| GitHubInstallationToken | A token for the intended app installation |
| GitHubAppJWT | A JWT authenticating as the app |
| GitHubOAuthApp | Separate client-ID and client-secret vault references for Basic |
| GitHubClassicUserToken | A documented OAuth/classic PAT with the method's scopes |
| GitHubClassicPersonalAccessToken | A classic PAT with `notifications` or `repo` scope for Notifications |

Each choice remains a separate security alternative in canonical approval and
credential binding. The application does not retry another role or anonymous
access after an authentication failure. Credentials remain opaque: GitHub verifies
their issuer, permissions, resource access and expiry. A named choice is not local
proof of a token's validity or origin. Issuance, signing and refresh are separate.

Eighty operations lack a qualified authentication profile in the reviewed data and
remain explicitly unavailable. This includes some classic-only and experimental
families; missing fine-grained metadata does not prove they are public or that a
generic bearer token works. Nineteen credential-sensitive response contracts also
remain blocked pending private result handling. These groups overlap on app
manifest conversion, leaving 1,144 models usable by the current adapter. This is
deterministic capability evidence, not live account or permission qualification.

OAuth-app revocation can use the existing private-variable mechanism for the
target access token in its body. Client secrets and token inputs are resolved
privately and redacted. Token issuance/check/reset responses, app-manifest private
keys, runner tokens, webhook secrets and secret-scanning values are not emitted as
ordinary workflow results.

The ten Notifications methods use only the dedicated classic personal-token
choice. Their [versioned provider contract](https://docs.github.com/en/rest/activity/notifications?apiVersion=2022-11-28)
requires a classic PAT with `notifications` or `repo` scope and excludes fine-grained
and GitHub App tokens. OAuth tokens are not offered for this family. Other
classic-only or experimental families remain unreviewed; this qualification does
not infer their credentials or anonymous access from missing metadata.

All ten native methods retain their paths, inputs and result schemas. A denied
request never retries with another role or anonymously. The local profile checks
the selected authority; GitHub still verifies the opaque token's type, scopes and
account access. Qualification uses synthetic private dispatch without reading or
marking live notifications.

## Evidence and maintenance

The matrix in [github-authentication-data.ts](../src/lib/github-authentication-data.ts)
matches every native method/path against 51 first-party documentation data files,
with two pinned guide/reusable files qualifying Notifications' classic-PAT rule.
It records source URLs, byte counts, hashes, permission sets and reviewed
exceptions. Its JSON is parsed only when the GitHub correction is applied.

Matrix revision 2 preserves the native and documentation revisions while recording
the Notifications guide and reusable source URLs, hashes and byte counts. The
correction rejects previously corrected documents carrying an older matrix stamp;
approval must be based on the current effective contract.

- Native schema: version `1.1.4`, JSON SHA-256
  `f9293195f0097a6ae134f8652fca11d15dc26638ee312dd3ce35d5723d56925a`.
- Documentation: [github/docs revision 02c25d1](https://github.com/github/docs/tree/02c25d16369fe27f9bdb28d1201f6b452f0d21dd/src/rest/data/fpt-2022-11-28),
  retrieved 2026-10-24. The API version is `2022-11-28`, which remains the
  [default for requests without a version header](https://docs.github.com/en/rest/about-the-rest-api/api-versions).
- Governing contracts: [authentication](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api),
  [app JWTs](https://docs.github.com/en/rest/apps/apps),
  [installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation),
  [OAuth-app Basic](https://docs.github.com/en/rest/apps/oauth-applications) and
  [anonymous revocation](https://docs.github.com/en/rest/credentials/revoke).

The updater rejects a new native digest until the matrix is requalified. Recheck
the relevant documentation revision, endpoint, permission set, result sensitivity
and public-access exceptions when updating it. Unknown entries require endpoint
evidence and focused positive/negative cases before enabling them. Do not infer
anonymous access from `allowPermissionlessAccess` or app authentication from the
upstream `enabledForGitHubApps` flag.

The correction preserves missing upstream declarations as
`x-upstream-security: null`, retains explicit upstream decisions, and rejects changed method/path/host
bindings. GitHub's separate upload origin is preserved. Corrected and editable
documents cannot mutate the cached contract matrix. Refresh the source descriptor
and discovery indexes together after an authorized correction change.
