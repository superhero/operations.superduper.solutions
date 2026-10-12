# The application’s workflows represent HTTP operations as nodes whose inputs and responses follow the OpenAPI model

## Decision

An operation node and its connected data panels represent the inputs and responses described by its OpenAPI document. This keeps workflow mappings tied to the API contract rather than presenting every request and response as an undifferentiated value. Utility nodes retain their own application-defined models.

The projection covers the application's supported OpenAPI features; it does not imply complete OpenAPI conformance. The [schema library](schema-management.md) validates execution compatibility before making operations available.

## Inputs

Parameter panels group fields by their OpenAPI location. Path-level parameters are combined with operation-level parameters, with the latter overriding matching names and locations. The request-body panel uses the operation's selected media type. Nested objects and arrays become connected data panels with schema-derived names, types and required markers. Unknown or undocumented structure remains explicit rather than acquiring an invented schema.

## Responses and execution

New HTTP nodes expose one response object for each documented status and representation. Its fields are **Status**, **Status message**, **Response body**, and **Response headers**. Body schemas and documented response headers produce their own nested fields. Responses without content have a null body; unavailable schemas remain explicitly unknown.

HTTP execution retains the actual status, status message, readable headers, and parsed body. An empty status message stays empty. Header lookup is case-insensitive. Documented header values are decoded for typed workflow mappings; undeclared headers remain text. Failed requests retain their response metadata and remain retryable.

The envelope is application structure around the OpenAPI response, not an extra level inside the API's response body. Header serialization follows the [OpenAPI Header Object](https://spec.openapis.org/oas/v3.1.0.html#header-object) rules supported by the workflow runner.

## Saved workflow compatibility

Response field identities use `response:<status>[:media]` and JSON pointers into the response object. Previously saved `output:<status>[:media]` fields remain rooted in the body, preserving their existing mappings. Saved graphs and Git snapshots are not regenerated from a potentially changed OpenAPI document; newly added HTTP nodes use the response layout.
