# Default service schemas

Compressed OpenAPI documents retain the upstream schema data and notices. These
are application inputs, not credentials or live API responses. The schema worker
verifies each pack's size and SHA-256 before accepting its decoded content.

## Discovery indexes

[`indexes`](indexes/README.md) holds generated summaries and operation descriptors.
Startup opens enabled indexes; full sources load only for canonical operation
models, inspection, download or editing. Disabled schemas retain metadata without
source decoding. All compressed artifacts still ship in the single HTML file.

## Sources and regeneration

`index.json` records each source, version, conversion, operation count and hashes.
The authored source list is `build/service-schemas.sources.json`; regenerate packs
with `npm run schemas:refresh`. Pass catalog IDs to `build/service-schemas.mjs` to
refresh selected packs, then run `npm run schemas:index`.
Network downloads are cached under ignored `tmp/schema-sources`, with at most two
requests active and bounded retries. Builds use committed packs without fetching
provider schemas.

## Formats

Docker Engine and Azure's Swagger documents are converted to OpenAPI 3. External
references are bundled into local references; recursive models remain references
rather than being expanded into circular or duplicated objects. Original request
and response descriptions remain in each pack.

DeepSeek and Dukascopy publish structured metadata through their documentation.
Refresh their authored snapshots with `build/deepseek-schema.mjs` and
`build/dukascopy-schema.mjs` before regenerating the corresponding packs.

FRED and ALFRED share the community-maintained FRED v1 contract.
`build/fred-schema.mjs` produces separate economic-data and archival profiles,
selects JSON for workflow outputs, describes documented response fields and adds
the official FRED v2 bulk-release endpoint to FRED. ALFRED retains real `/fred`
routes with vintage and real-time parameters. Refresh both with
`node build/service-schemas.mjs fred alfred`, then regenerate discovery indexes.

Statuspage publishes its OpenAPI document inside ReDoc documentation. Sources
marked `conversion: "redoc"` extract only that JSON document with
`build/redoc-schema.mjs`; documentation scripts are never evaluated. Opsgenie's
official Swagger 2 document uses the existing Swagger conversion.

New Atlassian sources opt into `operationIds: "method-path"` because upstream
contracts contain duplicate operation IDs and path aliases. The build expands
only path and operation references, then assigns `METHOD /path` identifiers.
Original identifiers and path references remain in `x-upstream-operation-id`
and `x-upstream-path-ref`; recursive data models remain local references.
Existing Bitbucket, Jira and Confluence packs retain their original identities.

## Provider collections

Display names use spaced `/` separators for provider and product levels, such as
`Google / Cloud / Compute` and `Microsoft / Azure / Resources`. Factory-owned
labels refresh on startup; user-authored names retain their saved values.

Cloud providers expose separate API descriptions. AWS includes 55 contracts,
Google Cloud 52, and Azure 13. They cover compute, storage, databases, networking,
identity, messaging and other service families; the
[cloud inventory](../../../docs/default-service-schemas.md#cloud-providers)
records the boundaries and conversion provenance. Existing S3, Lambda, Google
Compute/Storage and Azure Resources packs retain their payloads and identities.

AWS and Google Cloud use community OpenAPI conversions of provider models and
Discovery documents. Azure uses its official Swagger documents, converted with
the same recursive-reference bundling as the existing Resources pack. Adding a
description does not add a signing protocol or expand execution support.

Atlassian Cloud, administration, developer platform and Data Center contracts
share the `atlassian` provider and `Atlassian / …` display prefix. The
[service inventory](../../../docs/default-service-schemas.md#atlassian) records
product scope, complementary API versions and execution limits. Refresh selected
IDs rather than unrelated providers when updating this collection.

Cloudflare's main API and the separate Realtime SFU Connection API share the
`cloudflare` provider and `Cloudflare / …` prefix. The main API retains its
existing pack and operation identities. The SFU schema adds 12 operations at
`rtc.live.cloudflare.com` using an SFU App Secret; its account-level management
operations remain in the main API. See the
[Cloudflare inventory](../../../docs/default-service-schemas.md#cloudflare) for
the source boundary and protocols outside these OpenAPI contracts. Refresh only
`cloudflare-realtime-sfu` to update the Connection API.

Google Workspace, YouTube, Analytics and Search Console add 24 contracts under
the `google` provider. Their APIs.guru Discovery conversions opt into the
`google-oauth` profile: `build/google-oauth-schema.mjs` collapses the duplicated
implicit/authorization-code credential pair only when both Google flows and
scope sets match. Original declarations remain in `x-upstream-security`; both
OAuth flow descriptions, scope alternatives, paths and operation IDs remain
available. Generic runtime security checks and existing Google Cloud packs are
unchanged. The [Google inventory](../../../docs/default-service-schemas.md#google-workspace-and-other-google-products)
records product scope, version provenance and authentication/upload limits.
