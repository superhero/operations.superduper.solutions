// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { isNativeAccountActionMethod } from '../native-account-actions.ts';
import { nativeMcpOAuthMethod, nativeMcpOAuthLimits, type NativeMcpOAuthNotice } from '../native-mcp-oauth.ts';
import { NativeMcpOAuthFlow } from './native-mcp-oauth.ts';
import { nativeMcpToolMethod, nativeMcpToolLimits } from '../native-mcp-tool.ts';
import { isNativeMcpReadMethod } from '../native-mcp-read.ts';
import { nativeIdentity, nativeObject, nativeScope, sameNativeIdentity, nativeRuntimeProfile as profile, isNativeStandaloneMethod, isNativeFilesystemMethod, isNativeStandaloneMutationMethod, isNativeSectionMethod, type NativeStandaloneMethod, type NativeStandaloneMutationMethod,
  nativeRuntimeVersion as version, nativeRuntimeLimits as limits, type NativeRuntimeIdentity, type NativeRuntimeScope } from "../native-runtime-contract.ts";
import { nativeHost, type NativeRuntimeConnection } from "./native-runtime-config.ts";
import { VaultError } from "./types.ts";
import type { NativeAgentMethod, NativeRpcId } from "../native-agent-contract.ts";
import { publicNativeAccountResult, type NativeAccountResult } from "../native-account.ts";
import { nativeInitializeParams, publicNativeInitializeResult, type NativeInitializeResult } from "../native-initialize.ts";
import { nativeFeedbackMethod, nativeFeedbackLimits } from "../native-feedback-contract.ts";
import { nativeFilesystemWatchScope, type NativeFilesystemWatchMethod } from "../native-filesystem-watch.ts";
import { nativeCommandScope, type NativeCommandMethod } from '../native-command.ts';
import type { NativeConfigurationWriteMethod } from '../native-configuration-write.ts';
import { isNativeMigrationMethod, type NativeMigrationMethod } from '../native-migration.ts';

export type NativeRuntimeRuntime = { fetch?: typeof fetch; WebSocket?: typeof WebSocket; now?: () => number; requestMs?: number };
type Summary = { accountType: NativeRuntimeConnection["accountType"]; requiresOpenaiAuth: boolean };
export type NativePeer = { identity: NativeRuntimeIdentity; expiresAt: number; socket: WebSocket; scope: NativeRuntimeScope;
  request: (method: NativeAgentMethod | NativeStandaloneMethod | NativeFilesystemWatchMethod | NativeCommandMethod | NativeConfigurationWriteMethod | NativeMigrationMethod | typeof nativeFeedbackMethod, params: unknown, signal?: AbortSignal, requestId?: string) => Promise<unknown>;
  reply: (id: NativeRpcId, result: unknown) => void; notify: () => void; close: () => void };
type NativeEvents = { frame: (frame: Record<string, unknown>, identity: NativeRuntimeIdentity) => boolean; closed: (reason?: 'root-lost') => void };
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
  private readonly watchOpenings = new Map<string, AbortController>();
  private readonly commandOpenings = new Map<string, AbortController>();
  constructor(runtime: NativeRuntimeRuntime = {}) { this.runtime = runtime; }
  connected(id: string): boolean { const peer = this.peers.get(id)?.peer; return !!peer && peer.socket.readyState === 1 && peer.expiresAt > (this.runtime.now ?? Date.now)(); }
  watching(id: string): boolean { return this.watchOpenings.has(id) || this.connected(id) && this.peers.get(id)?.peer.scope.method === nativeFilesystemWatchScope; }
  commanding(id: string): boolean { return this.commandOpenings.has(id) || this.connected(id) && this.peers.get(id)?.peer.scope.method === nativeCommandScope; }
  exclusive(id: string): boolean { return this.watching(id) || this.commanding(id) || this.connected(id) && ['codex-workflow', 'codex-account-auth', 'codex-gateway-oauth', 'codex-account-actions'].includes(String(this.peers.get(id)?.peer.scope.method)); }
  private preserveWatch(id: string): void { if (this.watching(id) || this.commanding(id)) throw new VaultError('CONFLICT'); }
  close(id: string): void {
    const current = this.peers.get(id); this.peers.delete(id); current?.peer.close();
    const opening = this.opening.get(id); this.opening.delete(id); opening?.abort();
    this.watchOpenings.delete(id);
    this.commandOpenings.delete(id);
  }
  clear(): void { for (const id of new Set([...this.peers.keys(), ...this.opening.keys()])) this.close(id); }

  private async open(host: string, key: string, scope: NativeRuntimeScope, expected: NativeRuntimeIdentity | undefined,
    guard: () => Promise<void>, signal: AbortSignal, events?: NativeEvents, retryOwnedClose = false): Promise<NativePeer> {
    if (!/^[A-Za-z0-9_-]{43,256}$/.test(key) || signal?.aborted) throw new VaultError(signal?.aborted ? "CANCELLED" : "INVALID");
    const now = this.runtime.now ?? Date.now, timeoutMs = this.runtime.requestMs ?? limits.requestMs;
    const timeout = AbortSignal.timeout(timeoutMs), cancellation = AbortSignal.any([signal, timeout]);
    await guard();
    let response: Response;
    try {
      const deadline = now() + 1800;
      do {
        response = await (this.runtime.fetch ?? fetch)(nativeHost(host) + "/v1/codex/tickets", { method: "POST", redirect: "error", credentials: "omit",
          headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ profile, version, scope }), signal: cancellation });
        if (response.status !== 409 || !events && !retryOwnedClose || now() >= deadline || cancellation.aborted) break;
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
    const pending = new Map<string, { method: string; resolve: (value: unknown) => void; reject: (error: VaultError) => void; cleanup: () => void }>();
    let expiresAt = 0, expiry: ReturnType<typeof setTimeout> | undefined, disposed = false;
    let pairResolve: (() => void) | undefined, pairReject: ((error: VaultError) => void) | undefined;
    const close = (event?: Event) => {
      if (disposed) return; disposed = true; clearTimeout(expiry);
      for (const item of pending.values()) { item.cleanup(); item.reject(new VaultError("NETWORK")); } pending.clear();
      pairReject?.(new VaultError("AUTHORIZATION"));
      events?.closed(scope.method === nativeFilesystemWatchScope && event && 'code' in event && event.code === 1008
        && 'reason' in event && event.reason === 'Watch root authority lost' ? 'root-lost' : undefined);
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
            if (!sameNativeIdentity(identity, frame.reason === 'configuration' || frame.reason === 'migration'
              ? { ...next, configuration: identity.configuration } : { ...next, accountEpoch: identity.accountEpoch })) throw new Error();
            Object.assign(identity, next);
          }
          return;
        }
        if (frame.method !== undefined || typeof frame.id !== "string" || !pending.has(frame.id)
          || Object.hasOwn(frame, "result") === Object.hasOwn(frame, "error")) throw new Error();
        const item = pending.get(frame.id)!; pending.delete(frame.id); item.cleanup();
        if (Object.hasOwn(frame, "error")) item.reject(new VaultError(scope.method === nativeCommandScope ? "NATIVE_COMMAND" : isNativeMigrationMethod(item.method) ? "NATIVE_MIGRATION" : item.method === nativeMcpOAuthMethod ? "NATIVE_MCP_OAUTH" : item.method === nativeMcpToolMethod ? "NATIVE_MCP_TOOL" : scope.method === nativeFeedbackMethod ? "NATIVE_FEEDBACK" : isNativeMcpReadMethod(scope.method) ? 'NATIVE_MCP_READ' : isNativeSectionMethod(scope.method) ? 'NATIVE_SECTIONS' : scope.method === nativeFilesystemWatchScope || isNativeFilesystemMethod(scope.method) ? "NATIVE_FILESYSTEM" : isNativeStandaloneMethod(scope.method) ? "NATIVE_QUERY" : events ? "NATIVE_FAILED" : "AUTHORIZATION")); else item.resolve(frame.result);
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
        // Cancellation was checked above; listener registration has no intervening await.
      });
      pairResolve = undefined; pairReject = undefined; await guard();
      if (disposed || cancellation.aborted) throw new VaultError(signal?.aborted ? "CANCELLED" : "NETWORK");
      return { identity, expiresAt, socket, scope, close, notify: () => send({ method: "initialized" }), reply: (id, result) => send({ id, result }),
        request: async (method, params, signal, requestId) => {
          await guard(); if (disposed || now() >= expiresAt || signal?.aborted) { close(); throw new VaultError(signal?.aborted ? "CANCELLED" : "AUTHORIZATION"); }
          if (pending.size >= limits.pending) throw new VaultError("LIMIT");
          const id = requestId ?? "r_" + crypto.randomUUID();
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || pending.has(id)) throw new VaultError('INVALID');
          return new Promise<unknown>((resolve, reject) => {
            const cancel = () => {
              // Every terminal path removes this listener before yielding control.
              try { send({ type: "cancel", id }); } catch { /* Disconnect still revokes this transport. */ }
              pending.delete(id); cleanup(); reject(new VaultError("CANCELLED")); close();
            };
            const timer = setTimeout(() => { pending.delete(id); cleanup(); reject(new VaultError("NETWORK")); close(); }, (isNativeAccountActionMethod(method) || method === 'command/exec' || method === 'thread/shellCommand' || method === 'account/gatewayOAuth/login' || method === 'externalAgentConfig/import') ? this.runtime.requestMs ?? limits.sessionMs : method === nativeMcpOAuthMethod ? this.runtime.requestMs ?? nativeMcpOAuthLimits.startMs : method === nativeMcpToolMethod ? this.runtime.requestMs ?? nativeMcpToolLimits.requestMs : method === nativeFeedbackMethod ? this.runtime.requestMs ?? nativeFeedbackLimits.requestMs : timeoutMs);
            const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
            pending.set(id, { method, resolve, reject, cleanup }); signal?.addEventListener("abort", cancel, { once: true });
            try { send({ id, method, params }); } catch { close(); }
          });
        } };
    } catch (error) { close(); throw error; }
  }

  /** Upgrade only the selected owner; ticket retries never replay native calls. */
  async agent(id: string, host: string, key: string, fingerprint: string, expected: NativeRuntimeIdentity,
    guard: () => Promise<void>, events: NativeEvents, signal?: AbortSignal, scope: "codex-workflow" | "codex-account-auth" | "codex-gateway-oauth" | "codex-account-actions" = "codex-workflow"): Promise<NativePeer> {
    this.preserveWatch(id);
    const current = this.peers.get(id);
    if (current?.peer.scope.method === scope && current.key === key && current.fingerprint === fingerprint
      && this.connected(id) && sameNativeIdentity(expected, current.peer.identity)) { await guard(); return current.peer; }
    this.close(id);
    if (new Set([...this.peers.keys(), ...this.opening.keys(), id]).size > 4) throw new VaultError("LIMIT");
    const opening = new AbortController(); this.opening.set(id, opening);
    signal = signal ? AbortSignal.any([signal, opening.signal]) : opening.signal;
    let peer: NativePeer | undefined;
    try {
      peer = await this.open(host, key, { connectionId: id, method: scope, fingerprint }, expected, guard, signal, events);
      await peer.request("initialize", nativeInitializeParams(), signal);
      peer.notify(); await guard();
      this.peers.set(id, { peer, key, fingerprint }); return peer;
    } catch (error) { peer?.close(); this.peers.delete(id); throw error; }
    finally { if (this.opening.get(id) === opening) this.opening.delete(id); }
  }

  private async inspectAccount(id: string, host: string, key: string, fingerprint: string, expected: NativeRuntimeIdentity | undefined,
    guard: () => Promise<void>, signal?: AbortSignal): Promise<Summary & { identity: NativeRuntimeIdentity; result: unknown }> {
    this.preserveWatch(id);
    const current = this.peers.get(id);
    let peer = current?.peer;
    if (this.opening.has(id)) throw new VaultError("CONFLICT");
    const replacing = !!peer && (current!.key !== key || current!.fingerprint !== fingerprint || !this.connected(id)
      || !!expected && !sameNativeIdentity(expected, peer.identity));
    if (replacing) { this.close(id); peer = undefined; }
    if (new Set([...this.peers.keys(), ...this.opening.keys(), id]).size > 4) throw new VaultError("LIMIT");
    const opening = new AbortController(); this.opening.set(id, opening);
    signal = signal ? AbortSignal.any([signal, opening.signal]) : opening.signal;
    try {
      if (!peer) {
        // The union limit above already includes this opening owner.
        peer = await this.open(host, key, { connectionId: id, method: "account/read", fingerprint }, expected, guard, signal, undefined, replacing);
        await peer.request("initialize", nativeInitializeParams(), signal);
        peer.notify();
      }
      const result = await peer.request("account/read", { refreshToken: false }, signal);
      if (!result || typeof result !== "object" || Array.isArray(result) || typeof (result as Record<string, unknown>).requiresOpenaiAuth !== "boolean") throw new VaultError("AUTHORIZATION");
      const account = (result as { account?: unknown }).account;
      const type = account === null || !Object.hasOwn(result, "account") ? "none" : account && typeof account === "object" && !Array.isArray(account) ? (account as { type?: unknown }).type : undefined;
      if (type !== "none" && type !== "apiKey" && type !== "chatgpt") throw new VaultError("AUTHORIZATION");
      await guard();
      this.peers.set(id, { peer, key, fingerprint });
      return { identity: peer.identity, accountType: type, requiresOpenaiAuth: (result as { requiresOpenaiAuth: boolean }).requiresOpenaiAuth, result };
    } catch (error) { peer?.close(); this.peers.delete(id); throw error instanceof VaultError ? error : new VaultError("NETWORK"); }
    finally { if (this.opening.get(id) === opening) this.opening.delete(id); }
  }
  async check(id: string, host: string, key: string, fingerprint: string, expected: NativeRuntimeIdentity | undefined,
    guard: () => Promise<void>, signal?: AbortSignal): Promise<Summary & { identity: NativeRuntimeIdentity }> {
    const { identity, accountType, requiresOpenaiAuth } = await this.inspectAccount(id, host, key, fingerprint, expected, guard, signal);
    return { identity, accountType, requiresOpenaiAuth };
  }
  async readAccount(id: string, host: string, key: string, fingerprint: string, expected: NativeRuntimeIdentity,
    guard: () => Promise<void>, signal?: AbortSignal): Promise<NativeAccountResult> {
    this.preserveWatch(id);
    try {
      const value = await this.inspectAccount(id, host, key, fingerprint, expected, guard, signal);
      const result = publicNativeAccountResult(value.result);
      await guard(); return result;
    } catch (error) { this.close(id); throw error instanceof VaultError ? error : new VaultError("AUTHORIZATION"); }
  }

  async initialize(id: string, host: string, key: string, fingerprint: string, expected: NativeRuntimeIdentity,
    input: unknown, guard: () => Promise<void>, signal?: AbortSignal): Promise<NativeInitializeResult> {
    this.preserveWatch(id);
    const params = nativeInitializeParams(input);
    if (this.opening.has(id)) throw new VaultError("CONFLICT");
    this.close(id);
    if (new Set([...this.peers.keys(), ...this.opening.keys(), id]).size > 4) throw new VaultError("LIMIT");
    const opening = new AbortController(); this.opening.set(id, opening);
    const cancellation = signal ? AbortSignal.any([signal, opening.signal]) : opening.signal;
    let peer: NativePeer | undefined;
    try {
      // initialize is one handshake on a new owned child, never a replay on the
      // previous read/agent connection. Busy retries precede native dispatch.
      peer = await this.open(host, key, { connectionId: id, method: "initialize", fingerprint }, expected, guard, cancellation, undefined, true);
      const result = publicNativeInitializeResult(await peer.request("initialize", params, cancellation));
      peer.notify(); await guard();
      this.peers.set(id, { peer, key, fingerprint }); return result;
    } catch (error) { peer?.close(); throw error instanceof VaultError ? error : new VaultError("AUTHORIZATION"); }
    finally { if (this.opening.get(id) === opening) this.opening.delete(id); }
  }

  async query(id: string, host: string, key: string, fingerprint: string, expected: NativeRuntimeIdentity,
    method: NativeStandaloneMethod, params: Record<string, unknown>, guard: () => Promise<void>, signal?: AbortSignal): Promise<unknown> {
    this.preserveWatch(id);
    if (isNativeStandaloneMutationMethod(method)) return this.isolated(id, host, key, fingerprint, expected, method, params, guard, signal);
    if (this.opening.has(id)) throw new VaultError('CONFLICT');
    const current = this.peers.get(id);
    let peer = current?.peer;
    if (peer && (peer.scope.method !== method || current!.fingerprint !== fingerprint || current!.key !== key
      || !this.connected(id) || !sameNativeIdentity(peer.identity, expected))) { this.close(id); peer = undefined; }
    if (new Set([...this.peers.keys(), ...this.opening.keys(), id]).size > 4) throw new VaultError('LIMIT');
    const opening = new AbortController(); this.opening.set(id, opening);
    const cancellation = signal ? AbortSignal.any([signal, opening.signal]) : opening.signal;
    try {
      if (!peer) {
        peer = await this.open(host, key, { connectionId: id, method, fingerprint }, expected, guard, cancellation, undefined, true);
        await peer.request('initialize', nativeInitializeParams(), cancellation); peer.notify();
      }
      const result = await peer.request(method, params, cancellation); await guard();
      this.peers.set(id, { peer, key, fingerprint }); return result;
    } catch (error) {
      peer?.close(); this.peers.delete(id);
      if (error instanceof VaultError && !['AUTHORIZATION', 'NETWORK'].includes(error.code)) throw error;
      throw new VaultError(cancellation.aborted ? 'CANCELLED' : isNativeMcpReadMethod(method) ? 'NATIVE_MCP_READ' : isNativeSectionMethod(method) ? 'NATIVE_SECTIONS' : isNativeFilesystemMethod(method) ? 'NATIVE_FILESYSTEM' : 'NATIVE_QUERY');
    } finally { if (this.opening.get(id) === opening) this.opening.delete(id); }
  }

  /** One owned child and one mutation. Never cache or replay a side-effecting RPC. */
  async mcpOAuth(id: string, host: string, key: string, fingerprint: string, expected: NativeRuntimeIdentity,
    params: Record<string, unknown>, guard: () => Promise<void>, signal?: AbortSignal,
    progress?: (notice: NativeMcpOAuthNotice) => void): Promise<unknown> {
    this.preserveWatch(id);
    if (this.opening.has(id)) throw new VaultError('CONFLICT');
    this.close(id);
    if (new Set([...this.peers.keys(), ...this.opening.keys(), id]).size > 4) throw new VaultError('LIMIT');
    const opening = new AbortController(); this.opening.set(id, opening);
    const cancellation = signal ? AbortSignal.any([signal, opening.signal]) : opening.signal;
    const flow = new NativeMcpOAuthFlow(params); let peer: NativePeer | undefined;
    try {
      peer = await this.open(host, key, { connectionId: id, method: nativeMcpOAuthMethod, fingerprint }, expected, guard, cancellation,
        { frame: frame => flow.frame(frame), closed: () => flow.completion.reject(new VaultError('NATIVE_UNKNOWN')) }, true);
      await peer.request('initialize', nativeInitializeParams(), cancellation); peer.notify();
      return await flow.execute(peer, params, guard, cancellation, progress);
    } catch (error) {
      if (error instanceof VaultError && !['AUTHORIZATION', 'NETWORK'].includes(error.code)) throw error;
      throw new VaultError(cancellation.aborted ? 'CANCELLED' : 'NATIVE_MCP_OAUTH');
    } finally { peer?.close(); if (this.opening.get(id) === opening) this.opening.delete(id); }
  }

  async feedback(id: string, host: string, key: string, fingerprint: string, expected: NativeRuntimeIdentity,
    params: Record<string, unknown>, guard: () => Promise<void>, signal?: AbortSignal): Promise<unknown> {
    return this.isolated(id, host, key, fingerprint, expected, nativeFeedbackMethod, params, guard, signal);
  }

  private async isolated(id: string, host: string, key: string, fingerprint: string, expected: NativeRuntimeIdentity,
    method: typeof nativeFeedbackMethod | NativeStandaloneMutationMethod, params: Record<string, unknown>, guard: () => Promise<void>, signal?: AbortSignal): Promise<unknown> {
    this.preserveWatch(id);
    if (this.opening.has(id)) throw new VaultError('CONFLICT');
    this.close(id);
    if (new Set([...this.peers.keys(), ...this.opening.keys(), id]).size > 4) throw new VaultError('LIMIT');
    const opening = new AbortController(); this.opening.set(id, opening);
    const cancellation = signal ? AbortSignal.any([signal, opening.signal]) : opening.signal;
    let peer: NativePeer | undefined;
    try {
      peer = await this.open(host, key, { connectionId: id, method, fingerprint }, expected, guard, cancellation, undefined, true);
      await peer.request('initialize', nativeInitializeParams(), cancellation); peer.notify();
      const result = await peer.request(method, params, cancellation); await guard(); return result;
    } catch (error) {
      if (error instanceof VaultError && !['AUTHORIZATION', 'NETWORK'].includes(error.code)) throw error;
      throw new VaultError(cancellation.aborted ? 'CANCELLED' : isNativeMcpReadMethod(method) ? 'NATIVE_MCP_READ' : isNativeSectionMethod(method) ? 'NATIVE_SECTIONS' : method === nativeFeedbackMethod ? 'NATIVE_FEEDBACK' : 'NATIVE_FILESYSTEM');
    } finally { peer?.close(); if (this.opening.get(id) === opening) this.opening.delete(id); }
  }

  /** All watch IDs for this owner use one initialized, independently granted peer. */
  async watchChannel(id: string, host: string, key: string, fingerprint: string, expected: NativeRuntimeIdentity,
    guard: () => Promise<void>, events: NativeEvents): Promise<NativePeer> {
    if (this.opening.has(id) || this.commanding(id)) throw new VaultError('CONFLICT');
    const current = this.peers.get(id);
    if (current?.peer.scope.method === nativeFilesystemWatchScope && current.key === key && current.fingerprint === fingerprint
      && this.connected(id) && sameNativeIdentity(current.peer.identity, expected)) { await guard(); return current.peer; }
    if (['codex-workflow', 'codex-account-auth', 'codex-gateway-oauth', 'codex-account-actions'].includes(String(current?.peer.scope.method)) && this.connected(id)) throw new VaultError('CONFLICT');
    this.close(id);
    if (new Set([...this.peers.keys(), ...this.opening.keys(), id]).size > 4) throw new VaultError('LIMIT');
    const opening = new AbortController(); this.opening.set(id, opening); this.watchOpenings.set(id, opening); let peer: NativePeer | undefined;
    try {
      peer = await this.open(host, key, { connectionId: id, method: nativeFilesystemWatchScope, fingerprint }, expected, guard, opening.signal, events, true);
      await peer.request('initialize', nativeInitializeParams(), opening.signal); peer.notify(); await guard();
      this.peers.set(id, { peer, key, fingerprint }); return peer;
    } catch (error) {
      peer?.close(); if (this.peers.get(id)?.peer === peer) this.peers.delete(id);
      throw error instanceof VaultError && !['AUTHORIZATION', 'NETWORK'].includes(error.code) ? error : new VaultError('NATIVE_FILESYSTEM');
    } finally {
      if (this.opening.get(id) === opening) this.opening.delete(id);
      if (this.watchOpenings.get(id) === opening) this.watchOpenings.delete(id);
    }
  }

  async commandChannel(id: string, host: string, key: string, fingerprint: string, expected: NativeRuntimeIdentity,
    guard: () => Promise<void>, events: NativeEvents): Promise<NativePeer> {
    if (this.opening.has(id) || this.watching(id)) throw new VaultError('CONFLICT');
    const current = this.peers.get(id);
    if (current?.peer.scope.method === nativeCommandScope && current.key === key && current.fingerprint === fingerprint
      && this.connected(id) && sameNativeIdentity(current.peer.identity, expected)) { await guard(); return current.peer; }
    if (['codex-workflow', 'codex-account-auth', 'codex-gateway-oauth', 'codex-account-actions'].includes(String(current?.peer.scope.method)) && this.connected(id)) throw new VaultError('CONFLICT');
    this.close(id);
    if (new Set([...this.peers.keys(), ...this.opening.keys(), id]).size > 4) throw new VaultError('LIMIT');
    const opening = new AbortController(); this.opening.set(id, opening); this.commandOpenings.set(id, opening); let peer: NativePeer | undefined;
    try {
      peer = await this.open(host, key, { connectionId: id, method: nativeCommandScope, fingerprint }, expected, guard, opening.signal, events, true);
      await peer.request('initialize', nativeInitializeParams(), opening.signal); peer.notify(); await guard();
      this.peers.set(id, { peer, key, fingerprint }); return peer;
    } catch (error) {
      peer?.close(); if (this.peers.get(id)?.peer === peer) this.peers.delete(id);
      throw error instanceof VaultError && !['AUTHORIZATION', 'NETWORK'].includes(error.code) ? error : new VaultError('NATIVE_COMMAND');
    } finally {
      if (this.opening.get(id) === opening) this.opening.delete(id);
      if (this.commandOpenings.get(id) === opening) this.commandOpenings.delete(id);
    }
  }
}
