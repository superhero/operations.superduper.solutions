// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

/** Reviewed, versioned data corrections. These never execute code from a schema. */
export type SchemaPatch = { id: "google-oauth-alternatives"; version: 1 };
export const googleOauthAlternatives: SchemaPatch = { id: "google-oauth-alternatives", version: 1 };
export function schemaPatchName(patch: SchemaPatch): string {
  return patch.id === "google-oauth-alternatives" ? "Google OAuth alternatives" : "Unknown schema correction";
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

/** Preserve the published document. Reapplying a resolved correction is a no-op. */
export function applySchemaPatches(input: Record<string, unknown>, patches: readonly SchemaPatch[] = []): Record<string, unknown> {
  if (!patches.length) return input;
  const document = structuredClone(input);
  const seen = new Set<string>();
  for (const patch of patches) {
    if (patch?.id !== "google-oauth-alternatives" || patch.version !== 1 || seen.has(patch.id))
      throw new Error("The reviewed schema correction is unknown or duplicated.");
    seen.add(patch.id);
    googleAlternatives(document);
  }
  return document;
}
