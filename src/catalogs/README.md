# Bundled OpenAPI catalogs

These JSON files provide the initial example schemas and their authored navigation
groups. An `*.openapi.json` file defines requests and responses; its matching
`*.groups.json` arranges operations into nested groups. Register a new pair in
[catalog-registry.ts](../lib/catalog-registry.ts), including its stable catalog ID
and execution origin.

## The two examples

`demo.openapi.json` illustrates OpenAPI methods, input types and response models.
Its URLs use [example.com, an IANA documentation domain](https://www.iana.org/help/example-domains).
The paths and response schemas describe illustrative shapes; there is no backing
API serving those contracts. Execution sends a real request to that placeholder
host and can fail or return a different representation.

`httpbin.openapi.json` contains sample requests to the live
[httpbin request and response service](https://httpbin.org/), using `/anything`.
The typed query fields and JSON/form shapes are choices made for these example
forms, rather than requirements imposed by httpbin. Neutral values such as `foo`
and `bar` demonstrate the request representations and their echoed responses.

## Service packs

[services](services/README.md) contains the reviewed provider library as compressed
OpenAPI documents and a provenance/integrity index. Refresh these through the
explicit build tooling; ordinary builds use checked-in packs without downloading
schemas. Keep credentials and user data out of these files.

Service defaults use factory-backed storage until edited or historical inspection
requires a Git copy. Existing profiles gain newly introduced defaults; deleted
entries stay deleted, and authored copies are preserved.

## Operation identity

Group entries refer to qualified operation IDs such as `demo:listProjects`,
combining the catalog ID with the OpenAPI operation ID. Keep those references
consistent when changing documents. IDs can already be referenced by saved
workflows, so renaming one has consequences beyond navigation labels.
The original project/task IDs and request field names remain for compatibility;
visible labels describe generic schema examples.

## Schema compatibility

The application supports a validated subset of OpenAPI 3.0/3.1. Check changes
against `schema-documents.ts` and `catalog.ts` in [lib](../lib/README.md), including
server URLs, supported inputs and response models. These files are example API
contracts, not places for runtime credentials or user-uploaded documents.

## Seeding boundary

Bundled catalogs seed the browser-local schema library once, preserving the
`demo` and `httpbin` IDs. Existing users manage their own repository copies;
editing a bundled file does not replace those copies, and deleting all documents
does not trigger reseeding. Enabled documents subsequently supply the live
operation registry. See [OpenAPI adaptation](../../docs/adr/openapi-adaptation.md)
for replacement and saved-workflow compatibility rules.

## Verification

Use the focused `src/operations.feature`, `src/operation-report.feature` and
`src/schema-documents.feature` checks for operation models and navigation.
Selected schema browser cases under [tests](../../tests/README.md) cover
persistence and registry behavior; full regression belongs to CI.
