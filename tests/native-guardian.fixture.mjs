// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomUUID } from 'node:crypto';
import { nativeAgentFixture } from './native-agent.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { seedNativeTurnProvider } from './native-turn-control.fixture.mjs';

export function guardianFixtureNotice(workspace, threadId = 'thread_owned', turnId = 'turn_owned', reviewId = 'review_owned', action = {}) {
  const started = { threadId, turnId, reviewId, targetItemId: 'item_owned', startedAtMs: 1,
    review: { status: 'inProgress', riskLevel: null, userAuthorization: null, rationale: null },
    action: { type: 'command', source: 'unifiedExec', command: 'printf OWNED_GUARDIAN_DENIAL', cwd: workspace, ...action } };
  return { started, completed: { ...started, completedAtMs: 2, decisionSource: 'agent',
    review: { status: 'denied', riskLevel: 'high', userAuthorization: 'low', rationale: 'Owned fixture denial.' } } };
}
export async function nativeGuardianFixture(options = {}) {
  const allowGuardian = options.allowGuardian ?? true; let provider;
  const f = await nativeAgentFixture({ ...options, allowGuardian, manualTurn: true, account: null, requiresOpenaiAuth: false,
    ...(options.real ? { async runtimeFactory(f) {
      provider = await seedNativeTurnProvider(f.home); f.provider = provider;
      const real = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace, allowAgent: true, allowGuardian,
        executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 });
      return { ...real, async start(receive, exited) {
        f.starts++; const child = await real.start(frame => { options.onNativeFrame?.(frame, f); receive(frame); }, exited); let closed = false;
        return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!closed) { closed = true; f.stops++; } } };
      } };
    } } : {}), onFrame(frame, f, emit) {
      if (options.onFrame?.(frame, f, emit) === true) return true;
      const reply = result => queueMicrotask(() => emit({ id: frame.id, result }));
      if (frame.method === 'thread/start' || frame.method === 'thread/resume') {
        reply({ thread: { id: frame.params.threadId ?? 'thread_' + randomUUID() }, approvalsReviewer: frame.params.approvalsReviewer }); return true;
      }
      if (frame.method === 'turn/start') {
        const threadId = frame.params.threadId, turnId = 'turn_' + randomUUID(), notices = guardianFixtureNotice(f.workspace, threadId, turnId, 'review_' + randomUUID());
        f.guardianNotices = notices;
        f.startReview = (override = {}) => emit({ method: 'item/autoApprovalReview/started', params: { ...notices.started, ...override } });
        f.finishReview = (override = {}) => emit({ method: 'item/autoApprovalReview/completed', params: { ...notices.completed, ...override } });
        f.completeTurn = (status = 'completed') => emit({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status, items: [], error: null } } });
        emit({ method: 'turn/started', params: { threadId, turn: { id: turnId, status: 'inProgress', items: [], error: null } } });
        reply({ turn: { id: turnId, status: 'inProgress', items: [], error: null } });
        if (!options.manualReview) queueMicrotask(() => { f.startReview(); f.finishReview(); }); return true;
      }
      if (frame.method === 'thread/approveGuardianDeniedAction') { f.approvedEvent = structuredClone(frame.params.event); reply(f.wrongResult ? { unexpected: true } : {}); return true; }
      return false;
    } });
  if (options.real) f.runtime.requestMs = 20000;
  const close = f.close; f.close = async () => { try { await close(); } finally { await provider?.close(); } }; return f;
}
