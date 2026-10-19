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

## Provider collections

Display names use spaced `/` separators for provider and product levels, such as
`Google / Cloud / Compute` and `Microsoft / Azure / Resources`. Factory-owned
labels refresh on startup; user-authored names retain their saved values.

Cloud providers expose separate API descriptions. The initial Google Cloud
collection covers Compute and Storage; AWS covers S3 and Lambda; Azure covers
Resource Manager resources. These are named service contracts, not a claim to
include every product offered by those providers. Source provenance distinguishes
provider documents from community conversions.
