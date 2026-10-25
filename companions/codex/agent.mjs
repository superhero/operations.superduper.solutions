// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, sameNativeIdentity } from '../../src/lib/native-runtime-contract.ts';
import { isNativeWorkflowMethod, nativeLoginParams, nativeWorkflowParams, nativeOwnedId, nativeRpcId } from '../../src/lib/native-agent-contract.ts';

/** A single paired owner's login/turn lifecycle, with no generic RPC proxy. */
export function createCodexAgentSession({ identity, authority, send, write, threads }) {
  const requests = new Map(), approvals = new Map();
  let login, turn, accountChanged = false;
  const bound = value => typeof value === 'string' && value.length <= 8192 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  const sameBase = value => sameNativeIdentity(identity, { ...value, accountEpoch: identity.accountEpoch });
  async function check() {
    const current = await authority();
    if (!sameBase(current) || current.accountEpoch !== identity.accountEpoch && !login) throw new Error('Native authority changed.');
    return current;
  }
  const ownedThread = id => nativeOwnedId(id) && threads.has(id) && sameNativeIdentity(threads.get(id), identity);
  function request(frame) {
    if (Object.hasOwn(frame, 'result') || Object.hasOwn(frame, 'error')) {
      const reply = nativeObject(frame, ['id', 'result']), prompt = approvals.get(reply.id);
      if (!prompt) throw new Error('Unknown native approval.');
      const result = nativeObject(reply.result, ['decision']);
      if (!['accept', 'decline', 'cancel'].includes(result.decision)) throw new Error('Unsupported approval decision.');
      approvals.delete(reply.id); write(frame); return false;
    }
    const { id, method, params } = frame;
    if (method === 'account/read') {
      nativeObject(params, ['refreshToken']); if (params.refreshToken !== false) throw new Error();
    } else if (method === 'account/login/start') {
      if (login || turn) throw new Error('The native runtime is busy.');
      const input = nativeLoginParams(params); login = { id, type: input.type, completed: false };
    } else if (method === 'account/login/cancel') {
      nativeObject(params, ['loginId']);
      if (!login?.loginId || params.loginId !== login.loginId) throw new Error('Unknown login.');
      login.cancelled = true;
    } else if (isNativeWorkflowMethod(method)) {
      nativeWorkflowParams(method, params);
      if (login || turn || !ownedThread(params.threadId) && method !== 'thread/start') throw new Error('The native thread is not owned or is busy.');
      if (method === 'turn/start') turn = { requestId: id, threadId: params.threadId };
      // Approval choices belong to the human. Browser input cannot replace the
      // host's permission profile or configure an automatic approval reviewer.
      if (method !== 'turn/start') frame = { ...frame, params: { ...params, approvalPolicy: 'on-request', approvalsReviewer: 'user' } };
    } else if (method === 'turn/interrupt') {
      nativeObject(params, ['threadId', 'turnId']);
      if (!turn?.id || params.threadId !== turn.threadId || params.turnId !== turn.id) throw new Error('Unknown native turn.');
    } else throw new Error('Unsupported native method.');
    requests.set(id, { method, params }); return frame;
  }
  async function receive(frame) {
    if (Object.hasOwn(frame, 'method')) {
      const p = frame.params;
      if (Object.hasOwn(frame, 'id')) {
        if (!nativeRpcId(frame.id) || approvals.size >= 8 || approvals.has(frame.id) || !turn?.id || !p
          || p.threadId !== turn.threadId || p.turnId !== turn.id || !nativeOwnedId(p.itemId)) throw new Error('Unowned native interaction.');
        if (frame.method !== 'item/commandExecution/requestApproval'
          || p.grantRoot != null || p.networkApprovalContext != null || p.proposedNetworkPolicyAmendments != null
          || p.proposedExecpolicyAmendment != null || p.environmentId != null || p.kind != null && p.kind !== 'command') {
          write({ id: frame.id, error: { code: -32601, message: 'This interaction is not supported by Operations.' } });
          throw new Error('Unsupported native interaction.');
        }
        if (frame.method === 'item/commandExecution/requestApproval' && (!bound(p.command) || !p.command.trim())
          || [p.reason, p.cwd].some(value => value != null && !bound(value))) throw new Error('Invalid native interaction.');
        approvals.set(frame.id, { threadId: turn.threadId, turnId: turn.id }); send(frame); return true;
      }
      if (frame.method === 'account/updated') {
        if (!login || login.cancelled) throw new Error('Account authority changed.');
        accountChanged = true; return true;
      }
      if (frame.method === 'account/login/completed') {
        if (!login || login.type === 'apiKey' || !p || typeof p.success !== 'boolean' || !nativeOwnedId(p.loginId)) throw new Error('Unowned login completion.');
        if (login.loginId && login.loginId !== p.loginId || login.early) throw new Error('Unowned login completion.');
        if (!login.loginId) { login.early = frame; return true; }
        login.completed = p.success; send(frame); return true;
      }
      if (frame.method === 'turn/started' || frame.method === 'turn/completed') {
        if (!turn || !p || p.threadId !== turn.threadId || !nativeOwnedId(p.turn?.id)
          || turn.id && turn.id !== p.turn.id) throw new Error('Unowned turn event.');
        turn.id = p.turn.id;
        if (frame.method === 'turn/completed') {
          if (!['completed', 'interrupted', 'failed'].includes(p.turn.status) || !Array.isArray(p.turn.items)) throw new Error('Invalid terminal turn.');
          if (!turn.ack) { if (turn.terminal) throw new Error(); turn.terminal = frame; return true; }
          approvals.clear(); turn = undefined;
        }
        send(frame); return true;
      }
      // Streaming/log/account data are not an unbounded channel to the page.
      return true;
    }
    const selected = requests.get(frame.id); if (!selected) return false;
    requests.delete(frame.id);
    if (Object.hasOwn(frame, 'error')) {
      if (frame.id === login?.id) login = undefined;
      if (frame.id === turn?.requestId) { turn = undefined; approvals.clear(); }
      return false;
    }
    const result = frame.result;
    if (selected.method === 'account/login/start') {
      if (!login || result?.type !== login.type) throw new Error('Invalid login acknowledgement.');
      if (login.type === 'apiKey') { nativeObject(result, ['type']); login.completed = true; }
      else {
        if (!nativeOwnedId(result.loginId)) throw new Error('Invalid login ID.');
        login.loginId = result.loginId;
        if (login.early) {
          const early = login.early; delete login.early;
          if (early.params.loginId !== login.loginId) throw new Error('Mismatched login completion.');
          login.completed = early.params.success;
          // Preserve acknowledgement-before-completion ordering on the wire.
          send(frame); send(early); return true;
        }
      }
    }
    if (selected.method === 'account/login/cancel') {
      if (accountChanged || (await authority()).accountEpoch !== identity.accountEpoch) throw new Error('Cancelled account changed.');
      login = undefined;
    }
    if (selected.method === 'account/read' && login) {
      const expectedType = login.type === 'apiKey' ? 'apiKey' : 'chatgpt';
      if (!login.completed || login.cancelled || result?.account?.type !== expectedType) throw new Error('Login is not complete.');
      const current = await check();
      Object.assign(identity, current); threads.clear(); login = undefined; accountChanged = false;
      send({ type: 'authority', identity: current });
    }
    if (selected.method === 'thread/start' || selected.method === 'thread/resume') {
      if (!nativeOwnedId(result?.thread?.id) || selected.method === 'thread/resume' && result.thread.id !== selected.params.threadId) throw new Error('Invalid native thread.');
      if (threads.size >= 64 && !threads.has(result.thread.id)) throw new Error('Native thread limit.');
      threads.set(result.thread.id, { ...identity });
    }
    if (selected.method === 'turn/start') {
      if (!turn || !nativeOwnedId(result?.turn?.id) || turn.id && turn.id !== result.turn.id) throw new Error('Invalid native turn.');
      turn.id = result.turn.id; turn.ack = true;
      if (turn.terminal) { const terminal = turn.terminal; turn = undefined; approvals.clear(); send(frame); send(terminal); return true; }
    }
    return false;
  }
  function close() {
    if (login?.loginId) { try { write({ id: 'host_cancel_login', method: 'account/login/cancel', params: { loginId: login.loginId } }); } catch { /* Owned child shutdown still cancels the wait. */ } }
    if (turn?.id) { try { write({ id: 'host_interrupt_' + turn.id, method: 'turn/interrupt', params: { threadId: turn.threadId, turnId: turn.id } }); } catch { /* Child shutdown still revokes this owner. */ } }
    requests.clear(); approvals.clear(); login = undefined; turn = undefined;
  }
  return { check, request, receive, close };
}
