// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { VaultSession } from "./session.ts";
import { createVaultStorage } from "./storage.ts";
import { safeVaultError, VaultError, vaultLimits } from "./types.ts";
import { InputValidationError } from "../operation-input.ts";
import { CredentialResponseError } from "./execution.ts";
import { assertCurrentSchema } from "./schema-policy-storage.ts";
import type { VaultFailure, VaultMethod, VaultReply } from "./protocol.ts";

const send = (reply: VaultReply) => self.postMessage(reply);
const methods = new Set<VaultMethod>(["status", "unlock", "prepareCreate", "confirmCreate", "keys", "list", "copyCredential", "put", "remove",
  "grant", "revoke", "execute", "checkAssertion", "backup", "restore", "addMethod", "removeMethod", "rotate"]);
let busy = false;
let controller: AbortController | undefined;
let activeId: number | undefined;
let expires = Infinity;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastClock = Date.now();
let invalidated = false;

function lock() {
  invalidated = true; controller?.abort(); session.lock(); clearTimeout(timer);
  send({ event: "locked" });
}
function assertActive() {
  const now = Date.now();
  if (invalidated || now < lastClock || now >= expires) { lock(); throw new VaultError("LOCKED"); }
  lastClock = now;
}
const session = new VaultSession(createVaultStorage(), assertActive, assertCurrentSchema);

function failure(error: unknown): VaultFailure {
  const fits = (value: VaultFailure) => new TextEncoder().encode(JSON.stringify({ id: Number.MAX_SAFE_INTEGER, ok: false, error: value })).byteLength <= vaultLimits.diagnosticBytes;
  if (error instanceof InputValidationError) {
    const field: VaultFailure = { kind: "field", field: error.fieldKey, message: error.message };
    return fits(field) ? field : { kind: "vault", code: "LIMIT" };
  }
  if (error instanceof CredentialResponseError) {
    // UI receives bounded diagnostics; huge HTTP bodies are not copied into error history.
    const response: VaultFailure = { kind: "response", response: error.response, message: error.message };
    if (fits(response)) return response;
    return { kind: "response", response: { status: error.response.status, statusText: "", headers: {},
      body: "The error response exceeded the diagnostic limit." }, message: "The endpoint returned an unsuccessful response." };
  }
  return { kind: "vault", code: safeVaultError(error).code };
}

self.onmessage = async ({ data }) => {
  if (data?.kind === "cancel") { if (data.id === activeId) controller?.abort(); return; }
  if (data?.kind === "policy") {
    try {
      assertActive();
      if (!(data.expires === null || Number.isFinite(data.expires))) throw new VaultError("INVALID");
      expires = data.expires === null ? Infinity : data.expires;
      clearTimeout(timer); assertActive();
      if (expires !== Infinity) timer = setTimeout(lock, Math.max(0, expires - Date.now()));
    } catch { lock(); }
    return;
  }
  if (!Number.isSafeInteger(data?.id) || data.id < 1) return;
  const id: number = data.id;
  if (busy || !methods.has(data.method) || !Array.isArray(data.args)) {
    send({ id, ok: false, error: { kind: "vault", code: busy ? "CONFLICT" : "INVALID" } }); return;
  }
  busy = true; activeId = id; controller = new AbortController();
  try {
    assertActive();
    const method = data.method as VaultMethod;
    const args: unknown[] = data.args;
    if (method === "execute") args[3] = controller.signal;
    // Only named, reviewed management and execution methods are dispatchable.
    const call = session[method].bind(session) as (...args: unknown[]) => Promise<unknown>;
    const value = await call(...args);
    assertActive();
    if (controller.signal.aborted) throw new VaultError("CANCELLED");
    send({ id, ok: true, value });
  } catch (error) { send({ id, ok: false, error: failure(error) }); }
  finally {
    // Drop structured-cloned password/PRF input; buffers can be overwritten, JS strings cannot.
    const clear = (value: unknown): void => {
      if (value instanceof Uint8Array) value.fill(0);
      else if (Array.isArray(value)) value.forEach(clear);
      else if (value && typeof value === "object") Object.values(value).forEach(clear);
    };
    clear(data.args); data.args = undefined; busy = false; activeId = undefined; controller = undefined;
  }
};
