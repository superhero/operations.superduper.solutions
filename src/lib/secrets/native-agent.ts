// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { isNativeWindowsSandboxReadinessMethod } from '../native-windows-sandbox.ts';
import { isNativePluginShareMethod, nativePluginShareParams } from '../native-plugin-share.ts';
import { isNativePluginInstallMethod, nativePluginInstallParams } from '../native-plugin-install.ts';
import { isNativeTurnWorkMethod, nativeTurnWorkAcknowledgement } from '../native-turn-work.ts';
import { nativeGuardianMethod, nativeGuardianApprovalMethod, nativeGuardianStarted, nativeGuardianCompleted, NativeGuardianReviews, type NativeGuardianDenial } from '../native-guardian.ts';
import { isNativeAccountReadMethod, nativeAccountReadNeedsChatgpt } from '../native-account-read.ts';
import { publicNativeAccountResult } from '../native-account.ts';
import { isNativeThreadContentMethod, isNativeThreadContentPairedMethod } from '../native-thread-content.ts';
import { isNativeThreadLifecycleMethod } from '../native-thread-lifecycle.ts';
import { nativeMcpOAuthMethod } from '../native-mcp-oauth.ts';
import { NativeMcpOAuthFlow } from './native-mcp-oauth.ts';
import { nativeMcpToolMethod } from '../native-mcp-tool.ts';
import { nativeIdentity, nativeObject, sameNativeIdentity, type NativeRuntimeIdentity } from "../native-runtime-contract.ts";
import { nativeLoginParams, nativeWorkflowParams, nativeOwnedId, nativeRpcId,
  type NativeAgentProgress, type NativeDecision, type NativeLoginKind, type NativeProgressCallback, type NativeRpcId,
  type NativeWorkflowMethod } from "../native-agent-contract.ts";
import { NativeRuntimeBroker, type NativePeer } from "./native-runtime.ts";
import type { NativeRuntimeConnection } from "./native-runtime-config.ts";
import { VaultError } from "./types.ts";
import { nativeThreadShellMethod, nativeThreadShellParams, nativeThreadShellApprovalMethod, nativeThreadShellItem, type NativeThreadShellFrame } from '../native-thread-shell.ts';
import { isNativeMarketplaceMethod, nativeMarketplaceParams } from '../native-marketplace.ts';
import { isNativePluginReadMethod } from '../native-plugin-read.ts';
import { isNativeConfigurationReadMethod } from '../native-configuration-read.ts';
import { isNativeConfigurationControlMethod } from '../native-configuration-control.ts';
import { isNativeConfigurationWriteMethod, nativeConfigurationWriteParams, nativeConfigurationWriteHash, nativeConfigurationTransition,
  type NativeConfigurationMutationMethod, type NativeConfigurationWriteMethod, type NativeConfigurationTransition } from '../native-configuration-write.ts';
import { isNativeMigrationMethod, nativeMigrationParams, nativeMigrationTransition,
  type NativeMigrationMethod, type NativeMigrationTransition } from '../native-migration.ts';
import { publicNativeMigrationResult } from './native-migration.ts';
import { isNativeStoredThreadReadMethod } from '../native-stored-thread.ts';
import { nativeTurnControlParams, nativeTurnControlResult, type NativeTurnControlMethod } from '../native-turn-control.ts';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {}); return { promise, resolve, reject };
}
type Active = { mcp?: NativeMcpOAuthFlow; guard: () => Promise<void>; progress: NativeProgressCallback | undefined; finished: boolean;
  failure?: VaultError;
  signal?: AbortSignal;
  controls?: Map<string, ReturnType<typeof deferred<void>>>;
  guardian?: { requestId: string; params: { threadId: string; reviewId: string }; denial: NativeGuardianDenial; approved: boolean };
  write?: { method: NativeConfigurationMutationMethod; requestId: string; paramsHash: string; before: NativeRuntimeIdentity; receipt?: NativeConfigurationTransition };
  migration?: { requestId: string; paramsHash: string; before: NativeRuntimeIdentity; receipt?: NativeMigrationTransition };
  shell?: { requestId: string; params: ReturnType<typeof nativeThreadShellParams>; approved: boolean; cancelled: boolean;
    started: ReturnType<typeof deferred<void>>; itemId?: string; item?: NativeThreadShellFrame };
  completion: ReturnType<typeof deferred<unknown>>;
  login?: { kind: NativeLoginKind | 'logout'; id?: string; early?: Record<string, unknown>; ack?: boolean; completed: boolean; confirming: boolean; cancelling?: boolean; secret?: string };
  turn?: { threadId: string; id?: string; terminal?: Record<string, unknown>; work?: string; controlId?: string } };
type State = { peer?: NativePeer; closed: boolean; active?: Active; loginIds: Set<string>; guardian: NativeGuardianReviews; guardianThreads: Set<string>;
  approvals: Map<string, { id: NativeRpcId; turnId?: string; shell?: true; guardian?: true }> };

function loginUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192) throw new VaultError("AUTHORIZATION");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new VaultError("AUTHORIZATION");
  return url.href;
}
function accountSummary(value: unknown) {
  try { return publicNativeAccountResult(value); }
  catch { throw new VaultError('AUTHORIZATION'); }
}

/** Native events remain private; the page receives bounded owned interactions. */
export class NativeAgentBroker {
  private readonly states = new Map<string, State>();
  private readonly transport: NativeRuntimeBroker;
  private readonly scope: 'codex-workflow' | 'codex-account-auth';
  constructor(transport: NativeRuntimeBroker, scope: 'codex-workflow' | 'codex-account-auth' = 'codex-workflow') { this.transport = transport; this.scope = scope; }

  private frame(state: State, frame: Record<string, unknown>, identity: NativeRuntimeIdentity): boolean {
    const active = state.active;
    if (!active || active.finished || active.failure || active.signal?.aborted || active.login?.secret && JSON.stringify(frame).includes(active.login.secret)) throw new VaultError("AUTHORIZATION");
    if (frame.type === "authority") {
      if (active.migration) {
        const owned = active.migration;
        if (owned.receipt || !sameNativeIdentity(identity, owned.before)) throw new VaultError('AUTHORIZATION');
        try { owned.receipt = nativeMigrationTransition(frame, owned.before, owned.requestId, owned.paramsHash); }
        catch { throw new VaultError('AUTHORIZATION'); }
        return true;
      }
      if (active.write) {
        if (active.write.receipt || !sameNativeIdentity(identity, active.write.before)) throw new VaultError('AUTHORIZATION');
        try { active.write.receipt = nativeConfigurationTransition(frame, active.write.before, active.write.method, active.write.requestId, active.write.paramsHash); }
        catch { throw new VaultError('AUTHORIZATION'); }
        return true;
      }
      nativeObject(frame, ["type", "identity"]);
      const next = nativeIdentity(frame.identity);
      if (!active.login?.completed || !active.login.confirming
        || !sameNativeIdentity(identity, { ...next, accountEpoch: identity.accountEpoch })) throw new VaultError("AUTHORIZATION");
      return true;
    }
    if (active.mcp?.frame(frame)) return true;
    const params = frame.params as Record<string, unknown> | undefined;
    if (frame.method === nativeGuardianApprovalMethod) {
      nativeObject(frame, ['id', 'method', 'params']); const p = nativeObject(params, ['requestId', 'denial']), owned = active.guardian;
      if (!owned || owned.approved || state.approvals.size || !nativeRpcId(frame.id) || p.requestId !== owned.requestId
        || JSON.stringify(p.denial) !== JSON.stringify(owned.denial) || JSON.stringify(state.guardian.get(owned.params)) !== JSON.stringify(owned.denial)) throw new VaultError('AUTHORIZATION');
      const token = crypto.randomUUID(); state.approvals.set(token, { id: frame.id, guardian: true });
      active.progress?.({ kind: 'guardian-approval', token, denial: structuredClone(owned.denial) }); return true;
    }
    if (frame.method === nativeThreadShellApprovalMethod) {
      nativeObject(frame, ['id', 'method', 'params']);
      const p = nativeObject(params, ['requestId', 'params', 'unsandboxed']), shell = active.shell;
      if (!shell || shell.approved || shell.cancelled || state.approvals.size || p.unsandboxed !== true || p.requestId !== shell.requestId
        || !nativeRpcId(frame.id) || JSON.stringify(nativeThreadShellParams(p.params)) !== JSON.stringify(shell.params)) throw new VaultError('AUTHORIZATION');
      const token = crypto.randomUUID(); state.approvals.set(token, { id: frame.id, shell: true });
      active.progress?.({ kind: 'shell-approval', token, ...shell.params, unsandboxed: true }); return true;
    }
    if (frame.method === "account/login/completed") {
      if (active.login?.kind === 'apiKey') {
        const login = active.login;
        if (!params || params.loginId != null || typeof params.success !== 'boolean' || login.completed) throw new VaultError('AUTHORIZATION');
        if (!login.ack) { if (login.early) throw new VaultError('AUTHORIZATION'); login.early = frame; return true; }
        login.completed = params.success;
        if (params.success) active.completion.resolve(undefined); else active.completion.reject(new VaultError('AUTHORIZATION'));
        return true;
      }
      if (!active.login || ['apiKey', 'logout'].includes(active.login.kind) || !params || !nativeOwnedId(params.loginId)
        || typeof params.success !== "boolean") throw new VaultError("AUTHORIZATION");
      if (!active.login.id) {
        if (active.login.early) throw new VaultError("AUTHORIZATION"); active.login.early = frame; return true;
      }
      if (params.loginId !== active.login.id || active.login.completed) throw new VaultError("AUTHORIZATION");
      if (active.login.cancelling) { if (params.success) throw new VaultError('AUTHORIZATION'); return true; }
      active.login.completed = params.success;
      if (params.success) active.completion.resolve(undefined); else active.completion.reject(new VaultError("AUTHORIZATION"));
      return true;
    }
    if (!active.turn || !params || params.threadId !== active.turn.threadId) throw new VaultError("AUTHORIZATION");
    if (frame.method === nativeGuardianStarted || frame.method === nativeGuardianCompleted) {
      if (Object.hasOwn(frame, 'id') || !active.turn.id || active.shell || active.turn.work || !state.guardianThreads.has(active.turn.threadId)) throw new VaultError('AUTHORIZATION');
      if (frame.method === nativeGuardianStarted) state.guardian.started(params, active.turn.threadId, active.turn.id);
      else {
        const denial = state.guardian.completed(params, active.turn.threadId, active.turn.id);
        if (denial) active.progress?.({ kind: 'guardian-denial', threadId: denial.threadId, turnId: denial.turnId,
          reviewId: denial.reviewId, targetItemId: denial.targetItemId, actionType: String(denial.action.type) });
      }
      return true;
    }
    if (active.shell && (frame.method === 'item/started' || frame.method === 'item/completed')) {
      const shell = active.shell, started = frame.method === 'item/started';
      if (!shell.approved || !active.turn.id || started && shell.itemId || !started && (!shell.itemId || shell.item)) throw new VaultError('AUTHORIZATION');
      const item = nativeThreadShellItem(frame, active.turn.threadId, active.turn.id, started ? 'started' : 'completed', shell.itemId);
      if (started) shell.itemId = (item.params.item as { id: string }).id; else shell.item = item;
      return true;
    }
    if (frame.method === "turn/started" || frame.method === "turn/completed") {
      const turn = params.turn as Record<string, unknown> | undefined;
      if (frame.method === 'turn/started' && active.turn.work === 'review/start') {
        if (!turn || !nativeOwnedId(turn.id) || active.turn.controlId) throw new VaultError('AUTHORIZATION');
        active.turn.controlId = turn.id;
        active.progress?.({ kind: 'running', threadId: active.turn.threadId, turnId: turn.id }); return true;
      }
      if (!turn || !nativeOwnedId(turn.id) || active.turn.id && turn.id !== active.turn.id) throw new VaultError("AUTHORIZATION");
      if (active.shell && (!active.shell.approved || frame.method === 'turn/started' && active.turn.id)) throw new VaultError('AUTHORIZATION');
      active.turn.id = turn.id;
      if (frame.method === "turn/started") { active.shell?.started.resolve(); active.progress?.({ kind: "running", threadId: active.turn.threadId, turnId: turn.id }); }
      else {
        if (active.turn.terminal || !Array.isArray(turn.items) || !["completed", "interrupted", "failed"].includes(String(turn.status))) throw new VaultError("AUTHORIZATION");
        active.turn.terminal = params; state.approvals.clear();
        if (turn.status === "completed") {
          if (active.shell && !active.shell.item) throw new VaultError('AUTHORIZATION');
          active.completion.resolve(active.shell ? { completion: structuredClone(frame), command: active.shell.item } : params);
        }
        else active.completion.reject(new VaultError(turn.status === "interrupted" ? "CANCELLED" : "NATIVE_FAILED"));
      }
      return true;
    }
    if (active.shell) throw new VaultError('PERMISSION');
    if (!nativeRpcId(frame.id) || !nativeOwnedId(params.turnId) || params.turnId !== active.turn.id || !nativeOwnedId(params.itemId)
      || state.approvals.size >= 8 || [...state.approvals.values()].some(value => value.id === frame.id)) throw new VaultError("AUTHORIZATION");
    const kind = frame.method === "item/commandExecution/requestApproval" ? "command" : undefined;
    if (!kind || params.grantRoot != null || params.networkApprovalContext != null || params.proposedExecpolicyAmendment != null
      || params.proposedNetworkPolicyAmendments != null || params.environmentId != null || params.kind != null && params.kind !== "command") throw new VaultError("PERMISSION");
    if (typeof params.command !== "string" || !params.command.trim()) throw new VaultError("AUTHORIZATION");
    for (const value of [params.command, params.cwd, params.reason])
      if (value != null && (typeof value !== "string" || value.length > 8192)) throw new VaultError("LIMIT");
    const token = crypto.randomUUID(); state.approvals.set(token, { id: frame.id, turnId: params.turnId });
    active.progress?.({ kind: "approval", interaction: { token, kind, threadId: active.turn.threadId, turnId: params.turnId,
      itemId: params.itemId, command: params.command,
      ...(typeof params.cwd === "string" ? { cwd: params.cwd } : {}), ...(typeof params.reason === "string" ? { reason: params.reason } : {}) } });
    return true;
  }

  private async connect(connection: NativeRuntimeConnection, key: string, fingerprint: string, guard: () => Promise<void>, signal?: AbortSignal) {
    let state = this.states.get(connection.id);
    if (!state || state.closed) {
      state = { closed: false, approvals: new Map(), loginIds: new Set(), guardian: new NativeGuardianReviews(), guardianThreads: new Set() }; this.states.set(connection.id, state);
    }
    if (state.active) throw new VaultError("CONFLICT");
    const selected = state;
    selected.peer = await this.transport.agent(connection.id, connection.host, key, fingerprint, connection.identity, guard, {
      frame: (frame, identity) => this.frame(selected, frame, identity),
      closed: () => {
        selected.closed = true; selected.approvals.clear(); selected.guardian.clear(); selected.guardianThreads.clear(); selected.active?.completion.reject(new VaultError("NATIVE_UNKNOWN")); selected.active?.shell?.started.reject(new VaultError('NATIVE_UNKNOWN')); selected.active?.mcp?.completion.reject(new VaultError("NATIVE_UNKNOWN"));
        if (this.states.get(connection.id) === selected) this.states.delete(connection.id);
      }
    }, signal, this.scope);
    if (selected.closed) throw new VaultError("NATIVE_UNKNOWN");
    if (selected.active) throw new VaultError('CONFLICT');
    return selected;
  }

  private begin(state: State, active: Active, signal?: AbortSignal) {
    state.active = active;
    if (signal) active.signal = signal;
    const stop = (error: VaultError) => { active.failure = error; active.completion.reject(error); active.shell?.started.reject(error); active.mcp?.completion.reject(error); this.transport.close(state.peer!.scope.connectionId); };
    const cancel = () => {
      const shell = active.shell;
      if (!shell?.approved) { stop(new VaultError('CANCELLED')); return; }
      if (shell.cancelled) return; shell.cancelled = true;
      void (async () => {
        await shell.started.promise; await active.guard();
        if (active.finished || state.closed) return;
        const id = 'cancel_' + crypto.randomUUID(), completed = deferred<void>();
        active.controls ??= new Map(); active.controls.set(id, completed);
        try { await state.peer!.request('turn/interrupt', { threadId: active.turn!.threadId, turnId: active.turn!.id }); }
        finally { active.controls.delete(id); completed.resolve(); }
      })().catch(() => { if (!active.finished) stop(new VaultError('NATIVE_UNKNOWN')); });
    };
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
      if (login.kind === "apiKey") {
        nativeObject(result, ["type"]); login.ack = true;
        if (login.early) { const early = login.early; delete login.early; this.frame(state, early, state.peer!.identity); }
        await active.completion.promise;
      }
      else {
        if (!nativeOwnedId(result.loginId) || state.loginIds.size >= 64) throw new VaultError("AUTHORIZATION"); login.id = result.loginId; state.loginIds.add(login.id);
        let notice: NativeAgentProgress;
        if (login.kind === "chatgpt") {
          nativeObject(result, ["type", "loginId", "authUrl"]);
          notice = { kind: "login", login: "chatgpt", loginId: login.id, authUrl: loginUrl(result.authUrl) };
        } else {
          if (login.kind !== 'chatgptDeviceCode') throw new VaultError('AUTHORIZATION');
          nativeObject(result, ["type", "loginId", "userCode", "verificationUrl"]);
          if (typeof result.userCode !== "string" || !result.userCode.trim() || result.userCode.length > 128) throw new VaultError("AUTHORIZATION");
          notice = { kind: "login", login: "chatgptDeviceCode", loginId: login.id, userCode: result.userCode, verificationUrl: loginUrl(result.verificationUrl) };
        }
        await guard(); progress?.(notice);
        if (login.early) { const early = login.early; delete login.early; this.frame(state, early, state.peer!.identity); }
        await active.completion.promise;
      }
      await guard(); login.confirming = true;
      const summary = accountSummary(await state.peer!.request("account/read", { refreshToken: false }, signal));
      const accountType = summary.account?.type ?? 'none';
      const providerHidesAccount = this.scope === 'codex-account-auth' && summary.requiresOpenaiAuth === false && accountType === 'none';
      if (!providerHidesAccount && accountType !== (login.kind === "apiKey" ? "apiKey" : "chatgpt")) throw new VaultError("AUTHORIZATION");
      await guard();
      if (signal?.aborted || state.closed) throw new VaultError(signal?.aborted ? "CANCELLED" : "NATIVE_UNKNOWN");
      return { identity: { ...state.peer!.identity }, accountType, requiresOpenaiAuth: summary.requiresOpenaiAuth, account: summary };
    } catch (error) { this.transport.close(connection.id); throw signal?.aborted ? new VaultError("CANCELLED")
      : error instanceof VaultError && error.code !== "NETWORK" ? error : new VaultError("NATIVE_UNKNOWN"); }
    finally { delete login.secret; end(); }
  }

  async cancelLogin(connection: NativeRuntimeConnection, input: Record<string, unknown>, guard: () => Promise<void>, signal?: AbortSignal) {
    const state = this.states.get(connection.id), active = state?.active, login = active?.login;
    const id = typeof input.loginId === 'string' ? input.loginId : login?.id;
    if (!state || state.closed || !state.peer || !id || !state.loginIds.has(id) || signal?.aborted
      || !sameNativeIdentity(state.peer.identity, connection.identity)) throw new VaultError('PERMISSION');
    await guard(); await active?.guard();
    if (login?.id === id) login.cancelling = true;
    try {
      const result = nativeObject(await state.peer.request('account/login/cancel', { loginId: id }, signal), ['status']);
      if (!['canceled', 'notFound'].includes(String(result.status))) throw new VaultError('AUTHORIZATION');
      await guard(); if (signal?.aborted) throw new VaultError('CANCELLED');
      if (login?.id === id) active!.completion.reject(new VaultError('CANCELLED'));
      return result;
    } catch (error) { this.transport.close(connection.id); throw error; }
  }

  async logout(connection: NativeRuntimeConnection, key: string, fingerprint: string, guard: () => Promise<void>, signal?: AbortSignal) {
    const state = await this.connect(connection, key, fingerprint, guard, signal);
    const login: NonNullable<Active['login']> = { kind: 'logout', completed: false, confirming: false };
    const active: Active = { guard, progress: undefined, finished: false, completion: deferred(), login }, end = this.begin(state, active, signal);
    try {
      nativeObject(await state.peer!.request('account/logout', {}, signal), []); login.completed = true;
      await guard(); login.confirming = true;
      const account = accountSummary(await state.peer!.request('account/read', { refreshToken: false }, signal));
      if (account.account != null) throw new VaultError('AUTHORIZATION');
      await guard(); if (signal?.aborted || state.closed) throw new VaultError('CANCELLED');
      return { identity: { ...state.peer!.identity }, accountType: 'none' as const, requiresOpenaiAuth: account.requiresOpenaiAuth, account };
    } catch (error) { this.transport.close(connection.id); throw error; }
    finally { end(); }
  }

  async execute(connection: NativeRuntimeConnection, key: string, fingerprint: string, method: NativeWorkflowMethod | NativeConfigurationWriteMethod | NativeMigrationMethod,
    input: unknown, guard: () => Promise<void>, signal?: AbortSignal, progress?: NativeProgressCallback,
    adoptConfiguration?: (receipt: NativeConfigurationTransition, result: unknown) => Promise<void>,
    adoptMigration?: (receipt: NativeMigrationTransition, result: unknown) => Promise<void>): Promise<unknown> {
    const writing = isNativeConfigurationWriteMethod(method) || isNativeMarketplaceMethod(method) || isNativePluginInstallMethod(method) || isNativePluginShareMethod(method), migration = isNativeMigrationMethod(method), importing = method === 'externalAgentConfig/import';
    const params = isNativePluginShareMethod(method) ? nativePluginShareParams(method, input) : isNativePluginInstallMethod(method) ? nativePluginInstallParams(method, input) : isNativeMarketplaceMethod(method) ? nativeMarketplaceParams(method, input) : writing ? nativeConfigurationWriteParams(method, input) : migration ? nativeMigrationParams(method, input) : nativeWorkflowParams(method, input);
    if (writing && !adoptConfiguration) throw new VaultError('PERMISSION');
    if (importing && !adoptMigration) throw new VaultError('PERMISSION');
    const paramsHash = writing || importing ? await nativeConfigurationWriteHash(params) : undefined;
    if (!writing && !migration && !isNativeAccountReadMethod(method) && !(isNativeThreadLifecycleMethod(method) && method !== 'thread/fork') && !isNativeThreadContentPairedMethod(method) && !isNativeStoredThreadReadMethod(method) && method !== nativeMcpOAuthMethod && !isNativeConfigurationReadMethod(method) && !isNativeWindowsSandboxReadinessMethod(method) && !isNativePluginReadMethod(method) && !isNativeConfigurationControlMethod(method) && connection.accountType === "none" && connection.requiresOpenaiAuth !== false) throw new VaultError("AUTHORIZATION");
    if (nativeAccountReadNeedsChatgpt(method) && connection.accountType !== "chatgpt") throw new VaultError("AUTHORIZATION");
    const state = await this.connect(connection, key, fingerprint, guard, signal);
    if (['thread/rollback', 'thread/revert', 'thread/archive', 'thread/unload', 'thread/delete', 'thread/resume'].includes(method) && typeof params.threadId === 'string') state.guardian.forgetThread(params.threadId);
    const active: Active = { guard, progress, finished: false, completion: deferred(),
      ...(method === nativeGuardianMethod ? { guardian: { requestId: 'guardian_' + crypto.randomUUID(), params: params as { threadId: string; reviewId: string }, denial: state.guardian.get(params), approved: false } } : {}),
      ...(writing ? { write: { method, requestId: 'config_' + crypto.randomUUID(), paramsHash: paramsHash!, before: { ...state.peer!.identity } } } : {}),
      ...(importing ? { migration: { requestId: 'migration_' + crypto.randomUUID(), paramsHash: paramsHash!, before: { ...state.peer!.identity } } } : {}),
      ...(method === nativeThreadShellMethod ? { shell: { requestId: 'shell_' + crypto.randomUUID(), params: nativeThreadShellParams(params), approved: false, cancelled: false, started: deferred<void>() } } : {}),
      ...(method === nativeMcpOAuthMethod ? { mcp: new NativeMcpOAuthFlow(params) } : {}),
      ...(method === "turn/start" || method === nativeThreadShellMethod || isNativeTurnWorkMethod(method) ? { turn: { threadId: params.threadId as string, ...(isNativeTurnWorkMethod(method) ? { work: method } : {}) } } : {}) };
    const end = this.begin(state, active, signal);
    try {
      if (active.mcp) return await active.mcp.execute(state.peer!, params, guard, signal, progress);
      const result = await state.peer!.request(method, params, active.shell ? undefined : signal, active.write?.requestId ?? active.migration?.requestId ?? active.shell?.requestId ?? active.guardian?.requestId) as Record<string, unknown>;
      if (active.guardian) { if (!active.guardian.approved) throw new VaultError('AUTHORIZATION'); nativeObject(result, []); }
      let terminal: unknown = result;
      if (active.turn) {
        if (isNativeTurnWorkMethod(method)) nativeTurnWorkAcknowledgement(method, result, active.turn.threadId);
        if (active.shell || method === 'thread/compact/start') nativeObject(result, []);
        else {
          const turn = result?.turn as { id?: unknown } | undefined;
          if (!nativeOwnedId(turn?.id) || active.turn.id && active.turn.id !== turn.id) throw new VaultError("AUTHORIZATION");
          active.turn.id = turn.id;
          if (method !== 'review/start') progress?.({ kind: "running", threadId: active.turn.threadId, turnId: turn.id });
        }
        terminal = await active.completion.promise;
        if (method === 'review/start') terminal = { reviewThreadId: active.turn.threadId, turn: (terminal as Record<string, unknown>).turn };
        else if (method === 'thread/compact/start') terminal = {};
      } else if (method !== nativeGuardianMethod && !writing && !migration && !isNativeAccountReadMethod(method) && !(isNativeThreadLifecycleMethod(method) && method !== 'thread/fork') && !isNativeThreadContentMethod(method) && !isNativeStoredThreadReadMethod(method) && method !== nativeMcpToolMethod && !isNativeConfigurationReadMethod(method) && !isNativeWindowsSandboxReadinessMethod(method) && !isNativePluginReadMethod(method) && !isNativeConfigurationControlMethod(method) && !nativeOwnedId((result?.thread as { id?: unknown })?.id)) throw new VaultError("AUTHORIZATION");
      await guard(); if (signal?.aborted || state.closed) throw new VaultError(signal?.aborted ? "CANCELLED" : "NATIVE_UNKNOWN");
      if (method === 'thread/start' || method === 'thread/resume') {
        const threadId = (result.thread as { id: string }).id;
        if (params.approvalsReviewer === 'auto_review') {
          if (!['auto_review', 'guardian_subagent'].includes(String(result.approvalsReviewer))) throw new VaultError('AUTHORIZATION');
          state.guardianThreads.add(threadId);
        } else {
          if (result.approvalsReviewer !== undefined && result.approvalsReviewer !== 'user') throw new VaultError('AUTHORIZATION');
          state.guardianThreads.delete(threadId);
        }
      }
      if (active.write) {
        const owned = active.write;
        if (!owned.receipt) throw new VaultError('AUTHORIZATION');
        let receipt: NativeConfigurationTransition;
        try { receipt = nativeConfigurationTransition(owned.receipt, owned.before, owned.method, owned.requestId, owned.paramsHash, await nativeConfigurationWriteHash(result)); }
        catch { throw new VaultError('AUTHORIZATION'); }
        if (!sameNativeIdentity(receipt.identity, state.peer!.identity)) throw new VaultError('AUTHORIZATION');
        await guard(); if (signal?.aborted || state.closed) throw new VaultError(signal?.aborted ? 'CANCELLED' : 'NATIVE_UNKNOWN');
        await adoptConfiguration!(receipt, result);
        await guard(); if (signal?.aborted || state.closed) throw new VaultError(signal?.aborted ? 'CANCELLED' : 'NATIVE_UNKNOWN');
      }
      if (active.migration) {
        const owned = active.migration;
        if (!owned.receipt) throw new VaultError('AUTHORIZATION');
        let receipt: NativeMigrationTransition;
        try { receipt = nativeMigrationTransition(owned.receipt, owned.before, owned.requestId, owned.paramsHash, await nativeConfigurationWriteHash(result)); }
        catch { throw new VaultError('AUTHORIZATION'); }
        if (!sameNativeIdentity(receipt.identity, state.peer!.identity)) throw new VaultError('AUTHORIZATION');
        await guard(); if (signal?.aborted || state.closed) throw new VaultError(signal?.aborted ? 'CANCELLED' : 'NATIVE_UNKNOWN');
        await adoptMigration!(receipt, result);
        await guard(); if (signal?.aborted || state.closed) throw new VaultError(signal?.aborted ? 'CANCELLED' : 'NATIVE_UNKNOWN');
      }
      return migration ? publicNativeMigrationResult(method, terminal) : terminal;
    } catch (error) { active.completion.reject(error); active.shell?.started.reject(error);
      if (active.controls?.size) await Promise.allSettled([...active.controls.values()].map(control => control.promise));
      this.transport.close(connection.id); throw active.failure ?? (signal?.aborted ? new VaultError("CANCELLED")
      : error instanceof VaultError && error.code !== "NETWORK" ? error : new VaultError("NATIVE_UNKNOWN")); }
    finally { if (active.controls?.size) await Promise.allSettled([...active.controls.values()].map(control => control.promise)); end(); }
  }

  async control(connection: NativeRuntimeConnection, fingerprint: string, method: NativeTurnControlMethod, input: unknown,
    guard: () => Promise<void>, signal?: AbortSignal) {
    const params = nativeTurnControlParams(method, input), state = this.states.get(connection.id), active = state?.active;
    if (!state || state.closed || !state.peer || !active?.turn || active.finished || active.failure || active.signal?.aborted
      || state.peer.scope.method !== 'codex-workflow' || state.peer.scope.fingerprint !== fingerprint
      || !sameNativeIdentity(connection.identity, state.peer.identity) || params.threadId !== active.turn.threadId
      || method === 'turn/steer' && (active.shell || active.turn.work || active.turn.id !== params.expectedTurnId)
      || method === 'turn/interrupt' && params.turnId !== '' && (active.turn.controlId ?? active.turn.id) !== params.turnId
      || active.controls && active.controls.size >= 4) throw new VaultError('PERMISSION');
    const id = 'control_' + crypto.randomUUID(), completed = deferred<void>();
    active.controls ??= new Map(); active.controls.set(id, completed);
    try {
      try { await guard(); await active.guard(); } catch (error) { this.transport.close(connection.id); throw error; }
      if (state.closed || state.active !== active || active.signal?.aborted || signal?.aborted) throw new VaultError('CANCELLED');
      const result = nativeTurnControlResult(method, await state.peer.request(method, params, signal, id), params);
      if (method === 'turn/interrupt' && params.turnId !== '') {
        await active.completion.promise.catch(() => {});
        const terminal = active.turn.terminal?.turn as { id?: unknown; status?: unknown } | undefined;
        const ownerId = active.turn.work === 'review/start' ? active.turn.id : params.turnId;
        if (terminal?.id !== ownerId || terminal?.status !== 'interrupted') throw new VaultError('AUTHORIZATION');
      }
      await guard(); await active.guard();
      if (state.closed || state.active !== active || signal?.aborted) throw new VaultError('AUTHORIZATION');
      return result;
    } finally { active.controls.delete(id); completed.resolve(); }
  }

  async reply(connectionId: string, token: string, decision: NativeDecision, signal?: AbortSignal): Promise<void> {
    const state = this.states.get(connectionId), prompt = state?.approvals.get(token), active = state?.active;
    if (!state || state.closed || !active || active.finished || !prompt || signal && signal !== active.signal
      || (prompt.guardian ? !active.guardian || active.guardian.approved : prompt.shell ? !active.shell || active.shell.approved || active.shell.cancelled : prompt.turnId !== active.turn?.id)
      || !["accept", "decline", "cancel"].includes(decision)) throw new VaultError("PERMISSION");
    try { await active.guard(); } catch (error) {
      active.failure = error instanceof VaultError ? error : new VaultError('NATIVE_UNKNOWN');
      active.completion.reject(active.failure); active.shell?.started.reject(active.failure); this.transport.close(connectionId); throw error;
    }
    if (state.closed || state.active !== active || !state.approvals.has(token)) throw new VaultError("PERMISSION");
    state.approvals.delete(token);
    if (prompt.guardian) {
      if (decision !== 'accept') { active.failure = new VaultError('CANCELLED'); active.completion.reject(active.failure); this.transport.close(connectionId); return; }
      const owned = active.guardian!;
      try { if (JSON.stringify(state.guardian.consume(owned.params)) !== JSON.stringify(owned.denial)) throw new VaultError('AUTHORIZATION'); }
      catch { active.failure = new VaultError('AUTHORIZATION'); active.completion.reject(active.failure); this.transport.close(connectionId); throw active.failure; }
      owned.approved = true;
    }
    if (prompt.shell) {
      if (decision !== 'accept') { active.failure = new VaultError('CANCELLED'); active.completion.reject(active.failure); this.transport.close(connectionId); return; }
      active.shell!.approved = true;
    }
    state.peer!.reply(prompt.id, { decision });
  }
}
