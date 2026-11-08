// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { VaultSession } from "./session.ts";
import { createVaultStorage } from "./storage.ts";
import { safeVaultError, VaultError, vaultLimits } from "./types.ts";
import { NativeCommandInputError } from '../native-command.ts';
import { InputValidationError } from "../operation-input.ts";
import { CredentialResponseError } from "./execution.ts";
import { assertCurrentSchema } from "./schema-policy-storage.ts";
import type { VaultFailure, VaultMethod, VaultReply } from "./protocol.ts";
import { canStartVaultRequest } from './request-policy.ts';
import { validateNativeReference } from './native-runtime-config.ts';
import type { NativeReferenceTransition } from './native-reference-continuations.ts';

const send = (reply: VaultReply) => self.postMessage(reply);
const methods = new Set<VaultMethod>(["status", "unlock", "prepareCreate", "confirmCreate", "keys", "list", "copyCredential", "put", "remove",
  "grant", "revoke", "connections", "connectionBinding", "putConnection", "removeConnection",
  "beginJiraOAuth", "pollJiraOAuth", "completeJiraOAuth", "cancelJiraOAuth",
  "beginAtprotoOAuth", "completeAtprotoOAuth", "cancelAtprotoOAuth",
  "beginGitlabOAuth", "completeGitlabOAuth", "cancelGitlabOAuth",
  "nativeConnections", "pairNativeRuntime", "checkNativeRuntime", "disconnectNativeRuntime",
  "enableNativeWorkflow", "loginNativeRuntime", "executeNativeRuntime", "executeNativeAccount", "executeNativeInitialize", "executeNativeQuery", "executeNativeFeedback", "executeNativeMcpOAuth",
  "cancelNativeAccountLogin", "cancelNativeGatewayLogin", "controlNativeTurn", "executeNativeWatch", "executeNativeUnwatch", "executeNativeCommand", "controlNativeCommand",
  "dockerConnections", "pairDockerHost", "checkDockerHost", "disconnectDockerHost", "executeDockerRead",
  "execute", "checkAssertion", "backup", "restore", "addMethod", "removeMethod", "rotate"]);
const active = new Map<number, { method: VaultMethod; controller: AbortController }>();
let expires = Infinity;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastClock = Date.now();
let invalidated = false;

function lock() {
  invalidated = true; for (const request of active.values()) request.controller.abort(); session.lock(); clearTimeout(timer);
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
  if (error instanceof NativeCommandInputError) {
    const field: VaultFailure = { kind: 'field', field: 'params:' + error.field, message: error.message };
    return fits(field) ? field : { kind: 'vault', code: 'LIMIT' };
  }
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
  if (data?.kind === "cancel") { active.get(data.id)?.controller.abort(); return; }
  if (data?.kind === 'command-reply') {
    const request = active.get(data.id); if (request?.method !== 'executeNativeCommand') return;
    try { assertActive(); await session.replyNativeCommand(data.connectionId, data.token, data.decision, request.controller.signal); }
    catch { request.controller.abort(); }
    return;
  }
  if (data?.kind === "native-reply") {
    const request = active.get(data.id);
    if (request?.method !== 'executeNativeRuntime') return;
    try { assertActive(); await session.replyNativeRuntime(data.connectionId, data.token, data.decision, request.controller.signal); }
    catch { request.controller.abort(); }
    return;
  }
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
  if (!methods.has(data.method) || !Array.isArray(data.args)) {
    send({ id, ok: false, error: { kind: "vault", code: "INVALID" } }); return;
  }
  const method = data.method as VaultMethod;
  if (active.has(id) || !canStartVaultRequest([...active.values()].map(request => request.method), method)) {
    send({ id, ok: false, error: { kind: 'vault', code: 'CONFLICT' } }); return;
  }
  const controller = new AbortController(); active.set(id, { method, controller });
  try {
    assertActive();
    const args: unknown[] = data.args;
    let nativeReference: NativeReferenceTransition | undefined;
    if (method === 'executeNativeRuntime') args[6] = (next: unknown) => {
      assertActive();
      if (controller.signal.aborted) throw new VaultError('CANCELLED');
      nativeReference = { before: validateNativeReference(args[0]), after: validateNativeReference(next) };
    };
    if (method === "execute") {
      args[3] = controller.signal;
      args[5] = (progress: import("../workflow-response-stream.ts").ResponseProgress) => { assertActive(); send({ event: "response-progress", id, progress }); };
      args[6] = (value: import("../workflow-response-stream.ts").ResponseValue) => { assertActive(); send({ event: "response-value", id, value }); };
    }
    if (method === "beginJiraOAuth") args[3] = controller.signal;
    if (method === "pollJiraOAuth") args[1] = controller.signal;
    if (method === "completeJiraOAuth") args[2] = controller.signal;
    if (method === "completeGitlabOAuth" || method === "completeAtprotoOAuth") args[2] = controller.signal;
    if (method === "pairNativeRuntime" || method === "checkNativeRuntime") args[2] = controller.signal;
    if (method === "pairDockerHost" || method === "checkDockerHost") args[2] = controller.signal;
    if (method === "executeDockerRead" || method === "executeNativeAccount") args[3] = controller.signal;
    if (method === "executeNativeInitialize" || method === "executeNativeQuery" || method === "executeNativeFeedback") args[4] = controller.signal;
    if (method === 'executeNativeCommand') {
      args[4] = controller.signal;
      args[5] = (progress: import('../native-agent-contract.ts').NativeAgentProgress) => { assertActive(); if (!controller.signal.aborted) send({ event: 'native-progress', id, progress }); };
      args[6] = (value: import('../native-command.ts').NativeCommandValue) => { assertActive(); if (!controller.signal.aborted) send({ event: 'command-value', id, value }); };
    }
    if (method === 'controlNativeCommand') args[5] = controller.signal;
    if (method === 'executeNativeWatch' || method === 'executeNativeUnwatch' || method === 'cancelNativeAccountLogin' || method === 'cancelNativeGatewayLogin' || method === 'controlNativeTurn') args[4] = controller.signal;
    if (method === 'executeNativeWatch') args[5] = (value: import('../native-filesystem-watch.ts').NativeFilesystemWatchValue) => {
      assertActive(); if (!controller.signal.aborted) send({ event: 'native-value', id, value });
    };
    if (method === "loginNativeRuntime" || method === "executeNativeRuntime" || method === "executeNativeMcpOAuth") {
      const offset = method === "loginNativeRuntime" ? 3 : method === "executeNativeMcpOAuth" ? 5 : 4;
      args[offset] = controller.signal;
      args[offset + 1] = (progress: import("../native-agent-contract.ts").NativeAgentProgress) => {
        assertActive(); send({ event: "native-progress", id, progress });
      };
    }
    // Only named, reviewed management and execution methods are dispatchable.
    const call = session[method].bind(session) as (...args: unknown[]) => Promise<unknown>;
    const value = await call(...args);
    assertActive();
    if (controller.signal.aborted) throw new VaultError("CANCELLED");
    send({ id, ok: true, value, ...(nativeReference ? { nativeReference } : {}) });
  } catch (error) { send({ id, ok: false, error: failure(error) }); }
  finally {
    // Drop structured-cloned password/PRF input; buffers can be overwritten, JS strings cannot.
    const clear = (value: unknown): void => {
      if (value instanceof Uint8Array) value.fill(0);
      else if (Array.isArray(value)) value.forEach(clear);
      else if (value && typeof value === "object") Object.values(value).forEach(clear);
    };
    clear(data.args); data.args = undefined; active.delete(id);
  }
};
