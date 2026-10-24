// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { adaptGithubAuthentication } from "./github-authentication.ts";

/** Reviewed, versioned data corrections. These never execute code from a schema. */
export type SchemaPatch = { id: "google-oauth-alternatives" | "digitalocean-bearer-permissions" | "gemini-auth-alternatives" | "azure-eventgrid-management-auth" | "anthropic-authentication" | "elevenlabs-authentication" | "github-authentication"; version: 1 };
export const googleOauthAlternatives: SchemaPatch = { id: "google-oauth-alternatives", version: 1 };
export const digitalOceanBearerPermissions: SchemaPatch = { id: "digitalocean-bearer-permissions", version: 1 };
export const geminiAuthAlternatives: SchemaPatch = { id: "gemini-auth-alternatives", version: 1 };
export const azureEventGridManagementAuth: SchemaPatch = { id: "azure-eventgrid-management-auth", version: 1 };
export const anthropicAuthentication: SchemaPatch = { id: "anthropic-authentication", version: 1 };
export const elevenLabsAuthentication: SchemaPatch = { id: "elevenlabs-authentication", version: 1 };
export const githubAuthentication: SchemaPatch = { id: "github-authentication", version: 1 };
export function schemaPatchName(patch: SchemaPatch): string {
  return patch.id === "google-oauth-alternatives" ? "Google OAuth alternatives"
    : patch.id === "digitalocean-bearer-permissions" ? "DigitalOcean bearer permissions"
    : patch.id === "gemini-auth-alternatives" ? "Gemini authentication alternatives"
    : patch.id === "azure-eventgrid-management-auth" ? "Azure Event Grid management authentication"
    : patch.id === "anthropic-authentication" ? "Anthropic authentication and version headers"
    : patch.id === "elevenlabs-authentication" ? "ElevenLabs authentication and credential results"
    : patch.id === "github-authentication" ? "GitHub operation authentication" : "Unknown schema correction";
}

const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
const object = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const scopes = (value: unknown): value is string[] => Array.isArray(value) && value.every(scope => typeof scope === "string");
const sameScopes = (left: unknown, right: unknown) => scopes(left) && scopes(right)
  && JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());

function googleAlternatives(document: Record<string, any>): void {
  const schemes = document.components?.securitySchemes;
  const implicit = schemes?.Oauth2?.flows?.implicit;
  const code = schemes?.Oauth2c?.flows?.authorizationCode;
  function adapt(target: Record<string, any>) {
    if (!Array.isArray(target?.security)) return;
    let changed = false;
    const security = target.security.flatMap((requirement: unknown) => {
      if (!object(requirement) || !Object.hasOwn(requirement, "Oauth2") || !Object.hasOwn(requirement, "Oauth2c")) return [requirement];
      if (schemes?.Oauth2?.type !== "oauth2" || schemes?.Oauth2c?.type !== "oauth2"
        || !implicit || !code || implicit.authorizationUrl !== "https://accounts.google.com/o/oauth2/auth"
        || code.authorizationUrl !== implicit.authorizationUrl || code.tokenUrl !== "https://accounts.google.com/o/oauth2/token"
        || !object(implicit.scopes) || !object(code.scopes)
        || !sameScopes(Object.keys(implicit.scopes), Object.keys(code.scopes))
        || !sameScopes(requirement.Oauth2, requirement.Oauth2c)
        || requirement.Oauth2c.some((scope: string) => !Object.hasOwn(code.scopes, scope)))
        throw new Error("Google OAuth adaptation requires matching Google grant flows and identical declared scopes.");
      const { Oauth2, Oauth2c, ...otherCredentials } = requirement;
      changed = true;
      // OpenAPI OR is the security array; keys within each entry remain AND.
      return [{ ...otherCredentials, Oauth2 }, { ...otherCredentials, Oauth2c }];
    });
    if (!changed) return;
    if (Object.hasOwn(target, "x-upstream-security")) throw new Error("Google OAuth adaptation cannot overwrite upstream security provenance.");
    target["x-upstream-security"] = target.security;
    target.security = security;
  }
  adapt(document);
  for (const item of Object.values(document.paths ?? {}))
    if (object(item)) for (const [method, operation] of Object.entries(item))
      if (methods.has(method) && object(operation)) adapt(operation);
}

/** DigitalOcean documents token permissions in non-OAuth security arrays. Keep
 * them as approval metadata while restoring OpenAPI's empty bearer arrays. */
function digitalOceanPermissions(document: Record<string, any>): void {
  function adapt(target: Record<string, any>) {
    if (!Array.isArray(target.security)) return;
    let changed = false;
    const permissions: Record<string, string[]>[] = [];
    const security = target.security.map((requirement: unknown) => {
      if (!object(requirement) || !Object.hasOwn(requirement, "bearer_auth")) {
        permissions.push({});
        return requirement;
      }
      const required = requirement.bearer_auth;
      if (!scopes(required) || required.some(permission => !/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(permission)))
        throw new Error("DigitalOcean bearer adaptation requires resource:action permission strings.");
      if (!required.length) { permissions.push({}); return requirement; }
      const scheme = document.components?.securitySchemes?.bearer_auth;
      if (!/^3\.(0|1)\.\d+$/.test(document.openapi) || scheme?.type !== "http" || scheme.scheme !== "bearer"
        || !Array.isArray(document.servers) || !document.servers.some(server => server?.url === "https://api.digitalocean.com"))
        throw new Error("DigitalOcean bearer adaptation requires the reviewed DigitalOcean server and HTTP bearer scheme.");
      changed = true;
      permissions.push({ bearer_auth: [...required] });
      return { ...requirement, bearer_auth: [] };
    });
    if (!changed) return;
    if (Object.hasOwn(target, "x-upstream-security") || Object.hasOwn(target, "x-credential-permissions"))
      throw new Error("DigitalOcean bearer adaptation cannot overwrite permission metadata or upstream security provenance.");
    target["x-upstream-security"] = target.security;
    target["x-credential-permissions"] = permissions;
    target.security = security;
  }
  adapt(document);
  for (const item of Object.values(document.paths ?? {}))
    if (object(item)) for (const [method, operation] of Object.entries(item))
      if (methods.has(method) && object(operation)) adapt(operation);
}

/** The reviewed Gemini SDK declaration describes two ordinary HTTP transports.
 * Keep the custom definition for inspection; never evaluate SDK extensions. */
function geminiAlternatives(document: Record<string, any>): void {
  const schemes = document.components?.securitySchemes;
  const custom = schemes?.googleGenAIAuth;
  if (custom?.type === "http" && custom.scheme === "bearer"
    || custom?.type === "apiKey" && custom.in === "header" && custom.name === "x-goog-api-key") return;
  let choices: [string, Record<string, string>][] | undefined;
  function reviewedChoices(): [string, Record<string, string>][] {
    const extension = custom?.["x-speakeasy-custom-security-scheme"];
    const shape = extension?.schema;
    const properties = shape?.properties;
    const string = (value: unknown) => object(value) && value.type === "string"
      && Object.keys(value).every(key => ["type", "description"].includes(key));
    if (!/^3\.(0|1)\.\d+$/.test(document.openapi)
      || !Array.isArray(document.servers) || !document.servers.length
      || document.servers.some(server => server?.url !== "https://generativelanguage.googleapis.com")
      || custom?.type !== "http" || custom.scheme !== "custom"
      || !object(extension) || Object.keys(extension).some(key => key !== "schema")
      || !object(shape) || shape.type !== "object" || !object(properties)
      || Object.keys(shape).some(key => !["type", "description", "properties", "required"].includes(key))
      || shape.required !== undefined && (!Array.isArray(shape.required) || shape.required.length > 0)
      || Object.keys(properties).some(key => !["apiKey", "accessToken", "defaultHeaders"].includes(key)))
      throw new Error("Gemini authentication adaptation requires the reviewed endpoint and optional SDK credential contract.");
    const result: [string, Record<string, string>][] = [];
    for (const [property, name, definition] of [
      ["apiKey", "GeminiApiKey", { type: "apiKey", in: "header", name: "x-goog-api-key" }],
      ["accessToken", "GeminiAccessToken", { type: "http", scheme: "bearer" }],
    ] as const) {
      if (!Object.hasOwn(properties, property)) continue;
      if (!string(properties[property])) throw new Error("Gemini authentication adaptation requires plain string credentials.");
      if (Object.hasOwn(schemes, name)) throw new Error("Gemini authentication adaptation cannot overwrite a security scheme.");
      result.push([name, definition]);
    }
    if (!result.length) throw new Error("Gemini authentication adaptation requires a documented API key or access token.");
    return result;
  }
  function adapt(target: Record<string, any>) {
    if (!Array.isArray(target.security)) return;
    let changed = false;
    const security = target.security.flatMap((requirement: unknown) => {
      if (!object(requirement) || !Object.hasOwn(requirement, "googleGenAIAuth")) return [requirement];
      if (!scopes(requirement.googleGenAIAuth) || requirement.googleGenAIAuth.length)
        throw new Error("Gemini authentication adaptation requires an empty SDK security requirement.");
      choices ??= reviewedChoices();
      if (choices.some(([name]) => Object.hasOwn(requirement, name)))
        throw new Error("Gemini authentication adaptation cannot replace another required credential.");
      const { googleGenAIAuth: _custom, ...otherCredentials } = requirement;
      changed = true;
      return choices.map(([name]) => ({ ...otherCredentials, [name]: [] }));
    });
    if (!changed) return;
    if (Object.hasOwn(target, "x-upstream-security") || Object.hasOwn(target, "x-credential-permissions"))
      throw new Error("Gemini authentication adaptation cannot overwrite security provenance or permission metadata.");
    target["x-upstream-security"] = target.security;
    target.security = security;
  }
  adapt(document);
  for (const item of Object.values(document.paths ?? {}))
    if (object(item)) for (const [method, operation] of Object.entries(item))
      if (methods.has(method) && object(operation)) adapt(operation);
  if (choices) Object.assign(schemes, Object.fromEntries(choices));
}

/** The Event Grid management source declares OAuth but omits its requirement.
 * Link the reviewed declaration without inventing an authentication flow. */
function azureEventGridAuthentication(document: Record<string, any>): void {
  if (document.security !== undefined) return;
  const auth = document.components?.securitySchemes?.azure_auth;
  const implicit = auth?.flows?.implicit;
  const managementServer = (servers: unknown) => Array.isArray(servers) && servers.length > 0
    && servers.every(server => object(server) && server.url === "https://management.azure.com");
  if (!/^3\.(0|1)\.\d+$/.test(document.openapi) || document.info?.title !== "EventGridManagementClient"
    || !managementServer(document.servers) || !object(document.paths)
    || auth?.type !== "oauth2" || !object(auth.flows) || Object.keys(auth.flows).length !== 1
    || implicit?.authorizationUrl !== "https://login.microsoftonline.com/common/oauth2/authorize"
    || !object(implicit.scopes) || Object.keys(implicit.scopes).length !== 1
    || typeof implicit.scopes.user_impersonation !== "string" || !implicit.scopes.user_impersonation.trim())
    throw new Error("Azure Event Grid authentication adaptation requires the reviewed management endpoint and Azure OAuth permission.");
  for (const [path, item] of Object.entries(document.paths)) {
    if (!object(item)) continue;
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method) || !object(operation) || operation.security !== undefined) continue;
      if (!/\/providers\/Microsoft\.EventGrid(?:\/|$)/.test(path)
        || !managementServer(operation.servers ?? item.servers ?? document.servers))
        throw new Error("Azure Event Grid authentication adaptation cannot authenticate an unreviewed inherited route.");
    }
  }
  if (Object.hasOwn(document, "x-upstream-security") || Object.hasOwn(document, "x-credential-permissions"))
    throw new Error("Azure Event Grid authentication adaptation cannot overwrite security provenance or permission metadata.");
  document["x-upstream-security"] = null; // Absence is distinct from an explicit anonymous security array.
  document.security = [{ azure_auth: ["user_impersonation"] }];
}

/** The pinned SDK pack omits its shared authentication and makes the version
 * optional. Keep source parameters for inspection and existing vault edges. */
function anthropicAuth(document: Record<string, any>): void {
  if (document.security !== undefined) return;
  const server = (servers: unknown) => Array.isArray(servers) && servers.length > 0
    && servers.every(item => object(item) && item.url === "https://api.anthropic.com");
  if (document.openapi !== "3.1.0" || document.info?.title !== "Anthropic API" || document.info.version !== "sdk-v0.120.0"
    || !server(document.servers) || !object(document.paths) || !object(document.components))
    throw new Error("Anthropic authentication adaptation requires the reviewed SDK revision and direct API endpoint.");
  const schemes = document.components.securitySchemes ?? {};
  if (!object(schemes) || Object.hasOwn(schemes, "AnthropicApiKey") || Object.hasOwn(schemes, "AnthropicBearer")
    || Object.hasOwn(document, "x-upstream-security") || Object.hasOwn(document, "x-credential-permissions"))
    throw new Error("Anthropic authentication adaptation cannot overwrite security definitions or provenance.");
  const families = new Set(["messages", "complete", "models", "files", "skills", "environments", "memory_stores",
    "user_profiles", "tunnels", "dreams", "sessions", "agents", "deployments", "deployment_runs", "vaults"]);
  for (const [path, item] of Object.entries(document.paths)) {
    if (!object(item)) throw new Error("Anthropic authentication adaptation requires reviewed HTTP path items.");
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method) || !object(operation) || operation.security !== undefined) continue;
      if (!families.has(path.split("/")[2]?.split("?")[0] ?? "") || !path.startsWith("/v1/")
        || !server(operation.servers ?? item.servers ?? document.servers)
        || Object.hasOwn(operation, "x-upstream-parameters") || !Array.isArray(operation.parameters))
        throw new Error("Anthropic authentication adaptation cannot authenticate an unreviewed inherited route.");
      const versions = operation.parameters.filter((parameter: any) => parameter?.in === "header" && parameter.name?.toLowerCase() === "anthropic-version");
      if (versions.length !== 1 || versions[0].schema?.type !== "string"
        || operation.parameters.some((parameter: any) => parameter?.in === "header" && parameter.name?.toLowerCase() === "anthropic-workspace-id"))
        throw new Error("Anthropic authentication adaptation requires the reviewed version and workspace header contract.");
      operation["x-upstream-parameters"] = structuredClone(operation.parameters);
      operation.parameters = operation.parameters.map((parameter: any) => parameter === versions[0] ? { ...parameter, required: true } : parameter);
      operation.parameters.push({ name: "anthropic-workspace-id", in: "header", required: false, schema: { type: "string" },
        description: "Required for an API key that is not scoped to a workspace. Omit for a workspace-scoped key; access tokens select their workspace at exchange." });
    }
  }
  document.components.securitySchemes = { ...schemes, AnthropicApiKey: { type: "apiKey", in: "header", name: "x-api-key" },
    AnthropicBearer: { type: "http", scheme: "bearer" } };
  document["x-upstream-security"] = null;
  document.security = [{ AnthropicApiKey: [] }, { AnthropicBearer: [] }];
}

function elevenLabsAuth(document: Record<string, any>): void {
  const server = (servers: unknown) => Array.isArray(servers) && servers.length > 0
    && servers.every(item => object(item) && item.url === "https://api.elevenlabs.io");
  if (document.openapi !== "3.1.0" || document.info?.title !== "ElevenLabs API Documentation" || document.info.version !== "1.0"
    || !server(document.servers) || !object(document.paths) || !object(document.components))
    throw new Error("ElevenLabs authentication adaptation requires the reviewed direct API contract.");
  const addSecurity = document.security === undefined, schemes = document.components.securitySchemes ?? {};
  if (addSecurity && (!object(schemes) || Object.hasOwn(schemes, "ElevenLabsApiKey")
    || Object.hasOwn(document, "x-upstream-security") || Object.hasOwn(document, "x-credential-permissions")))
    throw new Error("ElevenLabs authentication adaptation cannot overwrite security definitions or provenance.");
  const publicRoutes = new Set(["get /v1/voices/settings/default", "post /v1/convai/conversations/{conversation_id}/feedback",
    "post /v1/convai/llm-usage/calculate", "get /docs"]);
  const optionalRoutes = new Set(["get /v1/models", "get /v1/shared-voices", "get /v1/voices/{voice_id}",
    "get /v1/voices/{voice_id}/settings", "get /v1/convai/agents/{agent_id}/widget",
    "get /v1/productions/orders/{order_id}/media/{media_id}"]);
  function resolve(shape: unknown): Record<string, any> {
    let value = shape;
    const seen = new Set<string>();
    while (object(value) && typeof value.$ref === "string") {
      const ref = value.$ref;
      if (!ref.startsWith("#/") || seen.has(ref) || seen.size >= 16)
        throw new Error("ElevenLabs authentication adaptation requires bounded local response references.");
      seen.add(ref); value = document;
      for (const encoded of ref.slice(2).split("/")) {
        const key = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
        value = object(value) && Object.hasOwn(value, key) ? value[key] : undefined;
      }
      if (!object(value)) throw new Error("ElevenLabs authentication adaptation cannot resolve a credential result schema.");
    }
    return object(value) ? value : {};
  }
  for (const [path, item] of Object.entries(document.paths)) {
    if (!object(item)) throw new Error("ElevenLabs authentication adaptation requires HTTP path items.");
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method) || !object(operation)) continue;
      if (!server(operation.servers ?? item.servers ?? document.servers))
        throw new Error("ElevenLabs authentication adaptation cannot authenticate another destination.");
      if (addSecurity && operation.security === undefined) {
        const route = `${method} ${path}`;
        if (Object.hasOwn(operation, "x-upstream-security")) throw new Error("ElevenLabs authentication adaptation cannot overwrite route provenance.");
        if (publicRoutes.has(route) || optionalRoutes.has(route)) {
          operation["x-upstream-security"] = null;
          operation.security = publicRoutes.has(route) ? [] : [{}, { ElevenLabsApiKey: [] }];
        } else {
          const keys = (Array.isArray(operation.parameters) ? operation.parameters : []).filter((parameter: any) => parameter?.in === "header" && parameter.name === "xi-api-key");
          const shape = keys[0]?.schema;
          if (!/^\/v[123]\//.test(path) || keys.length !== 1 || !object(shape)
            || !(shape.type === "string" || Array.isArray(shape.anyOf) && shape.anyOf.length === 2
              && shape.anyOf.some((item: any) => item?.type === "string") && shape.anyOf.some((item: any) => item?.type === "null")))
            throw new Error("ElevenLabs authentication adaptation requires a reviewed private API-key header or explicit public route.");
        }
      }
      if (operation["x-operations-credential-result"] !== undefined && operation["x-operations-credential-result"] !== true)
        throw new Error("ElevenLabs authentication adaptation cannot overwrite credential-result metadata.");
      const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];
      const nullableKeys = parameters.filter((parameter: any) => parameter?.in === "header" && parameter.name === "xi-api-key" && parameter.schema?.anyOf !== undefined);
      if (nullableKeys.length) {
        if (Object.hasOwn(operation, "x-upstream-parameters") || nullableKeys.some((parameter: any) => !Array.isArray(parameter.schema.anyOf)
          || parameter.schema.anyOf.length !== 2 || parameter.schema.anyOf.some((branch: any) => !object(branch) || Object.keys(branch).length !== 1)
          || !parameter.schema.anyOf.some((branch: any) => branch.type === "string") || !parameter.schema.anyOf.some((branch: any) => branch.type === "null")))
          throw new Error("ElevenLabs authentication adaptation requires the reviewed nullable key and parameter provenance.");
        operation["x-upstream-parameters"] = structuredClone(parameters);
        operation.parameters = parameters.map((parameter: any) => {
          if (!nullableKeys.includes(parameter)) return parameter;
          const { anyOf: _union, ...shape } = parameter.schema;
          return { ...parameter, schema: { ...shape, type: "string", nullable: true } };
        });
      }
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!/^2\d\d$/.test(status)) continue;
        for (const media of Object.values(resolve(response).content ?? {})) {
          const fields = resolve(object(media) ? media.schema : undefined).properties ?? {};
          if (["token", "signed_url", "xi-api-key", "webhook_secret"].some(key => Object.hasOwn(fields, key)))
            operation["x-operations-credential-result"] = true;
        }
      }
    }
  }
  if (addSecurity) {
    document.components.securitySchemes = { ...schemes, ElevenLabsApiKey: { type: "apiKey", in: "header", name: "xi-api-key" } };
    document["x-upstream-security"] = null;
    document.security = [{ ElevenLabsApiKey: [] }];
  }
}

/** Preserve the published document. Reapplying a resolved correction is a no-op. */
export function applySchemaPatches(input: Record<string, unknown>, patches: readonly SchemaPatch[] = []): Record<string, unknown> {
  if (!patches.length) return input;
  const document = structuredClone(input);
  const seen = new Set<string>();
  for (const patch of patches) {
    if (!["google-oauth-alternatives", "digitalocean-bearer-permissions", "gemini-auth-alternatives", "azure-eventgrid-management-auth", "anthropic-authentication", "elevenlabs-authentication", "github-authentication"].includes(patch?.id) || patch.version !== 1 || seen.has(patch.id))
      throw new Error("The reviewed schema correction is unknown or duplicated.");
    seen.add(patch.id);
    if (patch.id === "google-oauth-alternatives") googleAlternatives(document);
    else if (patch.id === "digitalocean-bearer-permissions") digitalOceanPermissions(document);
    else if (patch.id === "gemini-auth-alternatives") geminiAlternatives(document);
    else if (patch.id === "azure-eventgrid-management-auth") azureEventGridAuthentication(document);
    else if (patch.id === "anthropic-authentication") anthropicAuth(document);
    else if (patch.id === "elevenlabs-authentication") elevenLabsAuth(document);
    else adaptGithubAuthentication(document);
  }
  return document;
}
