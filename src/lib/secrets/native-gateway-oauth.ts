// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeIdentity, nativeObject, sameNativeIdentity, type NativeRuntimeIdentity } from '../native-runtime-contract.ts';
import { nativeGatewayOAuthNotification, nativeGatewayOAuthScope, nativeGatewayOAuthUrl } from '../native-gateway-oauth.ts';
import type { NativeProgressCallback } from '../native-agent-contract.ts';
import type { NativeRuntimeConnection } from './native-runtime-config.ts';
import type { NativePeer, NativeRuntimeBroker } from './native-runtime.ts';
import { VaultError } from './types.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve };
}
type Active = { guard: () => Promise<void>; progress?: NativeProgressCallback; handoff?: string; receipt?: NativeRuntimeIdentity; cancel?: ReturnType<typeof deferred> };
type State = { peer?: NativePeer; active?: Active; closed: boolean };

/** Secondary credentials stay in the native encrypted store. Only an owned handoff reaches the page. */
export class NativeGatewayOAuthBroker {
  private readonly states = new Map<string, State>();
  private readonly transport: NativeRuntimeBroker;
  constructor(transport: NativeRuntimeBroker) { this.transport = transport; }

  private async connect(connection: NativeRuntimeConnection, key: string, fingerprint: string, guard: () => Promise<void>, signal?: AbortSignal) {
    let state = this.states.get(connection.id);
    if (state?.active) throw new VaultError('CONFLICT');
    if (!state || state.closed) { state = { closed: false }; this.states.set(connection.id, state); }
    const selected = state;
    selected.peer = await this.transport.agent(connection.id, connection.host, key, fingerprint, connection.identity, guard, {
      frame: (frame, identity) => {
        const active = selected.active;
        if (frame.type === 'authority') {
          nativeObject(frame, ['type', 'identity']); const next = nativeIdentity(frame.identity);
          if (!active?.handoff || active.cancel || active.receipt || !sameNativeIdentity(identity, { ...next, accountEpoch: identity.accountEpoch })) throw new VaultError('AUTHORIZATION');
          active.receipt = next; return true;
        }
        if (frame.method === nativeGatewayOAuthNotification) {
          if (!active || active.cancel || active.handoff) throw new VaultError('AUTHORIZATION');
          const note = nativeObject(frame.params, ['providerId', 'authUrl']);
          if (typeof note.providerId !== 'string' || !note.providerId.length || note.providerId.length > 192) throw new VaultError('AUTHORIZATION');
          const authUrl = nativeGatewayOAuthUrl(note.authUrl); active.handoff = note.providerId;
          active.progress?.({ kind: 'gateway-login', providerId: note.providerId, authUrl }); return true;
        }
        // Unrelated native hints remain private; no server request is authorized.
        if (typeof frame.method === 'string' && !Object.hasOwn(frame, 'id')) return true;
        throw new VaultError('AUTHORIZATION');
      },
      closed: () => { selected.closed = true; selected.active?.cancel?.resolve(); if (this.states.get(connection.id) === selected) this.states.delete(connection.id); }
    }, signal, nativeGatewayOAuthScope);
    if (selected.closed) throw new VaultError('NATIVE_UNKNOWN'); return selected;
  }

  async login(connection: NativeRuntimeConnection, key: string, fingerprint: string, guard: () => Promise<void>, signal?: AbortSignal, progress?: NativeProgressCallback) {
    const state = await this.connect(connection, key, fingerprint, guard, signal), active: Active = { guard, ...(progress ? { progress } : {}) };
    state.active = active;
    try {
      nativeObject(await state.peer!.request('account/gatewayOAuth/login', null, signal), []);
      await guard();
      if (signal?.aborted || state.closed || active.cancel || !active.receipt || !sameNativeIdentity(active.receipt, state.peer!.identity)) throw new VaultError('AUTHORIZATION');
      return { identity: { ...active.receipt }, response: {} };
    } catch (error) {
      // The native login error can precede the cancel acknowledgement. Keep this
      // owner alive until cancellation releases the native login slot.
      if (active.cancel) { await active.cancel.promise; throw new VaultError('CANCELLED'); }
      throw error;
    } finally { if (state.active === active) delete state.active; }
  }

  async cancel(connection: NativeRuntimeConnection, key: string, fingerprint: string, guard: () => Promise<void>, signal?: AbortSignal) {
    let state = this.states.get(connection.id);
    const active = state?.active;
    if (active?.cancel) throw new VaultError('CONFLICT');
    if (!active) {
      if (this.transport.exclusive(connection.id) && !(state?.peer?.socket.readyState === 1 && state.peer.scope.method === nativeGatewayOAuthScope)) throw new VaultError('CONFLICT');
      state = await this.connect(connection, key, fingerprint, guard, signal);
    }
    const cancellation = active ? deferred() : undefined;
    if (active && cancellation) active.cancel = cancellation;
    try {
      await guard(); if (active) await active.guard();
      nativeObject(await state!.peer!.request('account/gatewayOAuth/cancel', null, signal), []);
      await guard(); return {};
    } finally { cancellation?.resolve(); }
  }
}
