// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
export const atlassianDcAuthenticationSources: Record<string, string> = {
  bamboo: "a5f54819ac94622e3855a4a809404b538858fd98ac51690e25960643634a2b4e",
  "jira-dc": "81605e461c6c30fda0a24b169a2650a69544f1d7391b8372b211008bf312a435",
  "jira-service-management-dc": "27d6db98596167a55360de4566f865ed091c5c83b030663cc8c9300cbf763a07",
};
const contracts: Record<string, { version: string; server: string; operations: number; scoped: number; scopes: string[] }> = {
  Bamboo: { version: "12.1.12", server: "http://{baseurl}/rest/", operations: 404, scoped: 232, scopes: ["READ", "WRITE", "TRIGGER"] },
  "Jira Software Data Center REST API Reference": { version: "11.3.12", server: "http://{baseurl}/rest", operations: 437, scoped: 241, scopes: ["READ", "WRITE"] },
  "JIRA Service Management REST API Reference": { version: "11.3.12", server: "http://{baseurl}/rest", operations: 514, scoped: 241, scopes: ["READ", "WRITE"] },
};
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
function requireContract(condition: unknown): asserts condition {
  if (!condition) throw new Error("Atlassian Data Center authentication does not match the reviewed source contract.");
}

/** These upstream exports reference OAuth2 but omit its definition. Existing
 * access tokens use Bearer; keep scope requirements as private approval metadata.
 * https://confluence.atlassian.com/adminjiraserver107/jira-oauth-2-0-provider-api-1595114348.html
 * https://support.atlassian.com/bamboo/kb/create-and-manage-service-accounts-in-bamboo-data-center/
 */
export function bindAtlassianDcAuthentication(document: Record<string, any>): void {
  const contract = contracts[document.info?.title], schemes = document.components?.securitySchemes;
  requireContract(contract && document.openapi === "3.0.1" && document.info.version === contract.version
    && document.servers?.length === 1 && document.servers[0].url === contract.server
    && document.security === undefined && object(document.paths) && object(schemes)
    && Object.keys(schemes).length === 1 && schemes.basic?.type === "http" && schemes.basic.scheme === "basic"
    && !Object.hasOwn(document, "x-upstream-security-schemes"));
  const plans: { operation: Record<string, any>; security: Record<string, string[]>[]; permissions: Record<string, string[]>[] }[] = [];
  let count = 0;
  for (const item of Object.values(document.paths)) {
    requireContract(object(item));
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      count++; requireContract(object(operation));
      if (operation.security === undefined) continue;
      requireContract(Array.isArray(operation.security));
      let scoped = false;
      const permissions: Record<string, string[]>[] = [];
      const security = operation.security.map((requirement: unknown): Record<string, string[]> => {
        requireContract(object(requirement) && Object.keys(requirement).length === 1);
        if (Object.hasOwn(requirement, "basic")) {
          requireContract(Array.isArray(requirement.basic) && requirement.basic.length === 0);
          permissions.push({}); return { basic: [] };
        }
        const scopes = requirement.OAuth2;
        requireContract(Array.isArray(scopes) && scopes.length === 1 && contract.scopes.includes(scopes[0]));
        scoped = true; permissions.push({ OAuth2: [...scopes] }); return { OAuth2: [] };
      });
      if (!scoped) continue;
      requireContract(!Object.hasOwn(operation, "x-upstream-security") && !Object.hasOwn(operation, "x-credential-permissions"));
      plans.push({ operation, security, permissions });
    }
  }
  requireContract(count === contract.operations && plans.length === contract.scoped);
  document["x-upstream-security-schemes"] = structuredClone(schemes);
  schemes.OAuth2 = { type: "http", scheme: "bearer", description: "An existing OAuth 2.0 access token for this Data Center instance. Required scopes are retained on each operation. Configure the HTTPS instance and authorize credentials before execution." };
  for (const { operation, security, permissions } of plans) {
    operation["x-upstream-security"] = operation.security;
    operation.security = security;
    operation["x-credential-permissions"] = permissions;
  }
}
