# Operation capabilities

Unavailable operations show their independent limitations together. Hover or
focus a disabled catalog row for an explanation; activate it to open the
requirements dialog, including on a touch screen. This action does not add or
execute the operation. Operation reports also show capabilities, and workflow
runs distinguish required connection selections from selected ones.

## Meaning of the diagnostics

Endpoint configuration, parameter serialization, request bodies,
authentication and response contracts are inspected independently. A failure
in one phase does not suppress checks in another. The adapter retains a
representative failure from each phase; it is not a complete schema linter.
The existing `unavailableReason` remains for compatibility.

Authentication alternatives preserve their original source positions and all
AND members. Their `security-N` identities are scoped to the current canonical
source and policy fingerprint. Unsupported choices can coexist with supported
or anonymous choices. A malformed declaration fails the authentication contract
even when an anonymous alternative exists. Required credentials or a private
connection are configuration requirements, rather than evidence that the
schema is malformed.

Native diagnostics separately identify an unsupported workflow method and an
incompatible schema/runtime version. The requirements also describe companion
pairing and origin trust, public account state, workspace authority, explicit
method/interaction permission and terminal turn completion. Docker's native
container-list route describes its separate paired-host or configured-HTTP
destination requirement. A selection label does not grant execution authority.

## Loading and authority

Discovery version 2 stores compact diagnostic tuples: the first legacy error
is referenced rather than duplicated, authentication identities derive from
source positions, and shared requirement prose is represented by stable codes.
Only the operation being inspected expands this summary. Discovery descriptors
retain no executable input model or credentials. Displaying requirements does
not hydrate models, read disabled source documents, unlock credentials or
initialize a provider.

Canonical models retain full diagnostics. Model loading, graph visits, request
preparation and private HTTP approval reject their current blockers, including
when a caller removes the old error string or supplies optimistic discovery
metadata. The existing source identity and private-worker policy checks still
own execution. Adapter revision changes invalidate derived discovery and policy
caches; obsolete or malformed diagnostic indexes are rejected.

Canonical metadata participates in the existing private policy fingerprints.
This adapter update can require reselecting or reauthorizing an older private
connection or pairing. Credentials and saved workflows are retained; existing
authority is never silently upgraded.

For the 224 bundled discovery packs, compressed bytes changed from 835,735 to
886,302 (+6.1%); decoded JSON changed from 9,670,026 to 13,020,952 bytes. The
compact summaries avoid the 19,179,785-byte decoded result of storing full prose
on every descriptor. Full source documents remain lazy; diagnostic details are
expanded only for the selected operation.

## Verification

`src/capability-diagnostics.feature` covers simultaneous failures, successive
fixes, alternatives, runtime requirements, compact discovery and canonical
dispatch guards. Browser cases cover desktop and phone activation, actual
schema-storage/private-policy rejection, disabled-source counters and the
existing delegated help and search navigation paths. Related source cases
cover the affected authentication, HTTP, native, Docker, upload and bounded
model-loading interfaces. Full regression suites remain CI's responsibility.
