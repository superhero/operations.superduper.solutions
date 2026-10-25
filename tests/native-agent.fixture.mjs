// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomUUID } from 'node:crypto';
import { nativeHostFixture } from './native-runtime.fixture.mjs';

export async function nativeAgentFixture(options = {}) {
  let number = 0;
  return nativeHostFixture({ ...options, allowAgent: true, onFrame(frame, f, emit) {
    const reply = result => queueMicrotask(() => emit({ id: frame.id, result }));
    if (frame.method === 'account/login/start') {
      const kind = frame.params.type, loginId = 'login_' + ++number;
      f.finishLogin = (success = true, overrideId = loginId) => {
        if (success) { f.account = { type: kind === 'apiKey' ? 'apiKey' : 'chatgpt' }; f.identity.accountEpoch = randomUUID(); emit({ method: 'account/updated', params: {} }); }
        if (kind !== 'apiKey') emit({ method: 'account/login/completed', params: { loginId: overrideId, success, error: success ? null : 'Synthetic login failure' } });
      };
      const result = kind === 'apiKey' ? { type: kind } : kind === 'chatgpt' ? { type: kind, loginId, authUrl: 'https://auth.openai.com/authorize?synthetic=true' }
        : { type: kind, loginId, userCode: 'ABCD-EFGH', verificationUrl: 'https://auth.openai.com/codex/device' };
      if (kind === 'apiKey' || options.earlyLogin) f.finishLogin();
      reply(result); return true;
    }
    if (frame.method === 'account/login/cancel') { f.loginCancels = (f.loginCancels ?? 0) + 1; reply({ status: 'canceled' }); return true; }
    if (frame.method === 'thread/start' || frame.method === 'thread/resume') {
      reply({ thread: { id: frame.params.threadId ?? 'thread_' + ++number } }); return true;
    }
    if (frame.method === 'turn/start') {
      const threadId = frame.params.threadId, id = 'turn_' + ++number;
      f.completeTurn = (status = 'completed', overrideId = id) => emit({ method: 'turn/completed', params: {
        threadId, turn: { id: overrideId, status, items: [{ id: 'answer', type: 'agentMessage', text: f.terminalText ?? 'Synthetic completed result' }], error: status === 'failed' ? { message: 'Synthetic failure' } : null } } });
      emit({ method: 'turn/started', params: { threadId, turn: { id, status: 'inProgress', items: [] } } });
      reply({ turn: { id, status: 'inProgress', items: [] } });
      if (!options.manualTurn) queueMicrotask(() => emit({ id: 'approve_' + number, method: 'item/commandExecution/requestApproval', params: {
        itemId: 'item_' + number, threadId, turnId: id, startedAtMs: Date.now(), command: 'pwd', cwd: '/approved/workspace', reason: 'Inspect the approved workspace' } }));
      return true;
    }
    if (frame.method === 'turn/interrupt') { f.interrupts = (f.interrupts ?? 0) + 1; reply({}); return true; }
    if (!frame.method && frame.result?.decision) {
      f.decisions = [...f.decisions ?? [], frame.result.decision]; f.completeTurn(frame.result.decision === 'accept' ? 'completed' : 'interrupted'); return true;
    }
    return false;
  } });
}
