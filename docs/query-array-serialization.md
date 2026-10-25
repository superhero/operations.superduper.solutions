# Comma-separated query arrays

Query parameters declared with `style: form` (or its default) and
`explode: false` now support arrays of strings, finite numbers, integers or
booleans. This applies to the reviewed primitive-array contract; nested,
binary, nullable-item, content-encoded and custom reserved/empty-value profiles
remain unavailable. Existing scalars, repeated query arrays and deep objects
keep their prior encoding.

## Wire representation

Each item is percent-encoded independently and structural commas remain literal:

```text
["a,b", "space value", "%2C"]
colors=a%2Cb,space%20value,%252C
```

Split items at the literal commas **before** percent-decoding their values.
This preserves member commas, percent escapes, reserved characters, Unicode and
empty string members. The rules follow the
[OpenAPI parameter style examples](https://spec.openapis.org/oas/v3.1.1.html#style-examples)
and [delimiter guidance](https://spec.openapis.org/oas/v3.1.1.html#delimiters-in-parameter-values),
reviewed 2026-10-25.

An omitted optional field sends no parameter. An empty optional array also sends
no parameter, following RFC6570's undefined empty-collection treatment. An empty
required array fails validation rather than dropping a required parameter.
`[""]` sends `colors=`. Explicit null has no qualified array encoding and fails
with a field-specific error even if the outer schema is nullable; omit the field
or supply a non-null array. Declared item constraints and array bounds still
apply.

## Canonical and private behavior

The field's reviewed serialization profile becomes part of its canonical model
and private approval fingerprint. Saved workflow fields cannot override it.
Prepared requests retain the array plus its encoding profile; the shared URL
encoder handles direct HTTP and private-worker requests.

Private query credentials are checked for collisions and added in the same
encoding pass. No later `searchParams` mutation can collapse encoded member
commas into structural delimiters. Strict percent-encoded secret variants are
registered for response redaction as well as existing raw and form-encoded
variants. Previews retain no injected credentials.

## Evidence and limits

`src/query-array.feature` verifies exact prepared values and URL bytes, escaping,
empty/null semantics, unsupported shapes, unchanged transports, private query
injection/redaction, canonical fingerprints and native preparation of
`gitlab:getApiV4AiDuoWorkflowsWorkflowsIdCheckpoints`. The bundled source and
operation identity remain intact. Browser cases exercise saved public and
private workflows through actual loopback HTTP and the production vault worker.

Discovery availability can improve for other operations using the same finite
profile. This is not general GitLab/Cloudflare compatibility or live-provider
qualification: other endpoint, authentication, body and response limitations
remain independently enforced. Provider schemas and runtime pins are unchanged;
no live API is contacted by the connector checks. Checks use the CI-aligned
4-CPU/16-GiB sds-01 Swarm boundary with no extra swap or GPU.
