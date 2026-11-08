// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomUUID } from 'node:crypto';
import { nativeTurnControlFixture } from './native-turn-control.fixture.mjs';

export function nativeTurnWorkFixture(options = {}) {
  return nativeTurnControlFixture({ ...options,
    onNativeFrame(frame, f) {
      if (frame.error) f.nativeWorkError = String(frame.error.message).replaceAll(f.home, '<owned-home>').replaceAll(f.workspace, '<owned-workspace>').slice(0, 512);
      f.nativeWorkTrace ??= [];
      f.nativeWorkTrace.push({ method: frame.method, id: frame.id, threadId: frame.params?.threadId, turnId: frame.params?.turn?.id, status: frame.params?.turn?.status,
        resultKeys: frame.result && Object.keys(frame.result), reviewThreadId: frame.result?.reviewThreadId, resultTurnId: frame.result?.turn?.id, resultTurnStatus: frame.result?.turn?.status });
      f.nativeWorkTrace = f.nativeWorkTrace.slice(-12);
    },
    onFrame(frame, f, emit) {
    if (options.onFrame?.(frame, f, emit) === true) return true;
    if (!['review/start', 'thread/compact/start'].includes(frame.method)) return false;
    const threadId = frame.params.threadId, turnId = 'work_' + randomUUID();
    const turn = { id: turnId, status: 'inProgress', items: [], error: null };
    f.workTurnId = turnId;
    f.workStarted = frame;
    f.ackWork = () => emit({ id: frame.id, result: frame.method === 'review/start' ? { reviewThreadId: options.foreignAck ? 'foreign' : threadId, turn } : {} });
    f.finishWork = (status = 'completed', extra = {}) => emit({ method: 'turn/completed', params: {
      threadId, turn: { ...turn, status, items: frame.method === 'review/start' ? [{ type: 'agentMessage', id: 'review', text: f.terminalText ?? 'Owned review result.' }] : [], ...extra } } });
    f.completeTurn = f.finishWork;
    if (options.ackFirst) f.ackWork();
    if (options.terminalFirst) f.finishWork();
    else emit({ method: 'turn/started', params: { threadId, turn: { ...turn, ...(options.delegateStart ? { id: 'owned_review_delegate' } : {}) } } });
    if (!options.holdAck && !options.ackFirst) queueMicrotask(f.ackWork);
    return true;
  } });
}
