# Documentation-derived schemas

These OpenAPI snapshots come from structured metadata published by providers that
do not offer a stable standalone schema download. Keep the metadata's endpoint
paths, parameter types, descriptions and authentication declarations intact.

## Regeneration

Run `node build/deepseek-schema.mjs` or `node build/dukascopy-schema.mjs`, then
`node build/service-schemas.mjs deepseek dukascopy`. Generation fails if the
provider's documentation structure changes rather than producing an empty schema.

DeepSeek embeds compressed API metadata in its documentation modules. The generator
decodes that data without executing downloaded JavaScript. Dukascopy publishes
JSON documentation and dispatches its procedures through a shared query endpoint;
the schema retains its procedure selector and original procedure definitions.

## Provenance

The source manifest records the documentation URLs. These files are generated
schema data, not application code, user data or credentials. Review source changes
before refreshing the committed compressed packs.
