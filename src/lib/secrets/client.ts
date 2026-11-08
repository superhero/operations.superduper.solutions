// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import VaultWorker from "./vault.worker.ts?worker&inline";
import { trackApplicationWorker } from "../application-workers.ts";
import { InputValidationError } from "../operation-input.ts";
import { WorkflowResponseError } from "../workflow-execution.ts";
import { publicVaultKeys } from "./key-index.ts";
import { createVaultStorage } from "./storage.ts";
import { createVaultLifecycle } from "./lifecycle.ts";
import { readVaultPreferences, saveSetting, validateVaultPreferences } from "../app-settings.ts";
import { defaultVaultPreferences, VaultError } from "./types.ts";
import type { VaultPreferences, VaultStatus } from "./types.ts";
import type { VaultArguments, VaultMethod, VaultReply, VaultResult } from "./protocol.ts";
import { isResponseProgress, isResponseValue, isJsonResponseStream, isResponseStreamProfile, streamLimits, type ResponseProgressCallback, type ResponseValueCallback } from "../workflow-response-stream.ts";
import type { NativeProgressCallback, NativeDecision } from "../native-agent-contract.ts";
import { nativeRuntimeLimits } from "../native-runtime-contract.ts";
import { isNativeFilesystemWatchValue, type NativeFilesystemWatchCallback } from '../native-filesystem-watch.ts';
import { isNativeCommandValue, type NativeCommandCallback } from '../native-command.ts';
import { canStartVaultRequest } from './request-policy.ts';
import { NativeReferenceContinuations } from './native-reference-continuations.ts';
import type { NativeRuntimeReference } from './native-runtime-config.ts';

let worker: Worker | undefined;
let release: (() => void) | undefined;
let generation = 0;
let accessActive = false;
let sequence = 0;
let preferences: VaultPreferences = { ...defaultVaultPreferences };
let ceremony: AbortController | undefined;
let connectionMetadata = Promise.resolve();
const nativeReferences = new NativeReferenceContinuations();
const nativeExecutionMethods = new Set<VaultMethod>(['executeNativeRuntime', 'executeNativeAccount', 'executeNativeInitialize', 'executeNativeQuery', 'executeNativeFeedback', 'executeNativeMcpOAuth', 'executeNativeWatch', 'executeNativeUnwatch', 'executeNativeCommand', 'controlNativeCommand', 'cancelNativeAccountLogin', 'cancelNativeGatewayLogin', 'controlNativeTurn']);
export const currentNativeReference = (reference: NativeRuntimeReference): NativeRuntimeReference => nativeReferences.resolve(reference);
const listeners = new Set<() => void>();
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void;
  cleanup: () => void; generation: number; method: VaultMethod; nativeProgress: NativeProgressCallback | undefined;
  commandValue: NativeCommandCallback | undefined; commandConnection: string | undefined; commandToken?: string;
  nativeConnection: string | undefined; nativeTokens: Set<string>;
  nativeReference: NativeRuntimeReference | undefined;
  nativeValue: NativeFilesystemWatchCallback | undefined; progress: ResponseProgressCallback | undefined; value: ResponseValueCallback | undefined }>();
const channel = typeof BroadcastChannel === "undefined" ? undefined : new BroadcastChannel("operations-secret-vault");
const lifecycle = createVaultLifecycle({ now: () => Date.now(), onLock: () => lockVaultLocally(),
  onDeadline: expires => worker?.postMessage({ kind: "policy", expires }), preferences });
const visible = () => typeof document !== "undefined" && document.visibilityState === "visible";

export function subscribeVaultLock(listener: () => void): () => void {
  listeners.add(listener); return () => listeners.delete(listener);
}

export function lockVaultLocally(): void {
  generation++; accessActive = false; ceremony?.abort(); ceremony = undefined;
  worker?.terminate(); worker = undefined; release?.(); release = undefined;
  lifecycle.deactivate();
  for (const item of pending.values()) { item.cleanup(); item.reject(new VaultError("CANCELLED")); }
  pending.clear();
  nativeReferences.clear();
  for (const listener of listeners) listener();
}

export async function lockVault(): Promise<void> {
  lockVaultLocally();
  await createVaultStorage().lock();
  channel?.postMessage({ kind: "lock" });
}

/** Schema replacement cancels accepted work; descriptor fingerprints prevent reusing stale grants. */
export function invalidateVaultExecution(): void {
  lockVaultLocally(); channel?.postMessage({ kind: "lock" });
}

export function configureVaultIdle(next: VaultPreferences): void {
  lifecycle.configure(next);
  preferences = { ...next };
}

export async function saveVaultPreferences(next: VaultPreferences): Promise<void> {
  const valid = validateVaultPreferences(next);
  try { await saveSetting("vaultPreferences", valid); }
  catch { throw new VaultError("UNAVAILABLE"); }
  configureVaultIdle(valid); channel?.postMessage({ kind: "preferences" });
}
export async function loadVaultPreferences(): Promise<VaultPreferences> {
  try { return await readVaultPreferences(); }
  catch { throw new VaultError("UNAVAILABLE"); }
}

function ensureWorker(): Worker {
  if (worker) {
    if (accessActive && !lifecycle.check()) throw new VaultError("LOCKED");
    return worker;
  }
  let created: Worker | undefined;
  try {
    created = new VaultWorker({ name: "operations-secret-vault" });
    release = trackApplicationWorker(created, { reportErrors: false });
  } catch {
    // No command or key has reached this new worker. Preserve the caller's
    // generation so its safe startup error can still be shown in the UI.
    created?.terminate(); release?.(); release = undefined;
    throw new VaultError("UNAVAILABLE");
  }
  worker = created;
  created.onmessage = ({ data }: MessageEvent<VaultReply>) => {
    if (created !== worker) return;
    if ("event" in data) {
      if (data.event === "locked") lockVaultLocally();
      else if (data.event === "response-progress") {
        const item = pending.get(data.id);
        if (item && item.generation === generation && isResponseProgress(data.progress)) {
          if (accessActive && !lifecycle.check()) { lockVaultLocally(); return; }
          item.progress?.({ bytes: data.progress.bytes, events: data.progress.events });
        }
      }
      else if (data.event === "response-value") {
        const item = pending.get(data.id);
        if (item && item.method === "execute" && item.generation === generation && isResponseValue(data.value)) {
          if (accessActive && !lifecycle.check()) { lockVaultLocally(); return; }
          item.value?.(data.value);
        }
      }
      else if (data.event === "native-progress") {
        const item = pending.get(data.id);
        if (item && item.generation === generation && ["loginNativeRuntime", "executeNativeRuntime", "executeNativeMcpOAuth", "executeNativeCommand"].includes(item.method)) {
          if (accessActive && !lifecycle.check()) { lockVaultLocally(); return; }
          if (item.method === 'executeNativeCommand' && data.progress.kind === 'command-approval') item.commandToken = data.progress.token;
          if (item.method === 'executeNativeRuntime') {
            if (data.progress.kind === 'approval') item.nativeTokens.add(data.progress.interaction.token);
            if (data.progress.kind === 'account-action-approval') item.nativeTokens.add(data.progress.token);
            if (data.progress.kind === 'shell-approval') item.nativeTokens.add(data.progress.token);
            if (data.progress.kind === 'guardian-approval') item.nativeTokens.add(data.progress.token);
          }
          item.nativeProgress?.(data.progress);
        }
      }
      else if (data.event === 'command-value') {
        const item = pending.get(data.id);
        if (item && item.method === 'executeNativeCommand' && item.generation === generation && isNativeCommandValue(data.value)) {
          if (accessActive && !lifecycle.check()) { lockVaultLocally(); return; }
          item.commandValue?.(data.value);
        }
      }
      else if (data.event === 'native-value') {
        const item = pending.get(data.id);
        if (item && item.method === 'executeNativeWatch' && item.generation === generation && isNativeFilesystemWatchValue(data.value)) {
          if (accessActive && !lifecycle.check()) { lockVaultLocally(); return; }
          item.nativeValue?.(data.value);
        }
      }
      return;
    }
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id); item.cleanup();
    if (item.generation !== generation) { item.reject(new VaultError("CANCELLED")); return; }
    if (accessActive && !lifecycle.check()) { item.reject(new VaultError("LOCKED")); return; }
    if (data.ok) {
      if (data.nativeReference) {
        try {
          if (item.method !== 'executeNativeRuntime' || !item.nativeReference) throw new VaultError('AUTHORIZATION');
          const transition = nativeReferences.accept(item.nativeReference, data.nativeReference);
          if (transition.after.revision !== transition.before.revision) channel?.postMessage({ kind: 'lock' });
        } catch { item.reject(new VaultError('AUTHORIZATION')); lockVaultLocally(); return; }
      }
      item.resolve(data.value);
    }
    else if (data.error.kind === "field") item.reject(new InputValidationError(data.error.field, data.error.message));
    else if (data.error.kind === "response") item.reject(new WorkflowResponseError(data.error.message, data.error.response));
    else item.reject(new VaultError(data.error.code));
  };
  created.onerror = event => { event.preventDefault(); lockVaultLocally(); };
  created.onmessageerror = () => lockVaultLocally();
  return created;
}

const mutations = new Set<VaultMethod>(["confirmCreate", "put", "remove", "grant", "revoke", "putConnection", "removeConnection", "completeGitlabOAuth", "completeAtprotoOAuth", "completeJiraOAuth", "pairNativeRuntime", "pairDockerHost", "enableNativeWorkflow", "loginNativeRuntime", "restore", "addMethod", "removeMethod", "rotate"]);
export async function vaultCall<M extends VaultMethod>(method: M, args: VaultArguments<M>, signal?: AbortSignal, onProgress?: ResponseProgressCallback,
  onNativeProgress?: NativeProgressCallback, onValue?: ResponseValueCallback, onNativeValue?: NativeFilesystemWatchCallback, onCommandValue?: NativeCommandCallback): Promise<VaultResult<M>> {
  if (signal?.aborted) throw new VaultError("CANCELLED");
  const requestGeneration = generation;
  if (method !== "nativeConnections" && method !== "dockerConnections") await connectionMetadata;
  configureVaultIdle(await loadVaultPreferences());
  if (requestGeneration !== generation || signal?.aborted) throw new VaultError("CANCELLED");
  const target = ensureWorker();
  if (!canStartVaultRequest([...pending.values()].map(item => item.method), method)) throw new VaultError('CONFLICT');
  const dispatchArgs: unknown[] = [...args];
  const nativeReference = nativeExecutionMethods.has(method) ? nativeReferences.resolve(dispatchArgs[0]) : undefined;
  if (nativeReference) dispatchArgs[0] = nativeReference;
  const id = ++sequence;
  const result = await new Promise<unknown>((resolve, reject) => {
    const watch = method === 'executeNativeWatch';
    const native = method === "loginNativeRuntime" || method === "executeNativeRuntime" || method === "executeNativeMcpOAuth" || method === "executeNativeCommand";
    let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      if (native || watch || method === 'controlNativeCommand' || method === 'cancelNativeAccountLogin' || method === 'cancelNativeGatewayLogin' || method === 'controlNativeTurn' || method === 'executeNativeUnwatch' || method === "executeDockerRead" || method === "executeNativeAccount" || method === "executeNativeInitialize" || method === "executeNativeQuery" || method === "executeNativeFeedback") {
        const item = pending.get(id); if (item) { item.nativeProgress = undefined; item.nativeValue = undefined; item.commandValue = undefined; }
        target.postMessage({ kind: "cancel", id }); cancellationTimer = setTimeout(lockVaultLocally, 2500); return;
      }
      // Termination also interrupts a KDF that cannot process a queued abort message.
      lockVaultLocally();
    };
    const stream = method === "execute" && isResponseStreamProfile((args[0] as { operation?: { responseStream?: unknown } })?.operation?.responseStream);
    const longLived = method === "execute" && isJsonResponseStream((args[0] as { operation?: { responseStream?: import("../workflow-response-stream.ts").ResponseStreamProfile } })?.operation?.responseStream);
    const timer = longLived ? undefined : setTimeout(() => lockVaultLocally(), native || watch ? nativeRuntimeLimits.sessionMs + 10_000 : method === "executeNativeFeedback" ? 340_000 : stream ? streamLimits.runMs + 30_000 : 30_000);
    const cleanup = () => { clearTimeout(timer); clearTimeout(cancellationTimer); signal?.removeEventListener("abort", cancel); };
    pending.set(id, { resolve, reject, cleanup, generation, method, nativeReference, nativeConnection: method === 'executeNativeRuntime' ? (args[0] as { id: string }).id : undefined, nativeTokens: new Set(), commandValue: method === 'executeNativeCommand' ? onCommandValue : undefined, commandConnection: method === 'executeNativeCommand' ? (args[0] as { id: string }).id : undefined, nativeProgress: native ? onNativeProgress : undefined,
      nativeValue: watch ? onNativeValue : undefined, progress: method === "execute" ? onProgress : undefined, value: method === "execute" ? onValue : undefined });
    signal?.addEventListener("abort", cancel, { once: true });
    try { target.postMessage({ id, method, args: dispatchArgs }); }
    catch { pending.delete(id); cleanup(); reject(new VaultError("UNAVAILABLE")); lockVaultLocally(); }
  });
  if (["unlock", "prepareCreate", "confirmCreate", "restore"].includes(method)) { accessActive = true; lifecycle.activate(); }
  if (['checkNativeRuntime', 'enableNativeWorkflow', 'loginNativeRuntime', 'disconnectNativeRuntime'].includes(method)) {
    const selected = args[0] as NativeRuntimeReference; nativeReferences.clear(selected.id);
  }
  if (mutations.has(method) || method === "disconnectDockerHost" && args[1] === true) channel?.postMessage({ kind: "lock" });
  return result as VaultResult<M>;
}

/** Settings panes share one private worker; serialize their initial metadata reads. */
export function readVaultConnections<M extends "nativeConnections" | "dockerConnections">(method: M): Promise<VaultResult<M>> {
  const expected = generation;
  const result = connectionMetadata.then(() => {
    if (expected !== generation) throw new VaultError("CANCELLED");
    return vaultCall(method, [] as VaultArguments<M>);
  });
  connectionMetadata = result.then(() => {}, () => {}); return result;
}

export function replyNativeInteraction(connectionId: string, token: string, decision: NativeDecision): void {
  const item = [...pending].find(([, value]) => value.method === "executeNativeRuntime" && value.generation === generation && value.nativeConnection === connectionId && value.nativeTokens.has(token));
  if (!item || !worker || !accessActive || !lifecycle.check()) throw new VaultError("PERMISSION");
  item[1].nativeTokens.delete(token); worker.postMessage({ kind: "native-reply", id: item[0], connectionId, token, decision });
}

export function replyNativeCommand(connectionId: string, token: string, decision: NativeDecision): void {
  const item = [...pending].find(([, value]) => value.method === 'executeNativeCommand' && value.generation === generation && value.commandConnection === connectionId && value.commandToken === token);
  if (!item || !worker || !accessActive || !lifecycle.check()) throw new VaultError('PERMISSION');
  delete item[1].commandToken; worker.postMessage({ kind: 'command-reply', id: item[0], connectionId, token, decision });
}

/** The caller gets PRF material only for immediate transfer to the worker; never a reusable store. */
export async function vaultCeremony<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  ceremony?.abort();
  const controller = new AbortController(); ceremony = controller;
  const requestGeneration = generation;
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const value = await run(controller.signal);
    if (controller.signal.aborted || requestGeneration !== generation) throw new VaultError("CANCELLED");
    return value;
  } finally { clearTimeout(timer); if (ceremony === controller) ceremony = undefined; }
}

if (typeof document !== "undefined") {
  const visibility = () => { if (visible()) lifecycle.check(); };
  const activity = (event: Event) => lifecycle.activity(event.isTrusted, visible());
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", lockVaultLocally);
  for (const type of ["pointerdown", "keydown", "wheel", "input"]) document.addEventListener(type, activity, { passive: true });
  channel?.addEventListener("message", event => {
    if (event.data?.kind === "lock") lockVaultLocally();
    else if (event.data?.kind === "preferences") void loadVaultPreferences().then(configureVaultIdle, () => lockVaultLocally());
  });
  import.meta.hot?.dispose(() => {
    lockVaultLocally(); channel?.close();
    document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", lockVaultLocally);
    for (const type of ["pointerdown", "keydown", "wheel", "input"]) document.removeEventListener(type, activity);
  });
}
let statusPending: Promise<VaultStatus> | undefined;
export function readVaultStatus(): Promise<VaultStatus> {
  if (statusPending) return statusPending;
  const pending = vaultCall("status", []);
  statusPending = pending;
  void pending.finally(() => { if (statusPending === pending) statusPending = undefined; }).catch(() => {});
  return pending;
}
export const readVaultKeys = async () => publicVaultKeys(await createVaultStorage().read());
