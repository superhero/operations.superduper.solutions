// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { argon2id } from "hash-wasm";
import { passwordProfile, VaultError, vaultLimits } from "./types.ts";
import type { Ciphertext, CryptoContext, PasswordProfile } from "./types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const contextKinds = new Set(["manifest", "credential", "password", "recovery", "passkey"]);
const aes = { name: "AES-GCM", length: 256 };
const keyUsages: KeyUsage[] = ["encrypt", "decrypt"];

/** JSON data only: never call accessors or toJSON from an untrusted object. */
export function ownObject(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new VaultError("INVALID");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== Object.keys(descriptors).length
    || required.some(name => !Object.hasOwn(descriptors, name))
    || Object.entries(descriptors).some(([name, descriptor]) => !descriptor.enumerable || !("value" in descriptor)
      || (!required.includes(name) && !optional.includes(name)))) throw new VaultError("INVALID");
  return Object.fromEntries(Object.entries(descriptors).map(([name, descriptor]) => [name, descriptor.value]));
}

export function validId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}
export function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Stable JSON member order; values must already be finite JSON data. */
export function canonicalJSON(value: unknown, limit = vaultLimits.backupBytes): string {
  let bytes = 0;
  const seen = new Set<object>();
  function token(text: string): string {
    bytes += encoder.encode(text).byteLength;
    if (bytes > limit) throw new VaultError("LIMIT");
    return text;
  }
  function visit(item: unknown, depth: number): string {
    if (depth > 64) throw new VaultError("INVALID");
    if (item === null || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) {
      return token(JSON.stringify(item));
    }
    if (typeof item === "string") {
      if (item.length > limit) throw new VaultError("LIMIT");
      return token(JSON.stringify(item));
    }
    if (typeof item !== "object" || seen.has(item)) throw new VaultError("INVALID");
    seen.add(item);
    let result: string;
    if (Array.isArray(item)) {
      if (item.length > limit) throw new VaultError("LIMIT");
      const descriptors = Object.getOwnPropertyDescriptors(item);
      if (Reflect.ownKeys(item).length !== item.length + 1) throw new VaultError("INVALID");
      const entries: string[] = [];
      for (let i = 0; i < item.length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !("value" in descriptor)) throw new VaultError("INVALID");
        if (i) token(",");
        entries.push(visit(descriptor.value, depth + 1));
      }
      result = token("[") + entries.join(",") + token("]");
    } else {
      const object = ownObject(item, Object.keys(item));
      const entries: string[] = [];
      for (const name of Object.keys(object).sort()) {
        if (entries.length) token(",");
        entries.push(token(JSON.stringify(name)) + token(":") + visit(object[name], depth + 1));
      }
      result = token("{") + entries.join(",") + token("}");
    }
    seen.delete(item);
    return result;
  }
  return visit(value, 0);
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function decodeBase64(value: string, expectedLength?: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string" || value.length > Math.ceil(vaultLimits.backupBytes / 3) * 4
    || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)
    || (expectedLength !== undefined && (!Number.isSafeInteger(expectedLength) || expectedLength < 0
      || value.length !== Math.ceil(expectedLength / 3) * 4))) throw new VaultError("INVALID");
  try {
    const bytes = Uint8Array.from(atob(value), character => character.charCodeAt(0));
    if (encodeBase64(bytes) !== value || (expectedLength !== undefined && bytes.byteLength !== expectedLength)) {
      bytes.fill(0);
      throw new VaultError("INVALID");
    }
    return bytes;
  } catch { throw new VaultError("INVALID"); }
}

export function randomBase64(length: number): string {
  if (!Number.isSafeInteger(length) || length < 1 || length > 65536) throw new VaultError("INVALID");
  const bytes = new Uint8Array(length);
  let result: string;
  try { crypto.getRandomValues(bytes); result = encodeBase64(bytes); }
  catch { throw new VaultError("UNAVAILABLE"); }
  finally {
    bytes.fill(0);
  }
  return result;
}

export function validatePasswordProfile(value: unknown): PasswordProfile {
  const profile = ownObject(value, Object.keys(passwordProfile));
  if (Object.entries(passwordProfile).some(([name, expected]) => profile[name] !== expected)) throw new VaultError("INVALID");
  return { ...passwordProfile };
}

function additionalData(value: CryptoContext): Uint8Array<ArrayBuffer> {
  const context = ownObject(value, ["vaultId", "epoch", "kind", "id", "revision"]);
  if (!validId(context.vaultId) || !validId(context.id) || !validRevision(context.epoch)
    || !validRevision(context.revision) || typeof context.kind !== "string" || !contextKinds.has(context.kind)) {
    throw new VaultError("INVALID");
  }
  return encoder.encode(canonicalJSON({ version: 1, ...context }));
}

export async function newVaultKey(): Promise<CryptoKey> {
  try { return await crypto.subtle.generateKey(aes, true, keyUsages); }
  catch { throw new VaultError("UNAVAILABLE"); }
}

/** Only creation and enrollment need exportable handles. Cleanup is best effort. */
export async function runtimeKey(key: CryptoKey): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  let result: CryptoKey;
  try {
    bytes = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    if (bytes.byteLength !== 32 || key.algorithm.name !== "AES-GCM") throw new VaultError("INVALID");
    result = await crypto.subtle.importKey("raw", bytes, aes, false, keyUsages);
  } catch (error) { throw error instanceof VaultError ? error : new VaultError("UNAVAILABLE"); }
  finally {
    bytes?.fill(0);
  }
  return result;
}

export async function passwordKey(password: string, salt: string, profile: PasswordProfile = passwordProfile): Promise<CryptoKey> {
  validatePasswordProfile(profile);
  if (typeof password !== "string" || password.length < 1 || password.length > vaultLimits.secretBytes
    || !password.isWellFormed()) throw new VaultError("INVALID");
  const passwordBytes = encoder.encode(password);
  let saltBytes: Uint8Array<ArrayBuffer> | undefined;
  let derived: Uint8Array | undefined;
  let result: CryptoKey;
  try {
    if (passwordBytes.byteLength > vaultLimits.secretBytes) throw new VaultError("LIMIT");
    saltBytes = decodeBase64(salt, 16);
    // hash-wasm 4.12.0 implements Argon2 version 0x13 (19). Never persist its output.
    derived = await argon2id({ password: passwordBytes, salt: saltBytes, memorySize: profile.memoryKiB,
      iterations: profile.iterations, parallelism: profile.parallelism, hashLength: profile.outputBytes, outputType: "binary" });
    result = await crypto.subtle.importKey("raw", derived as Uint8Array<ArrayBuffer>, aes, false, keyUsages);
  } catch (error) { throw error instanceof VaultError ? error : new VaultError("UNAVAILABLE"); }
  finally {
    passwordBytes.fill(0); saltBytes?.fill(0); derived?.fill(0);
  }
  return result;
}

async function hkdfKey(material: Uint8Array<ArrayBuffer>, salt: string, purpose: "recovery" | "passkey"): Promise<CryptoKey> {
  let saltBytes: Uint8Array<ArrayBuffer> | undefined;
  let result: CryptoKey;
  try {
    saltBytes = decodeBase64(salt, 16);
    const key = await crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveKey"]);
    result = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: saltBytes,
      info: encoder.encode(`operations.superduper.solutions/vault/v1/${purpose}`) }, key, aes, false, keyUsages);
  } catch (error) { throw error instanceof VaultError ? error : new VaultError("UNAVAILABLE"); }
  finally {
    material.fill(0); saltBytes?.fill(0);
  }
  return result;
}

export async function recoveryKey(recoveryBase64: string, salt: string): Promise<CryptoKey> {
  return hkdfKey(decodeBase64(recoveryBase64, 32), salt, "recovery");
}
export async function passkeyKey(prfBytes: Uint8Array, salt: string): Promise<CryptoKey> {
  if (!(prfBytes instanceof Uint8Array) || prfBytes.byteLength !== 32) throw new VaultError("INVALID");
  return hkdfKey(new Uint8Array(prfBytes), salt, "passkey");
}

async function encryptBytes(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>, context: CryptoContext): Promise<Ciphertext> {
  const aad = additionalData(context);
  const iv = new Uint8Array(12);
  let result: Ciphertext;
  try {
    crypto.getRandomValues(iv);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, bytes);
    result = { iv: encodeBase64(iv), data: encodeBase64(new Uint8Array(encrypted)) };
  } catch { throw new VaultError("UNAVAILABLE"); }
  finally {
    iv.fill(0); aad.fill(0);
  }
  return result;
}

async function decryptBytes(key: CryptoKey, box: Ciphertext, context: CryptoContext): Promise<Uint8Array<ArrayBuffer>> {
  const aad = additionalData(context);
  const object = ownObject(box, ["iv", "data"]);
  const iv = decodeBase64(object.iv as string, 12);
  let data: Uint8Array<ArrayBuffer> | undefined;
  let result: Uint8Array<ArrayBuffer>;
  try {
    if (typeof object.data !== "string" || object.data.length > Math.ceil((vaultLimits.recordBytes + 16) / 3) * 4) {
      throw new VaultError("INVALID");
    }
    data = decodeBase64(object.data as string);
    if (data.byteLength < 16 || data.byteLength > vaultLimits.recordBytes + 16) throw new VaultError("INVALID");
    result = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, data));
  } catch (error) { throw error instanceof VaultError ? error : new VaultError("AUTHENTICATION"); }
  finally {
    aad.fill(0); iv.fill(0); data?.fill(0);
  }
  return result;
}

export async function encryptJSON(key: CryptoKey, value: unknown, context: CryptoContext): Promise<Ciphertext> {
  const bytes = encoder.encode(canonicalJSON(value, vaultLimits.recordBytes));
  try { return await encryptBytes(key, bytes, context); }
  finally {
    bytes.fill(0);
  }
}
export async function decryptJSON<T = unknown>(key: CryptoKey, box: Ciphertext, context: CryptoContext): Promise<T> {
  const bytes = await decryptBytes(key, box, context);
  let result: T;
  try { result = JSON.parse(decoder.decode(bytes)) as T; }
  catch { throw new VaultError("AUTHENTICATION"); }
  finally {
    bytes.fill(0);
  }
  return result;
}

export async function wrapVaultKey(key: CryptoKey, kek: CryptoKey, context: CryptoContext): Promise<Ciphertext> {
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  let result: Ciphertext;
  try {
    bytes = new Uint8Array(await crypto.subtle.exportKey("raw", key));
    if (bytes.byteLength !== 32 || key.algorithm.name !== "AES-GCM") throw new VaultError("INVALID");
    result = await encryptBytes(kek, bytes, context);
  } catch (error) { throw error instanceof VaultError ? error : new VaultError("UNAVAILABLE"); }
  finally {
    bytes?.fill(0);
  }
  return result;
}
export async function unwrapVaultKey(box: Ciphertext, kek: CryptoKey, context: CryptoContext, extractable = false): Promise<CryptoKey> {
  const bytes = await decryptBytes(kek, box, context);
  let result: CryptoKey;
  try {
    if (bytes.byteLength !== 32) throw new VaultError("AUTHENTICATION");
    result = await crypto.subtle.importKey("raw", bytes, aes, extractable, keyUsages);
  } catch { throw new VaultError("AUTHENTICATION"); }
  finally {
    bytes.fill(0);
  }
  return result;
}

export async function digest(value: unknown): Promise<string> {
  const bytes = encoder.encode(canonicalJSON(value));
  let result: string;
  try { result = encodeBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))); }
  catch { throw new VaultError("UNAVAILABLE"); }
  finally {
    bytes.fill(0);
  }
  return result;
}
