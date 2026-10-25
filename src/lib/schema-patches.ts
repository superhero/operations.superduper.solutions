// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { awsWireContracts } from "./aws-wire.ts";
import { awsSigningRegions } from "./aws-signing.ts";
export { awsWireSources } from "./aws-wire.ts";
import { cloudflareOrigin, cloudflareUploadContracts } from "./cloudflare-upload.ts";
import { adaptGithubAuthentication } from "./github-authentication.ts";
import { telegramBotTemplate } from "./server-url.ts";
import { bindProviderPaths } from "./provider-path-bindings.ts";
import { bindAtlassianServers } from "./atlassian-server-bindings.ts";
import { configureS3Files, s3SigningProfile } from "./s3-files.ts";
import type { Operation } from "./catalog.ts";
export { s3SourceSha256 } from "./s3-files.ts";

/** Reviewed, versioned data corrections. These never execute code from a schema. */
export type SchemaPatch = { id: "google-oauth-alternatives" | "digitalocean-bearer-permissions" | "gemini-auth-alternatives" | "azure-eventgrid-management-auth" | "anthropic-authentication" | "elevenlabs-authentication" | "github-authentication" | "http-response-streaming" | "telegram-private-path" | "x-oauth1-signing" | "cloudflare-private-upload" | "provider-path-bindings" | "atlassian-server-bindings" | "aws-s3-files" | "aws-wire-protocols" | "bigquery-job-metadata" | "google-storage-media"; version: 1 };
export const bigqueryJobMetadata: SchemaPatch = { id: "bigquery-job-metadata", version: 1 };
export const bigqueryJobSourceSha256 = "84a35e70565d01face776e9dddecb1fc1ffda5bdf60e15fe41b96728c71b2b44";
export const googleStorageMedia: SchemaPatch = { id: "google-storage-media", version: 1 };
export const googleStorageMediaSourceSha256 = "89fce203814a45b34a3f61504d99453530579866c55554b400e0d52dc8d42d8e";
export const atlassianServerBindings: SchemaPatch = { id: "atlassian-server-bindings", version: 1 };
export const providerPathBindings: SchemaPatch = { id: "provider-path-bindings", version: 1 };
export const awsWireProtocols: SchemaPatch = { id: "aws-wire-protocols", version: 1 };
export const awsS3Files: SchemaPatch = { id: "aws-s3-files", version: 1 };
export const googleOauthAlternatives: SchemaPatch = { id: "google-oauth-alternatives", version: 1 };
export const digitalOceanBearerPermissions: SchemaPatch = { id: "digitalocean-bearer-permissions", version: 1 };
export const geminiAuthAlternatives: SchemaPatch = { id: "gemini-auth-alternatives", version: 1 };
export const azureEventGridManagementAuth: SchemaPatch = { id: "azure-eventgrid-management-auth", version: 1 };
export const anthropicAuthentication: SchemaPatch = { id: "anthropic-authentication", version: 1 };
export const elevenLabsAuthentication: SchemaPatch = { id: "elevenlabs-authentication", version: 1 };
export const githubAuthentication: SchemaPatch = { id: "github-authentication", version: 1 };
export const httpResponseStreaming: SchemaPatch = { id: "http-response-streaming", version: 1 };
export const cloudflarePrivateUpload: SchemaPatch = { id: "cloudflare-private-upload", version: 1 };
export const cloudflarePrivateUploadSourceSha256 = "5999fa69349d2e160e58bac0f9603f110c2937d67dbf6dac3a1bed9f3859c778";
export const xOauth1Signing: SchemaPatch = { id: "x-oauth1-signing", version: 1 };
export const xOauth1SourceSha256 = "e21fbef8a11e6c2a8dfcbbe2390fc10c73dc79671b3b5f51de787d4be106a9c6";
export const telegramPrivatePath: SchemaPatch = { id: "telegram-private-path", version: 1 };
export const telegramPrivatePathSourceSha256 = "f5234e87e6880f87fbba5bd594d80d2d235bac2d9388a47b00b109bc5fe0e6cc";
export const httpResponseStreamingSources: Record<string, string> = {
  openai: "b7ec5bd5e29c40f0bfa2e53c06ece711a40276653646d9f3db77498d6579ab41",
  ollama: "16f3b75a4944e1fb0e5b68fedc30b5974406dc2ac125d07cb33dde6981e2f99b",
};
export function schemaPatchName(patch: SchemaPatch): string {
  return patch.id === "bigquery-job-metadata" ? "BigQuery JSON job metadata"
    : patch.id === "google-storage-media" ? "Google Storage media upload"
    : patch.id === "google-oauth-alternatives" ? "Google OAuth alternatives"
    : patch.id === "digitalocean-bearer-permissions" ? "DigitalOcean bearer permissions"
    : patch.id === "gemini-auth-alternatives" ? "Gemini authentication alternatives"
    : patch.id === "azure-eventgrid-management-auth" ? "Azure Event Grid management authentication"
    : patch.id === "anthropic-authentication" ? "Anthropic authentication and version headers"
    : patch.id === "elevenlabs-authentication" ? "ElevenLabs authentication and credential results"
    : patch.id === "github-authentication" ? "GitHub operation authentication"
    : patch.id === "http-response-streaming" ? "Bounded HTTP response streaming"
    : patch.id === "telegram-private-path" ? "Telegram private bot token path" : patch.id === "x-oauth1-signing" ? "X OAuth 1.0a signing" : patch.id === "cloudflare-private-upload" ? "Cloudflare private upload sessions" : patch.id === "provider-path-bindings" ? "Qualified provider path bindings" : patch.id === "atlassian-server-bindings" ? "Atlassian server identities" : patch.id === "aws-s3-files" ? "S3 signed object files" : patch.id === "aws-wire-protocols" ? "AWS target JSON and Action/Version wire protocols" : "Unknown schema correction";
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

function bigqueryMetadata(document: Record<string, any>): void {
  const item = document.paths?.["/projects/{projectId}/jobs"], operation = item?.post;
  if (document.openapi !== "3.0.0" || document.info?.title !== "BigQuery API" || document.info.version !== "v2"
    || document.servers?.length !== 1 || document.servers[0]?.url !== "https://bigquery.googleapis.com/bigquery/v2"
    || !object(item) || item.servers !== undefined || !object(operation) || operation.operationId !== "bigquery.jobs.insert" || operation.servers !== undefined)
    throw new Error("BigQuery job metadata requires the reviewed native method and destination.");
  const body = operation.requestBody, content = body?.content;
  const media = content?.["application/octet-stream"] ?? content?.["application/json"];
  if (!object(body) || !object(content) || Object.keys(content).length !== 1 || !object(media)
    || JSON.stringify(media.schema) !== '{"$ref":"#/components/schemas/Job"}' || document.components?.schemas?.Job?.type !== "object"
    || operation.responses?.["200"]?.content?.["application/json"]?.schema?.$ref !== "#/components/schemas/Job")
    throw new Error("BigQuery job metadata requires the reviewed Job request and result contract.");
  if (content["application/json"]) return;
  if (Object.hasOwn(operation, "x-upstream-request-body")) throw new Error("BigQuery job metadata cannot overwrite request provenance.");
  operation["x-upstream-request-body"] = structuredClone(body);
  operation.requestBody = { ...body, content: { "application/json": media } };
}

function storageMedia(document: Record<string, any>): void {
  const item = document.paths?.["/b/{bucket}/o"], operation = item?.post;
  if (document.openapi !== "3.0.0" || document.info?.title !== "Cloud Storage JSON API" || document.info.version !== "v1"
    || document.servers?.length !== 1 || document.servers[0]?.url !== "https://storage.googleapis.com/storage/v1"
    || !object(item) || item.servers !== undefined || !object(operation) || operation.operationId !== "storage.objects.insert" || operation.servers !== undefined)
    throw new Error("Google Storage media requires the reviewed native method and destination.");
  const body = operation.requestBody, parameters = operation.parameters;
  const content = body?.content;
  if (!object(body) || !object(content) || Object.keys(content).length !== 1
    || JSON.stringify(content["application/octet-stream"]?.schema) !== '{"$ref":"#/components/schemas/Object"}'
    || document.components?.schemas?.Object?.type !== "object"
    || operation.responses?.["200"]?.content?.["application/json"]?.schema?.$ref !== "#/components/schemas/Object")
    throw new Error("Google Storage media requires the reviewed Object request and result contract.");
  if (!Array.isArray(parameters) || parameters.length !== 11 || parameters.some(parameter => !object(parameter))
    || parameters.filter(parameter => parameter.name === "bucket" && parameter.in === "path" && parameter.required === true && parameter.schema?.type === "string").length !== 1
    || parameters.filter(parameter => parameter.name === "name" && parameter.in === "query" && parameter.schema?.type === "string").length !== 1
    || parameters.some(parameter => parameter.name === "uploadType") || Object.hasOwn(operation, "x-upstream-google-storage-contract"))
    throw new Error("Google Storage media requires unambiguous native parameters and unused provenance.");
  operation["x-upstream-google-storage-contract"] = { requestBody: structuredClone(body), parameters: structuredClone(parameters), description: operation.description };
  operation.servers = [{ url: "https://storage.googleapis.com/upload/storage/v1" }];
  operation.description = "Upload object data only (up to 500 kB). Object name is required. Custom metadata, multipart and resumable uploads are not supported.";
  operation.parameters = parameters.map(parameter => parameter.in === "query" && parameter.name === "name"
    ? { ...parameter, required: true, schema: { ...parameter.schema, minLength: 1 } } : parameter);
  operation.parameters.push({ name: "uploadType", in: "query", required: true,
    schema: { type: "string", enum: ["media"], default: "media" }, description: "Media-only upload; metadata and resumable sessions are separate contracts." });
  operation.requestBody = { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary", maxLength: 500000 } } } };
}

function responseStreaming(document: Record<string, any>): void {
  const openai = document.info?.version === "2.3.0" && document.servers?.[0]?.url === "https://api.openai.com/v1";
  const ollama = document.info?.version === "0.1.0" && document.servers?.[0]?.url === "http://localhost:11434";
  if (document.openapi !== "3.1.0" || !(openai || ollama) || document.servers.length !== 1 || !object(document.paths))
    throw new Error("HTTP streaming adaptation requires the reviewed OpenAI or Ollama native endpoint.");
  const selected = openai ? [["/responses", "createResponse", "openai-responses", "text/event-stream"]]
    : [["/api/chat", "chat", "ollama-chat", "application/x-ndjson"], ["/api/generate", "generate", "ollama-generate", "application/x-ndjson"]];
  for (const [path, id, profile, media] of selected) {
    const item = document.paths[path!], operation = item?.post, content = operation?.responses?.["200"]?.content;
    if (!object(operation) || operation.operationId !== id || operation.servers !== undefined || item.servers !== undefined
      || !object(content?.[media!]) || !object(content?.["application/json"])
      || operation["x-operations-response-stream"] !== undefined && operation["x-operations-response-stream"] !== profile)
      throw new Error("HTTP streaming adaptation cannot replace an unreviewed operation or response contract.");
    operation["x-operations-response-stream"] = profile;
  }
}

/** Preserve the published document. Reapplying a resolved correction is a no-op. */
function telegramPath(document: Record<string, any>): void {
  if (document.openapi !== "3.0.3" || document.info?.version !== "10.1" || document.servers?.length !== 1
    || document.servers[0]?.url !== telegramBotTemplate || document.servers[0]?.variables?.botToken?.default !== "<bot_token>"
    || document.security !== undefined || !object(document.paths)) throw new Error("Telegram private paths require the reviewed native endpoint and version.");
  for (const [path, item] of Object.entries(document.paths) as [string, Record<string, any>][]) {
    if (!/^\/[A-Za-z][A-Za-z0-9]{0,127}$/.test(path) || item.servers !== undefined) throw new Error("Telegram private paths require a reviewed Bot API method.");
    for (const [method, operation] of Object.entries(item) as [string, Record<string, any>][]) {
      if (!methods.has(method)) continue;
      if (method !== "post" || operation.operationId !== path.slice(1) || operation.security !== undefined || operation.servers !== undefined
        || operation["x-operations-private-path"] !== undefined && operation["x-operations-private-path"] !== "telegram-bot")
        throw new Error("Telegram private paths cannot replace an unreviewed method or authentication declaration.");
      operation["x-operations-private-path"] = "telegram-bot";
    }
  }
}

function xOauth1(document: Record<string, any>): void {
  const definition = document.components?.securitySchemes?.UserToken;
  if (document.openapi !== "3.0.0" || document.info?.version !== "2.159" || document.servers?.length !== 1
    || document.servers[0]?.url !== "https://api.x.com" || document.security !== undefined
    || !object(definition) || definition.type !== "http" || definition.scheme !== "OAuth"
    || Object.keys(definition).some(key => !["type", "scheme", "x-operations-oauth1"].includes(key))
    || definition["x-operations-oauth1"] !== undefined && definition["x-operations-oauth1"] !== "x-hmac-sha1")
    throw new Error("X OAuth1 signing requires the reviewed native source and authentication declaration.");
  for (const [path, item] of Object.entries(document.paths) as [string, Record<string, any>][]) {
    if (item.servers !== undefined) throw new Error("X OAuth1 signing cannot replace an unreviewed destination.");
    for (const [method, operation] of Object.entries(item) as [string, Record<string, any>][]) {
      if (methods.has(method) && operation.security?.some((option: Record<string, unknown>) => Object.hasOwn(option, "UserToken"))
        && (!path.startsWith("/2/") || operation.servers !== undefined))
        throw new Error("X OAuth1 signing requires a reviewed API v2 destination.");
    }
  }
  definition["x-operations-oauth1"] = "x-hmac-sha1";
}

function cloudflareUploads(document: Record<string, any>): void {
  if (document.openapi !== "3.0.3" || document.info?.version !== "4.0.0" || document.servers?.length !== 1
    || document.servers[0]?.url !== cloudflareOrigin) throw new Error("Cloudflare uploads require the reviewed native version and endpoint.");
  const schemes = document.components?.securitySchemes;
  if (!object(schemes)) throw new Error("Cloudflare uploads require the native security definitions.");
  for (const [name, kind] of [["assets_jwt", "workers"], ["pages_upload_token", "pages"]]) {
    const definition = { type: "http", scheme: "bearer", "x-operations-cloudflare-upload-token": kind };
    if (schemes[name!] !== undefined && JSON.stringify(schemes[name!]) !== JSON.stringify(definition)) throw new Error("Cloudflare upload credentials cannot replace an unreviewed declaration.");
    schemes[name!] = definition;
  }
  for (const [profile, [method, path]] of Object.entries(cloudflareUploadContracts)) {
    const item = document.paths?.[path], operation = item?.[method.toLowerCase()];
    if (!object(operation) || item.servers !== undefined || operation.servers !== undefined
      || operation["x-operations-cloudflare-upload"] !== undefined && operation["x-operations-cloudflare-upload"] !== profile)
      throw new Error("Cloudflare uploads require the reviewed native method and destination.");
    operation["x-operations-cloudflare-upload"] = profile;
    // The public operation describes the projected result, never the token-bearing wire body.
    for (const [status, response] of Object.entries(operation.responses ?? {}) as [string, any][]) {
      if (!/^2[0-9][0-9]$/.test(status)) continue;
      operation.responses[status] = { description: response.description ?? "Private upload result", content: { "application/json": { schema: {
        type: "object", properties: { success: { type: "boolean" }, result: { type: "object", properties: {
          session: { type: "string", description: "Opaque private upload reference; connect it to Private upload session or metadata.assets.jwt." },
          expiresAt: { type: "integer" }, phase: { type: "string" }, buckets: { type: "array", items: { type: "array", items: { type: "string" } } },
          missing: { type: "array", items: { type: "string" } }, completed: { type: "boolean" }, id: { type: "string" },
        } } },
      } } } };
    }
  }
}

function s3Files(document: Record<string, any>): void {
  const definition = document.components?.securitySchemes?.hmac;
  if (document.openapi !== "3.0.0" || document.info?.version !== "2006-03-01" || definition?.type !== "apiKey"
    || definition.in !== "header" || definition.name !== "Authorization" || definition["x-amazon-apigateway-authtype"] !== "awsS3"
    || JSON.stringify(document.security) !== '[{"hmac":[]}]' || !Array.isArray(document.servers) || !document.servers.length
    || document.servers.some(server => typeof server?.url !== "string" || !/^https?:\/\/s3(?:\{dash-or-dot\}\{region\}|\.\{region\})?\.amazonaws\.com(?:\.cn)?$/.test(server.url)))
    throw new Error("S3 files require the reviewed native version, signing declaration and regional server templates.");
  const item = document.paths?.["/{Bucket}/{Key}"];
  if (!object(item) || item.servers !== undefined) throw new Error("S3 files require the reviewed object path.");
  for (const [method, profile, identity] of [["get", "get-object", "GetObject"], ["put", "put-object", "PutObject"]] as const) {
    const source = item[method];
    if (!object(source) || source.operationId !== identity || source.servers !== undefined || source.security !== undefined
      || source["x-operations-s3-files"] !== undefined || source["x-upstream-s3-object-contract"] !== undefined
      || !source.responses?.["200"]?.content?.["text/xml"]
      || method === "put" && !source.requestBody?.content?.["text/xml"]?.schema?.properties?.Body)
      throw new Error("S3 files cannot replace an unreviewed object contract or destination.");
    source["x-upstream-s3-object-contract"] = { parameters: source.parameters ?? [], requestBody: source.requestBody ?? null, responses: source.responses };
    source["x-operations-s3-files"] = profile; source["x-operations-aws-signing"] = s3SigningProfile;
    const model: Operation = { id: identity, name: identity, description: "", group: "S3", method: method.toUpperCase(), path: "/{Bucket}/{Key}", fields: [], bodyRequired: false };
    configureS3Files(model, profile);
    source.parameters = model.fields.filter(field => field.location !== "body").map(field => ({ name: field.name, in: field.location,
      required: field.required, schema: field.schema, ...(field.name === "x-amz-meta-" ? { "x-operations-header-prefix": "x-amz-meta-" } : {}),
      ...(field.name === "Key" ? { "x-operations-s3-key": true } : {}) }));
    if (method === "put") source.requestBody = { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary", maxLength: 500000 } } } };
    else delete source.requestBody;
    source.responses = { ...source.responses, "200": { description: method === "get" ? "Exact object bytes" : "Object stored; empty response body",
      headers: Object.fromEntries(["ETag", "x-amz-checksum-sha256", "x-amz-checksum-type", "x-amz-version-id"].map(name => [name, { schema: { type: "string" } }])),
      content: method === "get" ? { "application/octet-stream": { schema: { type: "string", format: "binary" } } } : { "text/plain": { schema: { type: "string" }, example: "" } } },
      default: { description: "S3 XML error", content: { "application/xml": { schema: { type: "string" } } } } };
  }
}

function awsWireProtocolsPatch(document: Record<string, any>): void {
  const definition = document.components?.securitySchemes?.hmac;
  const service = document.info?.version === "2012-08-10" ? "dynamodb" : document.info?.version === "2011-06-15" ? "sts" : undefined;
  if (!service || document.openapi !== "3.0.0" || definition?.type !== "apiKey" || definition.in !== "header"
    || definition.name !== "Authorization" || definition["x-amazon-apigateway-authtype"] !== "awsSigv4"
    || JSON.stringify(document.security) !== '[{"hmac":[]}]' || !Array.isArray(document.servers) || !document.servers.length
    || document.servers.some(server => typeof server?.url !== "string" || !server.url.startsWith("http")
      || !new RegExp("^https?://" + service + "(?:\\.\\{region\\})?\\.amazonaws\\.com(?:\\.cn)?$").test(server.url)))
    throw new Error("AWS wire protocols require the reviewed native service version, regional authority and signing declaration.");
  for (const [profile, contract] of Object.entries(awsWireContracts)) {
    if (contract.service !== service) continue;
    const item = document.paths?.[contract.path];
    if (!object(item) || item.servers !== undefined) throw new Error("AWS wire protocols require their original action paths.");
    for (const method of service === "sts" ? ["get", "post"] : ["post"]) {
      const source = item[method], identity = service === "sts" ? method.toUpperCase() + "_" + contract.action : contract.action;
      if (!object(source) || source.operationId !== identity || source.servers !== undefined || source.security !== undefined
        || source["x-operations-aws-wire"] !== undefined || source["x-operations-aws-signing"] !== undefined
        || source["x-upstream-aws-wire-contract"] !== undefined || !source.responses?.["200"]?.content
        || service === "dynamodb" && source.requestBody?.content?.["application/json"]?.schema?.$ref !== "#/components/schemas/" + contract.action + "Input"
        || service === "sts" && method === "post" && source.requestBody?.content?.["text/xml"]?.schema?.$ref !== "#/components/schemas/GetCallerIdentityRequest"
        || service === "sts" && method === "get" && source.requestBody !== undefined)
        throw new Error("AWS wire protocols cannot replace an unreviewed operation contract.");
      source["x-upstream-aws-wire-contract"] = { path: contract.path, parameters: source.parameters ?? [],
        pathParameters: item.parameters ?? [], requestBody: source.requestBody ?? null, responses: source.responses, servers: source.servers ?? null };
      source["x-operations-aws-wire"] = profile; source["x-operations-aws-signing"] = contract.profile;
      source.servers = [{ url: "https://" + service + ".{region}.amazonaws.com", variables: {
        region: { default: "us-east-1", enum: awsSigningRegions, description: "Explicit signing and service region" } } }];
      source.parameters = [];
      const success = source.responses["200"];
      if (service === "dynamodb") {
        const request = source.requestBody.content["application/json"], response = success.content["application/json"];
        if (!response?.schema) throw new Error("AWS target JSON requires the reviewed JSON result.");
        source.requestBody = { required: true, content: { "application/x-amz-json-1.0": request } };
        const error = { description: "AWS JSON protocol error", content: { "application/x-amz-json-1.0": { schema: { type: "object", additionalProperties: true } } } };
        source.responses = { "200": { ...success, content: { "application/x-amz-json-1.0": response } }, "400": error, "500": error, default: error };
      } else {
        if (!success.content["text/xml"]?.schema) throw new Error("STS requires the reviewed XML result.");
        if (method === "post") source.requestBody = { required: true, content: { "application/x-www-form-urlencoded": { schema: {
          type: "object", required: ["Action", "Version"], additionalProperties: false, properties: {
            Action: { type: "string", enum: ["GetCallerIdentity"] }, Version: { type: "string", enum: ["2011-06-15"] } } } } } };
        else source.parameters = ["Action", "Version"].map(name => ({ name, in: "query", required: true,
          schema: { type: "string", enum: [name === "Action" ? "GetCallerIdentity" : "2011-06-15"] } }));
        source.responses = { "200": { description: "Decoded STS identity; XML wire envelope verified", content: {
          "text/xml": { schema: { type: "string" } }, "application/json": { schema: { ...document.components.schemas.GetCallerIdentityResponse,
            properties: { ...document.components.schemas.GetCallerIdentityResponse.properties,
              ResponseMetadata: { type: "object", properties: { RequestId: { type: "string" } }, required: ["RequestId"] } } } } } },
          default: { description: "Decoded STS XML error", content: { "text/xml": { schema: { type: "string" } } } } };
      }
    }
  }
}

export function applySchemaPatches(input: Record<string, unknown>, patches: readonly SchemaPatch[] = []): Record<string, unknown> {
  if (!patches.length) return input;
  const document = structuredClone(input);
  const seen = new Set<string>();
  for (const patch of patches) {
    if (!["google-oauth-alternatives", "digitalocean-bearer-permissions", "gemini-auth-alternatives", "azure-eventgrid-management-auth", "anthropic-authentication", "elevenlabs-authentication", "github-authentication", "http-response-streaming", "telegram-private-path", "x-oauth1-signing", "cloudflare-private-upload", "provider-path-bindings", "atlassian-server-bindings", "aws-s3-files", "aws-wire-protocols", "bigquery-job-metadata", "google-storage-media"].includes(patch?.id) || patch.version !== 1 || seen.has(patch.id))
      throw new Error("The reviewed schema correction is unknown or duplicated.");
    seen.add(patch.id);
    if (patch.id === "bigquery-job-metadata") bigqueryMetadata(document);
    else if (patch.id === "google-storage-media") storageMedia(document);
    else if (patch.id === "google-oauth-alternatives") googleAlternatives(document);
    else if (patch.id === "digitalocean-bearer-permissions") digitalOceanPermissions(document);
    else if (patch.id === "gemini-auth-alternatives") geminiAlternatives(document);
    else if (patch.id === "azure-eventgrid-management-auth") azureEventGridAuthentication(document);
    else if (patch.id === "anthropic-authentication") anthropicAuth(document);
    else if (patch.id === "elevenlabs-authentication") elevenLabsAuth(document);
    else if (patch.id === "github-authentication") adaptGithubAuthentication(document);
    else if (patch.id === "http-response-streaming") responseStreaming(document);
    else if (patch.id === "telegram-private-path") telegramPath(document);
    else if (patch.id === "x-oauth1-signing") xOauth1(document);
    else if (patch.id === "atlassian-server-bindings") bindAtlassianServers(document);
    else if (patch.id === "provider-path-bindings") bindProviderPaths(document);
    else if (patch.id === "cloudflare-private-upload") cloudflareUploads(document);
    else if (patch.id === "aws-s3-files") s3Files(document);
    else awsWireProtocolsPatch(document);
  }
  return document;
}
