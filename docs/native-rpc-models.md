# Native RPC operation models

The Codex schema keeps all 105 client-method identities from protocol `0.163.0`.
Discovery remains compact. Loading a method asks the schema worker for a native
model with `protocol: "json-rpc"`, its version, method, parameter requirement and
parameter/result/error schemas. It has no HTTP origin. The existing `RPC` and
method-name discovery labels are not an HTTP verb or URL.

The scoped document preserves the selected wire request, generic success/error
frames and their local definition-reference closure at the original pointers.
Other methods, notifications and unrelated definitions stay in the source pack.
Recursive references remain references. Missing, external or malformed references,
ambiguous methods, excessive traversal and scoped documents over 1 MiB are rejected.

The pinned wire schema declares `result: true`; it does not associate each method
with a typed result. Operations therefore exposes that result as `Unknown`, with
an explicit unrestricted-JSON marker. It can connect through a Cast without
claiming a concrete type. Missing or unsupported schema fields remain unavailable.
Error properties follow the native error schema. Native panels have Parameters,
Result and Error branches, without HTTP status codes, headers or response bodies.

Saved workflows retain the native discriminator, version and method alongside
their parameter/result panels and connections. These are advisory graph data;
imports cannot carry credentials or execution authority. Reopening a workflow
hydrates its native models from the currently enabled source. Legacy HTTP
workflows retain their existing format.

Native model fingerprints bind the protocol, canonical operation and exact scoped
schema independently of HTTP destination/credential fingerprints. Schema storage
publishes them only after a complete batch succeeds. The existing private policy
reader checks current enabled source metadata, revision, adapter revision and
fingerprint; disabled, replaced, pending or missing sources cannot authorize an
old or page-forged descriptor. The adapter revision includes the native scoping
implementation so derived indexes and policies refresh when its contract changes.

Hydration coalesces duplicate requests and retains the existing 16-model batch
limit and 8 MiB cache eviction budget for unpinned models. Open workflows pin
their models; closing releases that ownership. Catalog republication preserves
the native discriminator, and late replies from replaced sources are rejected.

Loading or approving a model does **not** enable native execution. HTTP preparation,
HTTP credential approval and both workflow HTTP executors reject native methods.
The [paired runtime contract](codex-native-connector.md), runtime pairing and the
bounded Codex workflow adapter remain separate deliveries. No Codex process,
account login or provider request is started by model hydration.
