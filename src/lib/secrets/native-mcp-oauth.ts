// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject } from '../native-runtime-contract.ts';
import { NativeMcpOAuthCorrelation, nativeMcpOAuthMethod, nativeMcpOAuthNotification, nativeMcpOAuthLimits,
  type NativeMcpOAuthCompletion, type NativeMcpOAuthNotice } from '../native-mcp-oauth.ts';
import { VaultError } from './types.ts';
import type { NativePeer } from './native-runtime.ts';

export class NativeMcpOAuthFlow {
  readonly completion: { promise: Promise<NativeMcpOAuthCompletion>; resolve: (value: NativeMcpOAuthCompletion) => void; reject: (error: unknown) => void };
  private readonly correlation: NativeMcpOAuthCorrelation;
  constructor(params: Record<string, unknown>) {
    this.correlation = new NativeMcpOAuthCorrelation(params);
    let resolve!: (value: NativeMcpOAuthCompletion) => void, reject!: (error: unknown) => void;
    const promise = new Promise<NativeMcpOAuthCompletion>((yes, no) => { resolve = yes; reject = no; });
    void promise.catch(() => {}); this.completion = { promise, resolve, reject };
  }
  private finish(value: NativeMcpOAuthCompletion | undefined) {
    if (value) { if (value.success) this.completion.resolve(value); else this.completion.reject(new VaultError('NATIVE_MCP_OAUTH')); }
  }
  frame(frame: Record<string, unknown>): boolean {
    if (frame.method !== nativeMcpOAuthNotification) return false;
    nativeObject(frame, ['method', 'params']); this.finish(this.correlation.complete(frame.params)); return true;
  }
  async execute(peer: NativePeer, params: Record<string, unknown>, guard: () => Promise<void>, signal?: AbortSignal,
    progress?: (notice: NativeMcpOAuthNotice) => void): Promise<NativeMcpOAuthCompletion> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => this.completion.reject(new VaultError('CANCELLED'));
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    try {
      const acknowledgement = this.correlation.acknowledge(await peer.request(nativeMcpOAuthMethod, params, signal));
      await guard();
      timer = setTimeout(() => this.completion.reject(new VaultError('NATIVE_MCP_OAUTH')),
        Number(params.timeoutSecs ?? nativeMcpOAuthLimits.timeoutSecs) * 1000 + nativeMcpOAuthLimits.graceMs);
      if (acknowledgement.completion) this.finish(acknowledgement.completion); else progress?.(acknowledgement.notice);
      const result = await this.completion.promise; await guard();
      if (signal?.aborted || peer.socket.readyState !== 1) throw new VaultError(signal?.aborted ? 'CANCELLED' : 'NATIVE_UNKNOWN');
      return result;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
}
