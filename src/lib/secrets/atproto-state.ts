// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { SessionStore } from "@atproto/oauth-client";
import { credentialObject } from "./bindings.ts";
import { canonicalPolicyValue } from "./policy.ts";
import { VaultError, type AtprotoOAuthMetadata } from "./types.ts";
import { atprotoScope, validateAtprotoMetadata } from "./atproto-config.ts";
type Session = Parameters<SessionStore["set"]>[1];
export type AtprotoState = { oauth: AtprotoOAuthMetadata; jwk: JsonWebKey; tokenSet: Session["tokenSet"]; refreshPending: boolean };
const same = (a: unknown, b: unknown) => canonicalPolicyValue(a) === canonicalPolicyValue(b);
const token = (value: unknown): value is string => typeof value === "string" && value.length >= 8 && value.length <= 8192 && !/\s/.test(value);
export function checkTokenSet(value: Session["tokenSet"], oauth: AtprotoOAuthMetadata) {
  if (value.token_type !== "DPoP" || !token(value.access_token) || !token(value.refresh_token) || value.sub !== oauth.accountId
    || value.iss.replace(/\/$/, "") !== oauth.issuer.replace(/\/$/, "") || value.aud.replace(/\/$/, "") !== oauth.pds.replace(/\/$/, "")
    || value.scope.split(" ").sort().join(" ") !== atprotoScope.split(" ").sort().join(" ")
    || !value.expires_at || !Number.isFinite(Date.parse(value.expires_at))) throw new VaultError("AUTHORIZATION");
}
export function validateAtprotoState(raw: string, metadata?: AtprotoOAuthMetadata): AtprotoState {
  try {
    if (raw.length > 65536) throw new Error();
    const value = credentialObject(JSON.parse(raw)), oauth = validateAtprotoMetadata(value.oauth), jwk = credentialObject(value.jwk);
    if (Object.keys(value).sort().join() !== "jwk,oauth,refreshPending,tokenSet" || typeof value.refreshPending !== "boolean"
      || metadata && !same(oauth, metadata) || jwk.kty !== "EC" || jwk.crv !== "P-256" || jwk.alg !== "ES256"
      || ![jwk.x, jwk.y, jwk.d].every(v => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v))) throw new Error();
    checkTokenSet(credentialObject(value.tokenSet) as Session["tokenSet"], oauth);
    return value as AtprotoState;
  } catch { throw new VaultError("AUTHORIZATION"); }
}
export function managedAtprotoSecrets(raw: string): string[] {
  try { const state = validateAtprotoState(raw); return [state.tokenSet.access_token, state.tokenSet.refresh_token!, state.jwk.d!]; } catch { return []; }
}
