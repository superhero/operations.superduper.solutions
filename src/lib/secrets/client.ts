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
import { isResponseProgress, isResponseStreamProfile, streamLimits, type ResponseProgressCallback } from "../workflow-response-stream.ts";

let worker: Worker | undefined;
let release: (() => void) | undefined;
let generation = 0;
let accessActive = false;
let sequence = 0;
let preferences: VaultPreferences = { ...defaultVaultPreferences };
let ceremony: AbortController | undefined;
const listeners = new Set<() => void>();
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void;
  cleanup: () => void; generation: number; progress: ResponseProgressCallback | undefined }>();
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
      return;
    }
    const item = pending.get(data.id);
    if (!item) return;
    pending.delete(data.id); item.cleanup();
    if (item.generation !== generation) { item.reject(new VaultError("CANCELLED")); return; }
    if (accessActive && !lifecycle.check()) { item.reject(new VaultError("LOCKED")); return; }
    if (data.ok) item.resolve(data.value);
    else if (data.error.kind === "field") item.reject(new InputValidationError(data.error.field, data.error.message));
    else if (data.error.kind === "response") item.reject(new WorkflowResponseError(data.error.message, data.error.response));
    else item.reject(new VaultError(data.error.code));
  };
  created.onerror = event => { event.preventDefault(); lockVaultLocally(); };
  created.onmessageerror = () => lockVaultLocally();
  return created;
}

const mutations = new Set<VaultMethod>(["confirmCreate", "put", "remove", "grant", "revoke", "restore", "addMethod", "removeMethod", "rotate"]);
export async function vaultCall<M extends VaultMethod>(method: M, args: VaultArguments<M>, signal?: AbortSignal, onProgress?: ResponseProgressCallback): Promise<VaultResult<M>> {
  if (signal?.aborted) throw new VaultError("CANCELLED");
  const requestGeneration = generation;
  configureVaultIdle(await loadVaultPreferences());
  if (requestGeneration !== generation || signal?.aborted) throw new VaultError("CANCELLED");
  const target = ensureWorker();
  if (pending.size) throw new VaultError("CONFLICT");
  const id = ++sequence;
  const result = await new Promise<unknown>((resolve, reject) => {
    const cancel = () => {
      // Termination also interrupts a KDF that cannot process a queued abort message.
      lockVaultLocally();
    };
    const stream = method === "execute" && isResponseStreamProfile((args[0] as { operation?: { responseStream?: unknown } })?.operation?.responseStream);
    const timer = setTimeout(() => lockVaultLocally(), stream ? streamLimits.runMs + 30_000 : 30_000);
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    pending.set(id, { resolve, reject, cleanup, generation, progress: method === "execute" ? onProgress : undefined });
    signal?.addEventListener("abort", cancel, { once: true });
    try { target.postMessage({ id, method, args }); }
    catch { pending.delete(id); cleanup(); reject(new VaultError("UNAVAILABLE")); lockVaultLocally(); }
  });
  if (["unlock", "prepareCreate", "confirmCreate", "restore"].includes(method)) { accessActive = true; lifecycle.activate(); }
  if (mutations.has(method)) channel?.postMessage({ kind: "lock" });
  return result as VaultResult<M>;
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
