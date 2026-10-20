// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const scopes = value => Array.isArray(value) && value.every(scope => typeof scope === 'string');
const sameScopes = (left, right) => scopes(left) && scopes(right)
  && JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());

/** APIs.guru repeats Google's implicit/code grants in one AND requirement.
 * Both grants issue the same bearer token. Collapse only that known pair with
 * identical scopes; preserve every original declaration and both flow models.
 * Generic OpenAPI security extraction keeps its strict AND semantics. */
export function adaptGoogleOauthSchema(input) {
  const document = structuredClone(input);
  const schemes = document.components?.securitySchemes;
  const implicit = schemes?.Oauth2?.flows?.implicit;
  const code = schemes?.Oauth2c?.flows?.authorizationCode;
  function adapt(target) {
    if (!Array.isArray(target?.security)) return;
    let changed = false;
    const security = target.security.map(requirement => {
      if (!object(requirement) || !Object.hasOwn(requirement, 'Oauth2') || !Object.hasOwn(requirement, 'Oauth2c')) return requirement;
      if (schemes?.Oauth2?.type !== 'oauth2' || schemes?.Oauth2c?.type !== 'oauth2'
        || !implicit || !code || implicit.authorizationUrl !== 'https://accounts.google.com/o/oauth2/auth'
        || code.authorizationUrl !== implicit.authorizationUrl || code.tokenUrl !== 'https://accounts.google.com/o/oauth2/token'
        || !object(implicit.scopes) || !object(code.scopes)
        || !sameScopes(Object.keys(implicit.scopes), Object.keys(code.scopes))
        || !sameScopes(requirement.Oauth2, requirement.Oauth2c)
        || requirement.Oauth2c.some(scope => !Object.hasOwn(code.scopes, scope)))
        throw new Error('Google OAuth adaptation requires matching Google grant flows and identical declared scopes.');
      const { Oauth2: _implicit, ...normalized } = requirement;
      changed = true;
      return normalized;
    });
    if (!changed) return;
    if (Object.hasOwn(target, 'x-upstream-security')) throw new Error('Google OAuth adaptation cannot overwrite upstream security provenance.');
    target['x-upstream-security'] = target.security;
    target.security = security;
  }
  adapt(document);
  for (const item of Object.values(document.paths ?? {}))
    if (object(item)) for (const [method, operation] of Object.entries(item))
      if (methods.has(method) && object(operation)) adapt(operation);
  return document;
}
