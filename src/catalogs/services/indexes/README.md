# Service discovery indexes

These generated compressed indexes contain navigation and matching descriptors,
schema descriptions, summary counts and source identities. Full OpenAPI documents
remain in the parent directory; request models are loaded from those documents
when needed.

## Generation

Run `npm run schemas:index` after changing source packs or schema adapters.
`index.json` records source and index hashes, byte limits and the adapter revision.
The normal build checks freshness without contacting providers.

## Ownership

Do not edit these artifacts by hand. Change the source schema or adapter and
regenerate. Browser caches are disposable derivatives of these artifacts and
browser-local Git content; they never replace authoritative schema history.
