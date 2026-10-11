# HTTP response outputs

New HTTP nodes expose one response object for each documented status and representation. Its fields are **Status**, **Status message**, **Response body**, and **Response headers**. Body schemas and documented response headers produce their own nested fields. Responses without content have a null body; unavailable schemas remain explicitly unknown.

Response field identities use `response:<status>[:media]` and JSON pointers into the response object. Previously saved `output:<status>[:media]` fields remain rooted in the body, preserving their existing mappings. Saved graphs and Git snapshots are not regenerated from a potentially changed OpenAPI document; newly added HTTP nodes use the response layout.

HTTP execution retains the actual status, status message, readable headers, and parsed body. An empty status message stays empty. Header lookup is case-insensitive. Documented header values are decoded for typed workflow mappings; undeclared headers remain text. Failed requests retain their response metadata and remain retryable.

The envelope is application structure around the OpenAPI response, not an extra level inside the API's response body. Header serialization follows the [OpenAPI Header Object](https://spec.openapis.org/oas/v3.1.0.html#header-object) rules supported by the workflow runner.
