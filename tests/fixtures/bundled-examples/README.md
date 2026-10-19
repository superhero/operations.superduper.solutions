# Legacy bundled examples

`legacy.json.gz` contains parsed OpenAPI documents and navigation groups copied
from the source commits recorded in each entry: the original `demo` from
`11683df`, and the `demo` and `httpbin` versions from `6ed1b70`.

These immutable fixtures reproduce saved browser schemas that still use project
and task labels. They are loaded only by the example-upgrade scenarios and are
not included in the application or the shared browser fixture bundles.
Their serialized Git blob IDs match
[`example-revisions.json`](../../../src/catalogs/example-revisions.json).
