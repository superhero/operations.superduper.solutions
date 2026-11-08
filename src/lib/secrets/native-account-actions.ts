// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, nativeUuid, sameNativeIdentity } from '../native-runtime-contract.ts';
import { nativeAccountActionScope, nativeAccountActionApprovalMethod, nativeAccountActionParams, nativeAccountActionResult, type NativeAccountActionMethod } from '../native-account-actions.ts';
import { publicNativeAccountResult } from '../native-account.ts';
import type { NativeDecision, NativeProgressCallback } from '../native-agent-contract.ts';
import type { NativeRuntimeConnection } from './native-runtime-config.ts';
import type { NativePeer, NativeRuntimeBroker } from './native-runtime.ts';
import { VaultError } from './types.ts';

type Active = { method: NativeAccountActionMethod; params: Record<string, unknown>; requestId: string; guard: () => Promise<void>;
  progress?: NativeProgressCallback; signal?: AbortSignal; token?: string; hostId?: string; approved: boolean; declined: boolean };
type State = { peer?: NativePeer; active?: Active; closed: boolean };

export class NativeAccountActionBroker {
  private readonly states = new Map<string, State>();
  private readonly transport: NativeRuntimeBroker;
  constructor(transport: NativeRuntimeBroker) { this.transport = transport; }
  ownsApproval(id: string, token: string) { return this.states.get(id)?.active?.token === token; }
  private async connect(connection: NativeRuntimeConnection, key: string, fingerprint: string, guard: () => Promise<void>, signal?: AbortSignal) {
    let state = this.states.get(connection.id);
    if (state?.active) throw new VaultError('CONFLICT');
    if (!state || state.closed) { state = { closed: false }; this.states.set(connection.id, state); }
    const selected = state;
    selected.peer = await this.transport.agent(connection.id, connection.host, key, fingerprint, connection.identity, guard, {
      frame: (frame, identity) => {
        const active = selected.active;
        if (frame.method === nativeAccountActionApprovalMethod) {
          nativeObject(frame, ['id', 'method', 'params']); const note = nativeObject(frame.params, ['requestId', 'method', 'params', 'account']);
          if (!active || active.approved || active.declined || active.token || !nativeUuid(frame.id) || note.requestId !== active.requestId || note.method !== active.method
            || JSON.stringify(nativeAccountActionParams(active.method, note.params)) !== JSON.stringify(active.params)
            || !sameNativeIdentity(identity, connection.identity)) throw new VaultError('AUTHORIZATION');
          const account = publicNativeAccountResult(note.account), token = crypto.randomUUID(); active.token = token; active.hostId = frame.id;
          active.progress?.({ kind: 'account-action-approval', token, method: active.method, params: structuredClone(active.params), account }); return true;
        }
        if (typeof frame.method === 'string' && !Object.hasOwn(frame, 'id')) return true;
        throw new VaultError('AUTHORIZATION');
      }, closed: () => { selected.closed = true; if (this.states.get(connection.id) === selected) this.states.delete(connection.id); }
    }, signal, nativeAccountActionScope);
    if (selected.closed) throw new VaultError('NATIVE_UNKNOWN'); return selected;
  }
  async execute(connection: NativeRuntimeConnection, key: string, fingerprint: string, method: NativeAccountActionMethod, input: unknown,
    guard: () => Promise<void>, signal?: AbortSignal, progress?: NativeProgressCallback) {
    const params = nativeAccountActionParams(method, input), state = await this.connect(connection, key, fingerprint, guard, signal);
    const active: Active = { method, params, requestId: 'action_' + crypto.randomUUID(), guard, approved: false, declined: false,
      ...(signal ? { signal } : {}), ...(progress ? { progress } : {}) }; state.active = active;
    try {
      const result = await state.peer!.request(method, params, signal, active.requestId); await guard();
      if (state.closed || !active.approved || active.declined || signal?.aborted) throw new VaultError('AUTHORIZATION');
      return nativeAccountActionResult(method, result);
    } catch (error) { if (active.declined) throw new VaultError('CANCELLED'); throw error; }
    finally { if (state.active === active) delete state.active; }
  }
  async reply(id: string, token: string, decision: NativeDecision, signal?: AbortSignal) {
    const state = this.states.get(id), active = state?.active;
    if (!state || state.closed || !active || active.token !== token || !active.hostId || active.approved || active.declined
      || signal && signal !== active.signal || !['accept', 'decline', 'cancel'].includes(decision)) throw new VaultError('PERMISSION');
    try { await active.guard(); } catch (error) { this.transport.close(id); throw error; }
    if (state.closed || state.active !== active || active.token !== token || active.signal?.aborted) throw new VaultError('PERMISSION');
    delete active.token;
    active.approved = decision === 'accept'; active.declined = decision !== 'accept';
    state.peer!.reply(active.hostId, { decision });
  }
}
