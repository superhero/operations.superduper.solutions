// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { OperationSecurity } from "./operation-security.ts";
/** Build-time pins supplement the runtime checks of provider, routes and inputs. */
export const providerPathBindingSources: Record<string, string> = {
  gitlab: "e5ab69dc7cbfde3b2f2a6c27faccf33a57dabaa70967bb0b52697633050e13e3",
  "jira-service-management-ops": "c0fb62c243a89256567fdfb82d3667cd779f9a99dff9a9efe5b3a99b375b0d1d",
};
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function requireContract(condition: unknown): asserts condition {
  if (!condition) throw new Error("Provider path bindings do not match the reviewed source contract.");
}

function gitlab(document: Record<string, any>): void {
  requireContract(document.info?.version === "19.5" && document.servers?.length === 1
    && document.servers[0].url === "https://{hostname}" && document.servers[0].variables?.hostname?.default === "gitlab.com"
    && object(document.paths) && object(document.components?.securitySchemes));
  const contracts = [
    { method: "get", path: "/api/v4/jobs/{id}/sbom_scans/{sbom_digest}",
      corrected: "/api/v4/jobs/{id}/sbom_scans/{sbom_scan_id}",
      id: "getApiV4JobsIdSbomScansSbomScanId", parameters: ["id", "sbom_scan_id"] },
    { method: "post", path: "/api/v4/groups/{id}/(-/)epics/{epic_iid}/issues/{epic_issue_id}",
      corrected: "/api/v4/groups/{id}/epics/{epic_iid}/issues/{issue_id}",
      id: "postApiV4GroupsIdDashEpicsEpicIidIssuesIssueId", parameters: ["id", "epic_iid", "issue_id"] },
  ];
  for (const contract of contracts) {
    const item = document.paths[contract.path], operation = item?.[contract.method];
    requireContract(object(item) && !item.parameters && object(operation) && operation.operationId === contract.id
      && Array.isArray(operation.parameters) && !Object.hasOwn(document.paths, contract.corrected)
      && !Object.hasOwn(operation, "x-upstream-path") && !Object.hasOwn(operation, "x-upstream-security"));
    const inputs = operation.parameters.filter((parameter: any) => parameter?.in === "path");
    requireContract(JSON.stringify(inputs.map((parameter: any) => parameter.name)) === JSON.stringify(contract.parameters)
      && inputs.every((parameter: any) => parameter.required === true && object(parameter.schema)));
  }
  requireContract(!Object.hasOwn(document.components.securitySchemes, "GitLabJobToken"));
  for (const contract of contracts) {
    const item = document.paths[contract.path], operation = item[contract.method];
    operation["x-upstream-path"] = contract.path;
    document.paths[contract.corrected] = { ...Object.fromEntries(Object.entries(item).filter(([key]) => !methods.has(key))), [contract.method]: operation };
    delete item[contract.method];
    if (!Object.keys(item).some(key => methods.has(key))) delete document.paths[contract.path];
    if (contract.method === "get") {
      // The result endpoint is analyzer-facing and uses the job-token header.
      operation["x-upstream-security"] = structuredClone(operation.security ?? document.security);
      operation.security = [{ GitLabJobToken: [] }];
    } else {
      operation.deprecated = true;
      operation.description += "\n\nThe Epic Issues API is deprecated. Use the Work Items API for current GitLab installations.";
    }
  }
  document.components.securitySchemes.GitLabJobToken = { type: "apiKey", in: "header", name: "JOB-TOKEN" };
}

function jsm(document: Record<string, any>): void {
  requireContract(document.info?.version === "1" && document.servers?.length === 1
    && document.servers[0].url === "https://api.atlassian.com/jsm/ops/"
    && document.components?.securitySchemes?.basicAuth?.type === "http" && document.components.securitySchemes.basicAuth.scheme === "basic"
    && object(document.paths));
  const missing: Record<string, any>[] = [];
  let operations = 0;
  for (const [path, item] of Object.entries(document.paths)) {
    requireContract(object(item) && item.parameters === undefined
      && (/^\/api\/\{cloudId\}\/v1\//.test(path) || /^\/stakeholder-comms\/cloudId\/\{cloudId\}\/api\//.test(path)));
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      operations++;
      requireContract(object(operation) && operation.operationId === `${method.toUpperCase()} ${path}`
        && (operation.parameters === undefined || Array.isArray(operation.parameters)));
      const cloud = (operation.parameters ?? []).filter((parameter: any) => parameter?.in === "path" && parameter.name === "cloudId");
      requireContract(cloud.length <= 1 && (!cloud.length || cloud[0].required === true && cloud[0].schema?.type === "string"
        && cloud[0].schema.default === undefined && cloud[0].schema.nullable !== true));
      if (!cloud.length) missing.push(operation);
    }
  }
  requireContract(operations === 240 && missing.length === 236);
  for (const operation of missing) operation.parameters = [...operation.parameters ?? [], {
    name: "cloudId", in: "path", required: true,
    description: "The cloud ID of the selected Jira instance. Supply its explicit site identifier.",
    schema: { type: "string", title: "Cloud ID", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9-]*$" },
  }];
  document["x-operations-provider-path-bindings"] = "jsm-basic-v1";
}

/** JSM's OAuth gateway route is a different contract from this Basic site route. */
export function providerPathSecurity(document: Record<string, any>, id: string, security: OperationSecurity | undefined): OperationSecurity | undefined {
  if (document["x-operations-provider-path-bindings"] !== "jsm-basic-v1"
    || document.info?.title !== "JSM Operations API" || document.info.version !== "1"
    || !id.startsWith("jira-service-management-ops:") || document.servers?.[0]?.url !== "https://api.atlassian.com/jsm/ops/") return security;
  return security?.map(alternative => alternative.map(scheme => scheme.name === "OAuth2" ? {
    name: scheme.name, kind: "unsupported" as const, header: "Authorization" as const,
    reason: "JSM Operations OAuth 2.0 requires its separate gateway route. Configure that integration before using OAuth; this site route supports Basic authentication.",
  } : scheme));
}

/** Correct only reviewed provider data. Keep native IDs and peer methods intact. */
export function bindProviderPaths(document: Record<string, any>): void {
  if (document.info?.title === "GitLab REST API") gitlab(document);
  else if (document.info?.title === "JSM Operations API") jsm(document);
  else requireContract(false);
}
