// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeIdentity, nativeObject, sameNativeIdentity, type NativeRuntimeIdentity } from "../native-runtime-contract.ts";
import { nativeLoginParams, nativeWorkflowParams, nativeOwnedId, nativeRpcId,
  type NativeAgentProgress, type NativeDecision, type NativeLoginKind, type NativeProgressCallback, type NativeRpcId,
  type NativeWorkflowMethod } from "../native-agent-contract.ts";
import { NativeRuntimeBroker, type NativePeer } from "./native-runtime.ts";
import type { NativeRuntimeConnection } from "./native-runtime-config.ts";
import { VaultError } from "./types.ts";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {}); return { promise, resolve, reject };
}
type Active = { guard: () => Promise<void>; progress: NativeProgressCallback | undefined; finished: boolean;
  completion: ReturnType<typeof deferred<unknown>>;
  login?: { kind: NativeLoginKind; id?: string; early?: Record<string, unknown>; completed: boolean; confirming: boolean; secret?: string };
  turn?: { threadId: string; id?: string; terminal?: Record<string, unknown> } };
type State = { peer?: NativePeer; closed: boolean; active?: Active; approvals: Map<string, { id: NativeRpcId; turnId: string }> };

function loginUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192) throw new VaultError("AUTHORIZATION");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new VaultError("AUTHORIZATION");
  return url.href;
}

/** Native events remain private; the page receives bounded owned interactions. */
export class NativeAgentBroker {
  private readonly states = new Map<string, State>();
  private readonly transport: NativeRuntimeBroker;
  constructor(transport: NativeRuntimeBroker) { this.transport = transport; }

  private frame(state: State, frame: Record<string, unknown>, identity: NativeRuntimeIdentity): boolean {
    const active = state.active;
    if (!active || active.finished || active.login?.secret && JSON.stringify(frame).includes(active.login.secret)) throw new VaultError("AUTHORIZATION");
    if (frame.type === "authority") {
      nativeObject(frame, ["type", "identity"]);
      const next = nativeIdentity(frame.identity);
      if (!active.login?.completed || !active.login.confirming
        || !sameNativeIdentity(identity, { ...next, accountEpoch: identity.accountEpoch })) throw new VaultError("AUTHORIZATION");
      return true;
    }
    const params = frame.params as Record<string, unknown> | undefined;
    if (frame.method === "account/login/completed") {
      if (!active.login || active.login.kind === "apiKey" || !params || !nativeOwnedId(params.loginId)
        || typeof params.success !== "boolean") throw new VaultError("AUTHORIZATION");
      if (!active.login.id) {
        if (active.login.early) throw new VaultError("AUTHORIZATION"); active.login.early = frame; return true;
      }
      if (params.loginId !== active.login.id || active.login.completed) throw new VaultError("AUTHORIZATION");
      active.login.completed = params.success;
      if (params.success) active.completion.resolve(undefined); else active.completion.reject(new VaultError("AUTHORIZATION"));
      return true;
    }
    if (!active.turn || !params || params.threadId !== active.turn.threadId) throw new VaultError("AUTHORIZATION");
    if (frame.method === "turn/started" || frame.method === "turn/completed") {
      const turn = params.turn as Record<string, unknown> | undefined;
      if (!turn || !nativeOwnedId(turn.id) || active.turn.id && turn.id !== active.turn.id) throw new VaultError("AUTHORIZATION");
      active.turn.id = turn.id;
      if (frame.method === "turn/started") active.progress?.({ kind: "running", threadId: active.turn.threadId, turnId: turn.id });
      else {
        if (active.turn.terminal || !Array.isArray(turn.items) || !["completed", "interrupted", "failed"].includes(String(turn.status))) throw new VaultError("AUTHORIZATION");
        active.turn.terminal = params; state.approvals.clear();
        if (turn.status === "completed") active.completion.resolve(params);
        else active.completion.reject(new VaultError(turn.status === "interrupted" ? "CANCELLED" : "NATIVE_FAILED"));
      }
      return true;
    }
    if (!nativeRpcId(frame.id) || !nativeOwnedId(params.turnId) || params.turnId !== active.turn.id || !nativeOwnedId(params.itemId)
      || state.approvals.size >= 8 || [...state.approvals.values()].some(value => value.id === frame.id)) throw new VaultError("AUTHORIZATION");
    const kind = frame.method === "item/commandExecution/requestApproval" ? "command" : undefined;
    if (!kind || params.grantRoot != null || params.networkApprovalContext != null || params.proposedExecpolicyAmendment != null
      || params.proposedNetworkPolicyAmendments != null || params.environmentId != null || params.kind != null && params.kind !== "command") throw new VaultError("PERMISSION");
    if (kind === "command" && (typeof params.command !== "string" || !params.command.trim())) throw new VaultError("AUTHORIZATION");
    for (const value of [params.command, params.cwd, params.reason])
      if (value != null && (typeof value !== "string" || value.length > 8192)) throw new VaultError("LIMIT");
    const token = crypto.randomUUID(); state.approvals.set(token, { id: frame.id, turnId: params.turnId });
    active.progress?.({ kind: "approval", interaction: { token, kind, threadId: active.turn.threadId, turnId: params.turnId,
      itemId: params.itemId, ...(typeof params.command === "string" ? { command: params.command } : {}),
      ...(typeof params.cwd === "string" ? { cwd: params.cwd } : {}), ...(typeof params.reason === "string" ? { reason: params.reason } : {}) } });
    return true;
  }

  private async connect(connection: NativeRuntimeConnection, key: string, fingerprint: string, guard: () => Promise<void>, signal?: AbortSignal) {
    let state = this.states.get(connection.id);
    if (!state || state.closed) {
      state = { closed: false, approvals: new Map() }; this.states.set(connection.id, state);
    }
    if (state.active) throw new VaultError("CONFLICT");
    const selected = state;
    selected.peer = await this.transport.agent(connection.id, connection.host, key, fingerprint, connection.identity, guard, {
      frame: (frame, identity) => this.frame(selected, frame, identity),
      closed: () => {
        selected.closed = true; selected.approvals.clear(); selected.active?.completion.reject(new VaultError("NATIVE_UNKNOWN"));
        if (this.states.get(connection.id) === selected) this.states.delete(connection.id);
      }
    }, signal);
    if (selected.closed) throw new VaultError("NATIVE_UNKNOWN");
    return selected;
  }

  private begin(state: State, active: Active, signal?: AbortSignal) {
    state.active = active;
    const stop = (error: VaultError) => { active.completion.reject(error); this.transport.close(state.peer!.scope.connectionId); };
    const cancel = () => stop(new VaultError("CANCELLED"));
    const timer = setTimeout(() => stop(new VaultError("NATIVE_UNKNOWN")), Math.max(1, state.peer!.expiresAt - Date.now()));
    signal?.addEventListener("abort", cancel, { once: true }); if (signal?.aborted) cancel();
    return () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); state.approvals.clear(); active.finished = true; delete state.active; };
  }

  async login(connection: NativeRuntimeConnection, key: string, fingerprint: string, input: unknown,
    guard: () => Promise<void>, signal?: AbortSignal, progress?: NativeProgressCallback) {
    const params = nativeLoginParams(input), state = await this.connect(connection, key, fingerprint, guard, signal);
    const login: NonNullable<Active["login"]> = { kind: params.type as NativeLoginKind, completed: false, confirming: false,
      ...(params.type === "apiKey" ? { secret: params.apiKey as string } : {}) };
    const active: Active = { guard, progress, finished: false, completion: deferred(), login }, end = this.begin(state, active, signal);
    try {
      const result = await state.peer!.request("account/login/start", params, signal) as Record<string, unknown>;
      if (!result || result.type !== login.kind) throw new VaultError("AUTHORIZATION");
      if (login.kind === "apiKey") { nativeObject(result, ["type"]); login.completed = true; }
      else {
        if (!nativeOwnedId(result.loginId)) throw new VaultError("AUTHORIZATION"); login.id = result.loginId;
        let notice: NativeAgentProgress;
        if (login.kind === "chatgpt") {
          nativeObject(result, ["type", "loginId", "authUrl"]);
          notice = { kind: "login", login: "chatgpt", loginId: login.id, authUrl: loginUrl(result.authUrl) };
        } else {
          nativeObject(result, ["type", "loginId", "userCode", "verificationUrl"]);
          if (typeof result.userCode !== "string" || !result.userCode.trim() || result.userCode.length > 128) throw new VaultError("AUTHORIZATION");
          notice = { kind: "login", login: "chatgptDeviceCode", loginId: login.id, userCode: result.userCode, verificationUrl: loginUrl(result.verificationUrl) };
        }
        await guard(); progress?.(notice);
        if (login.early) { const early = login.early; delete login.early; this.frame(state, early, state.peer!.identity); }
        await active.completion.promise;
      }
      await guard(); login.confirming = true;
      const summary = await state.peer!.request("account/read", { refreshToken: false }, signal) as Record<string, unknown>;
      const accountType = (summary?.account as { type?: unknown } | null)?.type;
      if (accountType !== (login.kind === "apiKey" ? "apiKey" : "chatgpt") || typeof summary.requiresOpenaiAuth !== "boolean") throw new VaultError("AUTHORIZATION");
      await guard();
      if (signal?.aborted || state.closed) throw new VaultError(signal?.aborted ? "CANCELLED" : "NATIVE_UNKNOWN");
      return { identity: { ...state.peer!.identity }, accountType: accountType as "apiKey" | "chatgpt" };
    } catch (error) { this.transport.close(connection.id); throw signal?.aborted ? new VaultError("CANCELLED")
      : error instanceof VaultError && error.code !== "NETWORK" ? error : new VaultError("NATIVE_UNKNOWN"); }
    finally { delete login.secret; end(); }
  }

  async execute(connection: NativeRuntimeConnection, key: string, fingerprint: string, method: NativeWorkflowMethod,
    input: unknown, guard: () => Promise<void>, signal?: AbortSignal, progress?: NativeProgressCallback): Promise<unknown> {
    const params = nativeWorkflowParams(method, input);
    if (connection.accountType === "none") throw new VaultError("AUTHORIZATION");
    const state = await this.connect(connection, key, fingerprint, guard, signal);
    const active: Active = { guard, progress, finished: false, completion: deferred(),
      ...(method === "turn/start" ? { turn: { threadId: params.threadId as string } } : {}) };
    const end = this.begin(state, active, signal);
    try {
      const result = await state.peer!.request(method, params, signal) as Record<string, unknown>;
      let terminal: unknown = result;
      if (active.turn) {
        const turn = result?.turn as { id?: unknown } | undefined;
        if (!nativeOwnedId(turn?.id) || active.turn.id && active.turn.id !== turn.id) throw new VaultError("AUTHORIZATION");
        active.turn.id = turn.id;
        progress?.({ kind: "running", threadId: active.turn.threadId, turnId: turn.id });
        terminal = await active.completion.promise;
      } else if (!nativeOwnedId((result?.thread as { id?: unknown })?.id)) throw new VaultError("AUTHORIZATION");
      await guard(); if (signal?.aborted || state.closed) throw new VaultError(signal?.aborted ? "CANCELLED" : "NATIVE_UNKNOWN");
      return terminal;
    } catch (error) { this.transport.close(connection.id); throw signal?.aborted ? new VaultError("CANCELLED")
      : error instanceof VaultError && error.code !== "NETWORK" ? error : new VaultError("NATIVE_UNKNOWN"); }
    finally { end(); }
  }

  async reply(connectionId: string, token: string, decision: NativeDecision): Promise<void> {
    const state = this.states.get(connectionId), prompt = state?.approvals.get(token), active = state?.active;
    if (!state || state.closed || !active || active.finished || !prompt || prompt.turnId !== active.turn?.id
      || !["accept", "decline", "cancel"].includes(decision)) throw new VaultError("PERMISSION");
    await active.guard();
    if (state.closed || state.active !== active || !state.approvals.has(token)) throw new VaultError("PERMISSION");
    state.approvals.delete(token); state.peer!.reply(prompt.id, { decision });
  }
}
