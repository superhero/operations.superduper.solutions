// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { ServerConfigurationRequiredError } from "./server-url.ts";

export const atlassianTenantServerSources: Record<string, string> = {
  "atlassian-customer-service-management": "e4f38a292bbdd3ac6344be7b1bd8a8fbd92007c21480cd2afa671bd8fa6d0e02",
  "atlassian-forms": "59bc96a8e30792e5be7af817ac37100d9ffbebdde4d2c3614b288333b0220688",
  "atlassian-migration-utilities": "8bdd7cc1b4f8f01115d78bb5a2db3be0f7b2dc2be9582198ae28efbd0862ae4d",
};
const profile = "atlassian-tenant-v1";
const contracts = [
  { title: "Atlassian CSM API", version: "1.0.0", openapi: "3.0.0", count: 60, slot: "cloudId", label: "Cloud ID",
    urls: ["https://api.atlassian.com/jsm/csm/cloudid/{cloudId}"] },
  { title: "ProForma Forms RESTful API", version: "0.0.0-alpha", openapi: "3.0.3", count: 34, slot: "cloudId", label: "Cloud ID",
    urls: ["https://api.atlassian.com/jira/forms/cloud/{cloudId}", "https://api.atlassian.com/ex/jira/{cloudId}/forms"] },
  { title: "Migration REST API", version: "v1", openapi: "3.0.1", count: 6, slot: "siteId", label: "Site ID",
    urls: ["https://api.atlassian.com/links/v1/{siteId}"] },
];
const methods = new Set(["get", "put", "post", "patch", "delete", "options", "head", "trace"]);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function requireContract(valid: unknown): asserts valid {
  if (!valid) throw new Error("Atlassian tenant servers require the reviewed source contract.");
}

/** Check the account identity before URL parsing can conceal path traversal. */
export function validateAtlassianTenantServer(server: Record<string, unknown>): void {
  if (server["x-operations-tenant-server"] === undefined) return;
  const contract = contracts.find(contract => contract.urls.includes(String(server.url)));
  requireContract(server["x-operations-tenant-server"] === profile && contract
    && object(server.variables) && object(server.variables[contract.slot]));
  const value = server.variables[contract.slot].default;
  if (value === `<${contract.slot}>` || value === "")
    throw new ServerConfigurationRequiredError(`Configure the ${contract.label} for this Atlassian schema before running this operation.`);
  if (typeof value !== "string" || value === contract.slot || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value))
    throw new Error(`The Atlassian ${contract.label} must be an explicit site identifier using letters, digits or hyphens.`);
}

/** Supply declarations for the four documented templates; retain all native routes,
 * authentication, operation IDs and original server declarations. */
export function bindAtlassianTenantServers(document: Record<string, any>): void {
  const contract = contracts.find(contract => document.info?.title === contract.title);
  requireContract(contract && document.info?.version === contract.version && document.openapi === contract.openapi
    && JSON.stringify(document.servers) === JSON.stringify(contract.urls.map(url => ({ url })))
    && document["x-upstream-servers"] === undefined && object(document.paths));
  let count = 0;
  for (const [path, item] of Object.entries(document.paths)) {
    requireContract(object(item) && item.servers === undefined);
    for (const [method, operation] of Object.entries(item)) if (methods.has(method)) {
      requireContract(object(operation) && operation.operationId === `${method.toUpperCase()} ${path}` && operation.servers === undefined);
      count++;
    }
  }
  requireContract(count === contract.count);
  document["x-upstream-servers"] = structuredClone(document.servers);
  for (const server of document.servers) {
    server["x-operations-tenant-server"] = profile;
    server.variables = { [contract.slot]: { default: `<${contract.slot}>`,
      description: `Configure the ${contract.label} of the selected Atlassian site before running operations.` } };
  }
}
