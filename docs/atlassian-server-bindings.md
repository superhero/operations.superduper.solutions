# Atlassian server identities

Assets server configuration now has explicit Cloud ID and Workspace ID slots.
The corrected source keeps its HTTPS template and all 64 native method/path IDs.
Both slots start as placeholders and remain unavailable for execution until
configured. No tenant or workspace is chosen automatically.

## Configure Assets

In **Settings → Schemas**, download the Assets schema and set these two values
for your authorized site:

- `servers[0].variables.cloudId.default`: the site's Cloud ID.
- `servers[0].variables.workspaceId.default`: its Assets Workspace ID.

Keep the server template and its `x-operations-server-binding` marker intact.
Use the existing **Replace** action on that same schema to save the configured
file. The normal schema history/diff remains available. Reauthorize the private
connection for the resulting destination; changing either identity invalidates
its previous approval.

Atlassian's [Assets workflow guide](https://developer.atlassian.com/cloud/assets/assets-rest-api-guide/workflow/)
explains workspace discovery. Its [OAuth routing guide](https://developer.atlassian.com/cloud/assets/assets-rest-api-guide/scopes-for-oauth-2-3LO-and-forge-apps/)
places both identities in the gateway prefix:

`https://api.atlassian.com/ex/jira/{cloudId}/jsm/assets/workspace/{workspaceId}/v1`

Identity values must be explicit bounded alphanumeric/hyphen identifiers.
Empty values, the old literal `workspaceId`, placeholders and path fragments are
rejected before URL parsing. The configured HTTPS base, including both identity
segments, participates in canonical private approval. Unrelated server templates
retain their existing validation and precedence.

The current functional AQL route is POST `/object/aql`; the
[legacy GET AQL reference](https://developer.atlassian.com/cloud/assets/rest/api-group-aql/)
retains its deprecation and Connect-only declaration. The
[icon reference](https://developer.atlassian.com/cloud/assets/rest/api-group-icon/)
qualifies GET `/icon/{id}` with its original OAuth scope. These corrections do
not create OAuth accounts, issue Connect JWTs or qualify every Assets operation.

## JSM subscriber deletion

The pinned subscriber-delete path has a generated server override that duplicates
the prefix and contains an undeclared variable. The correction records that old
value in `x-upstream-servers` and inherits the documented parent instead.
Atlassian's [Status Page reference](https://developer.atlassian.com/cloud/jira/service-desk-ops/rest/v2/api-group-status-page/)
uses Basic authentication and this exact route:

`https://api.atlassian.com/jsm/ops/stakeholder-comms/cloudId/{cloudId}/api/subscribers/delete`

Cloud ID remains a required explicit input, and the JSON `ids` array is retained.
The native operation ID and the existing unavailable OAuth gateway choice remain
unchanged. Credentials approved for the old duplicated destination cannot be
reused for the corrected destination. Other missing JSM parameter contracts stay
guarded.

## Provenance and verification

The source builder checks exact raw revisions before applying the correction:

- Assets: `b262df791938ce2e4b67e6239b871fc4d9e045e2107b42b0ce00bc131534dcd1`.
- JSM Ops: `c0fb62c243a89256567fdfb82d3667cd779f9a99dff9a9efe5b3a99b375b0d1d`.

JSM applies its existing path-input correction before the server correction.
Raw packs, original operation identities and authentication declarations are
preserved. Changed provider/version/template data or ambiguous recipe ordering
fails qualification. Compass receives no correction.

`src/atlassian-server-bindings.feature` covers all 64 Assets identities, configured
AQL/icon private requests, missing/unsafe values, changing either approval-bound
identity, exact JSM JSON/URL preparation and old-destination rejection. Related
cases retain general server rules and the resolved JSM residual classification.
Checks use one owned sds-01 Swarm job at a time, 4 CPUs/16 GiB, zero additional
swap, 512 PIDs and no GPU. No live tenant data or subscriber deletion is performed.
