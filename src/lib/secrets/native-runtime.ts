// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeIdentity, nativeObject, nativeScope, sameNativeIdentity, nativeRuntimeProfile as profile,
  nativeRuntimeVersion as version, nativeRuntimeLimits as limits, type NativeRuntimeIdentity, type NativeRuntimeScope } from "../native-runtime-contract.ts";
import { nativeHost, type NativeRuntimeConnection } from "./native-runtime-config.ts";
import { VaultError } from "./types.ts";
import type { NativeAgentMethod, NativeRpcId } from "../native-agent-contract.ts";

export type NativeRuntimeRuntime = { fetch?: typeof fetch; WebSocket?: typeof WebSocket; now?: () => number; requestMs?: number };
type Summary = { accountType: NativeRuntimeConnection["accountType"]; requiresOpenaiAuth: boolean };
export type NativePeer = { identity: NativeRuntimeIdentity; expiresAt: number; socket: WebSocket; scope: NativeRuntimeScope;
  request: (method: NativeAgentMethod, params: unknown, signal?: AbortSignal) => Promise<unknown>;
  reply: (id: NativeRpcId, result: unknown) => void; notify: () => void; close: () => void };
type NativeEvents = { frame: (frame: Record<string, unknown>, identity: NativeRuntimeIdentity) => boolean; closed: () => void };
async function readJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body || response.headers.get("content-type")?.split(";")[0] !== "application/json") throw new VaultError("AUTHORIZATION");
  const reader = response.body.getReader(), parts: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > 8192) throw new VaultError("LIMIT"); parts.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally { try { await reader.cancel(); } catch { /* The network can already be closed. */ } reader.releaseLock(); }
}

/** Owns tickets, private sockets and native responses. No raw frame reaches page state. */
export class NativeRuntimeBroker {
  private readonly runtime: NativeRuntimeRuntime;
  private readonly peers = new Map<string, { peer: NativePeer; key: string; fingerprint: string }>();
  private readonly opening = new Map<string, AbortController>();
  constructor(runtime: NativeRuntimeRuntime = {}) { this.runtime = runtime; }
  connected(id: string): boolean { const peer = this.peers.get(id)?.peer; return !!peer && peer.socket.readyState === 1 && peer.expiresAt > (this.runtime.now ?? Date.now)(); }
  close(id: string): void {
    const current = this.peers.get(id); this.peers.delete(id); current?.peer.close();
    const opening = this.opening.get(id); this.opening.delete(id); opening?.abort();
  }
  clear(): void { for (const id of new Set([...this.peers.keys(), ...this.opening.keys()])) this.close(id); }

  private async open(host: string, key: string, scope: NativeRuntimeScope, expected: NativeRuntimeIdentity | undefined,
    guard: () => Promise<void>, signal?: AbortSignal, events?: NativeEvents): Promise<NativePeer> {
    if (!/^[A-Za-z0-9_-]{43,256}$/.test(key) || signal?.aborted) throw new VaultError(signal?.aborted ? "CANCELLED" : "INVALID");
    const now = this.runtime.now ?? Date.now, timeoutMs = this.runtime.requestMs ?? limits.requestMs;
    const timeout = AbortSignal.timeout(timeoutMs), cancellation = signal ? AbortSignal.any([signal, timeout]) : timeout;
    await guard();
    let response: Response;
    try {
      const deadline = now() + 1800;
      do {
        response = await (this.runtime.fetch ?? fetch)(nativeHost(host) + "/v1/codex/tickets", { method: "POST", redirect: "error", credentials: "omit",
          headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ profile, version, scope }), signal: cancellation });
        if (response.status !== 409 || !events || now() >= deadline || cancellation.aborted) break;
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, 100)); await guard();
      } while (!cancellation.aborted);
    } catch { throw new VaultError(signal?.aborted ? "CANCELLED" : "NETWORK"); }
    let ticket: string, identity: NativeRuntimeIdentity;
    try {
      const data = nativeObject(await readJson(response), ["ticket", "expiresAt", "identity"]);
      if (typeof data.ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.ticket) || !Number.isSafeInteger(data.expiresAt)
        || (data.expiresAt as number) <= now() || (data.expiresAt as number) > now() + limits.ticketMs) throw new Error();
      ticket = data.ticket; identity = nativeIdentity(data.identity);
      if (expected && !sameNativeIdentity(expected, identity)) throw new Error();
    } catch { throw new VaultError("AUTHORIZATION"); }
    await guard(); if (cancellation.aborted) throw new VaultError(signal?.aborted ? "CANCELLED" : "NETWORK");
    const Socket = this.runtime.WebSocket ?? WebSocket, socket = new Socket(nativeHost(host).replace(/^https:/, "wss:") + "/v1/codex/socket");
    const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: VaultError) => void; cleanup: () => void }>();
    let expiresAt = 0, expiry: ReturnType<typeof setTimeout> | undefined, disposed = false;
    let pairResolve: (() => void) | undefined, pairReject: ((error: VaultError) => void) | undefined;
    const close = () => {
      if (disposed) return; disposed = true; clearTimeout(expiry);
      for (const item of pending.values()) { item.cleanup(); item.reject(new VaultError("NETWORK")); } pending.clear();
      pairReject?.(new VaultError("AUTHORIZATION"));
      events?.closed();
      try { socket.close(1000, "Connection closed"); } catch { /* Connecting/closed sockets can already be unavailable. */ }
    };
    const send = (frame: unknown) => {
      const text = JSON.stringify(frame);
      if (disposed || socket.readyState !== 1 || socket.bufferedAmount > limits.frame || new TextEncoder().encode(text).byteLength > limits.frame) throw new VaultError("NETWORK");
      socket.send(text);
    };
    socket.addEventListener("close", close); socket.addEventListener("error", close);
    socket.addEventListener("message", event => {
      try {
        if (typeof event.data !== "string" || new TextEncoder().encode(event.data).byteLength > limits.frame || event.data.includes(key)) throw new Error();
        const frame = JSON.parse(event.data);
        if (!expiresAt) {
          nativeObject(frame, ["type", "profile", "identity", "scope", "expiresAt"]);
          const pairedScope = nativeScope(frame.scope);
          if (frame.type !== "paired" || frame.profile !== profile || !sameNativeIdentity(identity, nativeIdentity(frame.identity))
            || pairedScope.connectionId !== scope.connectionId || pairedScope.method !== scope.method || pairedScope.fingerprint !== scope.fingerprint || !Number.isSafeInteger(frame.expiresAt)
            || frame.expiresAt <= now() || frame.expiresAt > now() + limits.sessionMs) throw new Error();
          expiresAt = frame.expiresAt; expiry = setTimeout(close, expiresAt - now()); pairResolve?.(); return;
        }
        if (now() >= expiresAt) throw new Error();
        if (events && (frame.method !== undefined || frame.type === "authority") && events.frame(frame, identity)) {
          if (frame.type === "authority") {
            const next = nativeIdentity(frame.identity);
            if (!sameNativeIdentity(identity, { ...next, accountEpoch: identity.accountEpoch })) throw new Error();
            Object.assign(identity, next);
          }
          return;
        }
        if (frame.method !== undefined || typeof frame.id !== "string" || !pending.has(frame.id)
          || Object.hasOwn(frame, "result") === Object.hasOwn(frame, "error")) throw new Error();
        const item = pending.get(frame.id)!; pending.delete(frame.id); item.cleanup();
        if (Object.hasOwn(frame, "error")) item.reject(new VaultError(events ? "NATIVE_FAILED" : "AUTHORIZATION")); else item.resolve(frame.result);
      } catch { close(); }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        pairResolve = resolve; pairReject = reject;
        const timer = setTimeout(() => { reject(new VaultError("NETWORK")); close(); }, Math.min(timeoutMs, limits.pairingMs));
        const cancelled = () => { reject(new VaultError("CANCELLED")); close(); };
        cancellation.addEventListener("abort", cancelled, { once: true });
        const cleanup = () => { clearTimeout(timer); cancellation.removeEventListener("abort", cancelled); };
        pairResolve = () => { cleanup(); resolve(); }; pairReject = error => { cleanup(); reject(error); };
        socket.addEventListener("open", () => { try { send({ type: "pair", ticket }); ticket = ""; } catch { close(); } }, { once: true });
        if (cancellation.aborted) cancelled();
      });
      pairResolve = undefined; pairReject = undefined; await guard();
      if (disposed || cancellation.aborted) throw new VaultError(signal?.aborted ? "CANCELLED" : "NETWORK");
      return { identity, expiresAt, socket, scope, close, notify: () => send({ method: "initialized" }), reply: (id, result) => send({ id, result }),
        request: async (method, params, signal) => {
          await guard(); if (disposed || now() >= expiresAt || signal?.aborted) { close(); throw new VaultError(signal?.aborted ? "CANCELLED" : "AUTHORIZATION"); }
          if (pending.size >= limits.pending) throw new VaultError("LIMIT");
          const id = "r_" + crypto.randomUUID();
          return new Promise<unknown>((resolve, reject) => {
            const cancel = () => {
              if (pending.has(id)) { try { send({ type: "cancel", id }); } catch { /* Disconnect still revokes this transport. */ } }
              pending.delete(id); cleanup(); reject(new VaultError("CANCELLED")); close();
            };
            const timer = setTimeout(() => { pending.delete(id); cleanup(); reject(new VaultError("NETWORK")); close(); }, timeoutMs);
            const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
            pending.set(id, { resolve, reject, cleanup }); signal?.addEventListener("abort", cancel, { once: true });
            try { send({ id, method, params }); if (signal?.aborted) cancel(); } catch { close(); }
          });
        } };
    } catch (error) { close(); throw error; }
  }

  /** Upgrade only the selected owner; ticket retries never replay native calls. */
  async agent(id: string, host: string, key: string, fingerprint: string, expected: NativeRuntimeIdentity,
    guard: () => Promise<void>, events: NativeEvents, signal?: AbortSignal): Promise<NativePeer> {
    const current = this.peers.get(id);
    if (current?.peer.scope.method === "codex-workflow" && current.key === key && current.fingerprint === fingerprint
      && this.connected(id) && sameNativeIdentity(expected, current.peer.identity)) { await guard(); return current.peer; }
    this.close(id);
    if (new Set([...this.peers.keys(), ...this.opening.keys(), id]).size > 4) throw new VaultError("LIMIT");
    const opening = new AbortController(); this.opening.set(id, opening);
    signal = signal ? AbortSignal.any([signal, opening.signal]) : opening.signal;
    let peer: NativePeer | undefined;
    try {
      peer = await this.open(host, key, { connectionId: id, method: "codex-workflow", fingerprint }, expected, guard, signal, events);
      await peer.request("initialize", { clientInfo: { name: "operations", version: "1" }, capabilities: { experimentalApi: false } }, signal);
      peer.notify(); await guard();
      this.peers.set(id, { peer, key, fingerprint }); return peer;
    } catch (error) { peer?.close(); this.peers.delete(id); throw error; }
    finally { if (this.opening.get(id) === opening) this.opening.delete(id); }
  }

  async check(id: string, host: string, key: string, fingerprint: string, expected: NativeRuntimeIdentity | undefined,
    guard: () => Promise<void>, signal?: AbortSignal): Promise<{ identity: NativeRuntimeIdentity; accountType: Summary["accountType"]; requiresOpenaiAuth: boolean }> {
    const current = this.peers.get(id);
    let peer = current?.peer;
    if (this.opening.has(id)) throw new VaultError("CONFLICT");
    if (peer && (current!.key !== key || current!.fingerprint !== fingerprint || !this.connected(id)
      || expected && !sameNativeIdentity(expected, peer.identity))) { this.close(id); peer = undefined; }
    if (new Set([...this.peers.keys(), ...this.opening.keys(), id]).size > 4) throw new VaultError("LIMIT");
    const opening = new AbortController(); this.opening.set(id, opening);
    signal = signal ? AbortSignal.any([signal, opening.signal]) : opening.signal;
    try {
      if (!peer) {
        if (this.peers.size >= 4) throw new VaultError("LIMIT");
        peer = await this.open(host, key, { connectionId: id, method: "account/read", fingerprint }, expected, guard, signal);
        await peer.request("initialize", { clientInfo: { name: "operations", version: "1" }, capabilities: { experimentalApi: false } }, signal);
        peer.notify();
      }
      const result = await peer.request("account/read", { refreshToken: false }, signal);
      if (!result || typeof result !== "object" || Array.isArray(result) || typeof (result as Record<string, unknown>).requiresOpenaiAuth !== "boolean") throw new VaultError("AUTHORIZATION");
      const account = (result as { account?: unknown }).account;
      const type = account === null ? "none" : account && typeof account === "object" && !Array.isArray(account) ? (account as { type?: unknown }).type : undefined;
      if (type !== "none" && type !== "apiKey" && type !== "chatgpt") throw new VaultError("AUTHORIZATION");
      await guard();
      this.peers.set(id, { peer, key, fingerprint });
      return { identity: peer.identity, accountType: type, requiresOpenaiAuth: (result as { requiresOpenaiAuth: boolean }).requiresOpenaiAuth };
    } catch (error) { peer?.close(); this.peers.delete(id); throw error instanceof VaultError ? error : new VaultError("NETWORK"); }
    finally { if (this.opening.get(id) === opening) this.opening.delete(id); }
  }
}
