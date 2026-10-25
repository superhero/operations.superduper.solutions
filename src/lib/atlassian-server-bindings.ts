// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export const atlassianAssetsServer = "https://api.atlassian.com/ex/jira/{cloudId}/jsm/assets/workspace/{workspaceId}/v1";
export const atlassianServerBindingSources: Record<string, string> = {
  "atlassian-assets": "b262df791938ce2e4b67e6239b871fc4d9e045e2107b42b0ce00bc131534dcd1",
  "jira-service-management-ops": "c0fb62c243a89256567fdfb82d3667cd779f9a99dff9a9efe5b3a99b375b0d1d",
};
const profile = "atlassian-assets-v1";
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function requireContract(condition: unknown): asserts condition {
  if (!condition) throw new Error("Atlassian server identities do not match the reviewed source contract.");
}

/** Validate explicit identity slots before URL parsing can normalize their values. */
export function validateAtlassianServerBinding(server: Record<string, unknown>): void {
  const selected = server["x-operations-server-binding"];
  if (selected === undefined) return;
  if (selected !== profile || server.url !== atlassianAssetsServer)
    throw new Error("The Assets identity binding requires its reviewed HTTPS server template.");
  const variables = object(server.variables) ? server.variables : {};
  for (const [name, label] of [["cloudId", "Cloud ID"], ["workspaceId", "Workspace ID"]] as const) {
    const value = variables[name]?.default;
    if (typeof value !== "string" || !value || value === name || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value))
      throw new Error(`Configure the Assets ${label} with an explicit site/workspace identifier before running this operation.`);
  }
}

/** Repair only the pinned Assets template and the single documented JSM override. */
export function bindAtlassianServers(document: Record<string, any>): void {
  if (document.info?.title === "REST") {
    const server = document.servers?.[0];
    requireContract(document.info.version === "1" && document.servers?.length === 1 && server?.url === atlassianAssetsServer
      && object(server.variables) && server.variables.cloudId === undefined
      && server.variables.workspaceId?.default === "workspaceId" && server.variables.version?.default === "version"
      && server["x-operations-server-binding"] === undefined && document["x-upstream-servers"] === undefined && object(document.paths));
    let count = 0;
    for (const [path, item] of Object.entries(document.paths)) {
      requireContract(object(item) && item.servers === undefined);
      for (const [method, operation] of Object.entries(item)) if (methods.has(method)) {
        requireContract(object(operation) && operation.operationId === `${method.toUpperCase()} ${path}` && operation.servers === undefined);
        count++;
      }
    }
    requireContract(count === 64);
    document["x-upstream-servers"] = structuredClone(document.servers);
    server["x-operations-server-binding"] = profile;
    server.variables.cloudId = { default: "<cloudId>", description: "Configure the Cloud ID of the selected Jira site." };
    server.variables.workspaceId = { ...server.variables.workspaceId, default: "<workspaceId>", description: "Configure the Assets Workspace ID for that site." };
    return;
  }
  const path = "/stakeholder-comms/cloudId/{cloudId}/api/subscribers/delete", item = document.paths?.[path], operation = item?.post;
  requireContract(document.info?.title === "JSM Operations API" && document.info.version === "1"
    && document["x-operations-provider-path-bindings"] === "jsm-basic-v1"
    && document.servers?.length === 1 && document.servers[0].url === "https://api.atlassian.com/jsm/ops/"
    && item?.servers?.length === 1 && item.servers[0].url === "https://api.atlassian.com/jsm/ops/api/cloudId/{cloudId}"
    && item["x-upstream-servers"] === undefined && operation?.operationId === `POST ${path}`
    && operation.servers === undefined && Array.isArray(operation.parameters)
    && operation.parameters.filter((value: any) => value?.in === "path" && value.name === "cloudId" && value.required === true).length === 1);
  item["x-upstream-servers"] = structuredClone(item.servers);
  delete item.servers;
}
