// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { safeVaultError, VaultError } from "./types.ts";
import type { Enrollment } from "./types.ts";

type PasskeyMethod = { credentialId: string; prfSalt: string };
type PasskeyEnrollment = Extract<Enrollment, { kind: "passkey" }>;
const timeout = 120_000;

// Keep this window bridge independent of the worker's Argon2/WASM dependency.
function encode(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)); }
function decode(value: string, min: number, max: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length < 4 || value.length > Math.ceil(max / 3) * 4
    || value.length % 4 || /[^A-Za-z0-9+/=]/.test(value)) throw new VaultError("INVALID");
  try {
    const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
    if (bytes.byteLength < min || bytes.byteLength > max || encode(bytes) !== value) throw new VaultError("INVALID");
    return bytes;
  } catch { throw new VaultError("INVALID"); }
}
function environment() {
  if (typeof window === "undefined" || !window.isSecureContext
    || typeof window.PublicKeyCredential !== "function" || !window.navigator.credentials
    || typeof window.navigator.credentials.create !== "function"
    || typeof window.navigator.credentials.get !== "function") throw new VaultError("UNAVAILABLE");
  return window;
}
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new VaultError("CANCELLED");
}
function failure(error: unknown, signal?: AbortSignal): VaultError {
  if (signal?.aborted || error instanceof DOMException && ["AbortError", "NotAllowedError"].includes(error.name)) {
    return new VaultError("CANCELLED");
  }
  return safeVaultError(error);
}
function credential(value: Credential | null, browser: Window & typeof globalThis): PublicKeyCredential {
  if (!(value instanceof browser.PublicKeyCredential) || value.type !== "public-key"
    || !(value.rawId instanceof ArrayBuffer) || value.rawId.byteLength < 1 || value.rawId.byteLength > 1024) {
    throw new VaultError("AUTHENTICATION");
  }
  return value;
}
function output(extension: AuthenticationExtensionsPRFOutputs | undefined): Uint8Array<ArrayBuffer> {
  if (!extension || extension.enabled === false || !extension.results) throw new VaultError("UNAVAILABLE");
  const value = extension.results.first;
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value)
    : ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : undefined;
  if (!bytes) throw new VaultError("AUTHENTICATION");
  try {
    if (bytes.byteLength !== 32) throw new VaultError("AUTHENTICATION");
    return bytes.slice();
  } finally { bytes.fill(0); }
}

/** PRF key material for the local vault, not a server authentication assertion. */
export async function unlockPasskey(method: PasskeyMethod, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  let prf: Uint8Array<ArrayBuffer> | undefined;
  try {
    cancelled(signal);
    const id = decode(method?.credentialId, 1, 1024), salt = decode(method?.prfSalt, 32, 32);
    const browser = environment();
    const value = await browser.navigator.credentials.get({
      publicKey: {
        challenge: browser.crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: "public-key", id }],
        userVerification: "required", timeout,
        extensions: { prf: { eval: { first: salt } } },
      },
      ...(signal ? { signal } : {}),
    });
    const result = credential(value, browser);
    if (encode(new Uint8Array(result.rawId)) !== encode(id)) throw new VaultError("AUTHENTICATION");
    prf = output(result.getClientExtensionResults().prf);
    cancelled(signal);
    return prf;
  } catch (error) { prf?.fill(0); throw failure(error, signal); }
}

/** An ignored PRF extension never counts as enrollment. No provider is forced. */
export async function enrollPasskey(signal?: AbortSignal): Promise<PasskeyEnrollment> {
  let prf: Uint8Array<ArrayBuffer> | undefined;
  try {
    cancelled(signal);
    const browser = environment();
    const salt = browser.crypto.getRandomValues(new Uint8Array(32));
    const value = await browser.navigator.credentials.create({
      publicKey: {
        challenge: browser.crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "Operations secrets vault" },
        user: { id: browser.crypto.getRandomValues(new Uint8Array(32)), name: "local-vault", displayName: "Local secrets vault" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
        attestation: "none", timeout,
        extensions: { prf: { eval: { first: salt } } },
      },
      ...(signal ? { signal } : {}),
    });
    const result = credential(value, browser), extension = result.getClientExtensionResults().prf;
    if (extension?.enabled !== true) throw new VaultError("UNAVAILABLE");
    const method = { credentialId: encode(new Uint8Array(result.rawId)), prfSalt: encode(salt) };
    // Creation may enable PRF without evaluating it; authentication must prove it.
    if (extension.results) prf = output(extension);
    cancelled(signal);
    prf ??= await unlockPasskey(method, signal);
    cancelled(signal);
    return { kind: "passkey", ...method, prf };
  } catch (error) { prf?.fill(0); throw failure(error, signal); }
}
