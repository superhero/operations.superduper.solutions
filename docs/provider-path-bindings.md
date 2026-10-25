# Provider path bindings

The reviewed corrections preserve native operation IDs and immutable bundled
upstream schemas. Effective data repairs two GitLab routes and missing JSM Ops
site inputs. The general URI parser and its validation rules are unchanged.

## GitLab identities

The pinned GitLab 19.5 OpenAPI source combines two different identifiers into one
path item. The corrections split only the affected methods:

| Method | Corrected route | Required identifier |
|---|---|---|
| GET | `/api/v4/jobs/{id}/sbom_scans/{sbom_scan_id}` | SBOM scan ID |
| POST | `/api/v4/groups/{id}/epics/{epic_iid}/issues/{issue_id}` | Issue ID |

GitLab's [SBOM scan development guide](https://docs.gitlab.com/development/sec/dependency_scanning_sbom_scan_api/)
distinguishes downloading by scan ID from requesting a cached scan by digest.
It also specifies job-token authentication; the corrected GET uses the existing
private API-key transport with the `JOB-TOKEN` header.

The [Epic Issues API](https://docs.gitlab.com/api/epic_issues/) and its
[route implementation](https://gitlab.com/gitlab-org/gitlab/-/raw/master/ee/lib/api/epic_issues.rb)
distinguish issue IDs used by POST from epic–issue association IDs used by
PUT/DELETE. The effective POST uses the documented route without the source's
literal optional-route expression. The deprecated API is labeled accordingly;
current GitLab installations should use Work Items instead.

The neighboring scan POST and epic PUT/DELETE remain intact. Input schemas retain
their original names and constraints. Moved methods record `x-upstream-path`, and
the scan GET also retains its inherited security as `x-upstream-security`.

## Explicit JSM Ops sites

The pinned JSM Operations 1 source retains all 240 native method/path IDs.
Its 236 missing `cloudId` declarations become required path inputs with no default.
The four existing declarations remain unchanged. Added inputs accept bounded
alphanumeric/hyphen site identifiers, including the documented UUID form; empty,
null, placeholder and path-fragment values fail before private dispatch.

Atlassian's [URL format](https://developer.atlassian.com/cloud/jira/service-desk-ops/rest/v2/intro/),
[schedules reference](https://developer.atlassian.com/cloud/jira/service-desk-ops/rest/v2/api-group-schedules/)
and [authentication overview](https://developer.atlassian.com/cloud/jira/service-desk-ops/security/overview/)
qualify the site position and Basic-token route used by the representative list
and create operations. The server prefix is retained, producing
`https://api.atlassian.com/jsm/ops/api/{cloudId}/v1/schedules`.
The [OAuth 3LO gateway route](https://developer.atlassian.com/cloud/jira/service-desk-ops/security/oauth-2-3lo-apps/)
and issuer remain separate contracts. Its original choice
and scopes stay visible with an unavailable routing reason, and private dispatch
rejects that choice before sending credentials.

Other missing parameter names are not inferred from placeholders. Their endpoint
limitations remain visible. The subscriber-delete server override still needs
the separately scheduled server-binding correction. Actual site IDs and provider
account permissions require explicit user configuration.

## Provenance and verification

Rebuilding existing bundles preserves their original operation-ID provenance;
stable method/path IDs are not reapplied to already transformed packs.
The source builder checks exact raw SHA-256 pins before selecting this correction:

- GitLab: `e5ab69dc7cbfde3b2f2a6c27faccf33a57dabaa70967bb0b52697633050e13e3`.
- JSM Ops: `c0fb62c243a89256567fdfb82d3667cd779f9a99dff9a9efe5b3a99b375b0d1d`.

Runtime checks also require the reviewed provider/version/server, route identities,
parameter declarations and expected inventory. Duplicate or ambiguous bindings,
changed source contracts and route collisions reject the correction. The
recipe modifies a clone, preserving the original document on failure.

`src/provider-path-bindings.feature` covers every changed declaration, preserved
inventories and peer methods, exact canonical private URLs/headers/JSON, missing
inputs, rejected source drift, residual limitations and stale destination approval.
Checks run on one owned sds-01 Swarm job at a time with 4 CPUs/16 GiB, no additional
swap, 512 PIDs and no GPU. Synthetic requests do not create a live schedule, epic
association or SBOM scan; live accounts remain separate qualification work.
