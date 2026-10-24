// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** Reviewed, versioned data corrections. These never execute code from a schema. */
export type SchemaPatch = { id: "google-oauth-alternatives" | "digitalocean-bearer-permissions" | "gemini-auth-alternatives"; version: 1 };
export const googleOauthAlternatives: SchemaPatch = { id: "google-oauth-alternatives", version: 1 };
export const digitalOceanBearerPermissions: SchemaPatch = { id: "digitalocean-bearer-permissions", version: 1 };
export const geminiAuthAlternatives: SchemaPatch = { id: "gemini-auth-alternatives", version: 1 };
export function schemaPatchName(patch: SchemaPatch): string {
  return patch.id === "google-oauth-alternatives" ? "Google OAuth alternatives"
    : patch.id === "digitalocean-bearer-permissions" ? "DigitalOcean bearer permissions"
    : patch.id === "gemini-auth-alternatives" ? "Gemini authentication alternatives" : "Unknown schema correction";
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

/** Preserve the published document. Reapplying a resolved correction is a no-op. */
export function applySchemaPatches(input: Record<string, unknown>, patches: readonly SchemaPatch[] = []): Record<string, unknown> {
  if (!patches.length) return input;
  const document = structuredClone(input);
  const seen = new Set<string>();
  for (const patch of patches) {
    if (!["google-oauth-alternatives", "digitalocean-bearer-permissions", "gemini-auth-alternatives"].includes(patch?.id) || patch.version !== 1 || seen.has(patch.id))
      throw new Error("The reviewed schema correction is unknown or duplicated.");
    seen.add(patch.id);
    if (patch.id === "google-oauth-alternatives") googleAlternatives(document);
    else if (patch.id === "digitalocean-bearer-permissions") digitalOceanPermissions(document);
    else geminiAlternatives(document);
  }
  return document;
}
