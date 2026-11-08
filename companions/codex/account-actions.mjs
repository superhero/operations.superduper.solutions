// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomUUID } from 'node:crypto';
import { nativeObject, sameNativeIdentity } from '../../src/lib/native-runtime-contract.ts';
import { nativeAccountActionParams, nativeAccountActionResult, nativeAccountActionApprovalMethod, isNativeAccountActionMethod } from '../../src/lib/native-account-actions.ts';
import { reviewNativeAccountMetadata, reviewNativeAccountPrivateEcho } from './account-read.mjs';

export async function prepareNativeAccountAction(method, input, context) {
  const params = nativeAccountActionParams(method, input), identity = await context.authority();
  const account = await reviewNativeAccountMetadata(await context.account(), context.home);
  const plan = { method, params, identity, account };
  await checkNativeAccountAction(plan, context); return plan;
}
export async function checkNativeAccountAction(plan, context) {
  if (!sameNativeIdentity(plan.identity, await context.authority())) throw new Error('Native account action authority changed.');
  const account = await reviewNativeAccountMetadata(await context.account(), context.home);
  if (JSON.stringify(account) !== JSON.stringify(plan.account) || !sameNativeIdentity(plan.identity, await context.authority())) throw new Error('Native account action identity changed.');
}
export async function reviewNativeAccountAction(plan, value, context) {
  const result = nativeAccountActionResult(plan.method, value);
  await checkNativeAccountAction(plan, context); await reviewNativeAccountPrivateEcho(result, context.home);
  if (!sameNativeIdentity(plan.identity, await context.authority())) throw new Error('Native account action authority changed.');
  return result;
}

/** A human authorizes one exact account action before any native action RPC is sent. */
export function createCodexAccountActionSession({ identity, authority, accountUpdateIsUnchanged, prepare, checkAction, review, send, write }) {
  let action, closed = false;
  async function check() {
    if (closed || !sameNativeIdentity(identity, await authority())) throw new Error('Native account action authority changed.');
  }
  async function request(frame) {
    await check();
    if (Object.hasOwn(frame, 'result') || Object.hasOwn(frame, 'error')) {
      const reply = nativeObject(frame, ['id', 'result']), decision = nativeObject(reply.result, ['decision']);
      if (!action || action.dispatched || action.approvalId !== reply.id || decision.decision !== 'accept') throw new Error('Native account action was not approved.');
      await checkAction(action.plan); await check();
      action.dispatched = true; write({ id: action.id, method: action.plan.method, params: action.plan.params }); return false;
    }
    if (action || !isNativeAccountActionMethod(frame.method)) throw new Error('Unsupported or busy account action.');
    const plan = await prepare(frame.method, nativeAccountActionParams(frame.method, frame.params)); await check();
    if (!sameNativeIdentity(identity, plan.identity)) throw new Error('Unowned account action plan.');
    action = { id: frame.id, approvalId: randomUUID(), plan, dispatched: false };
    send({ id: action.approvalId, method: nativeAccountActionApprovalMethod, params: { requestId: action.id, method: plan.method, params: plan.params, account: plan.account } });
    return false;
  }
  async function receive(frame) {
    await check();
    if (Object.hasOwn(frame, 'method')) {
      if (Object.hasOwn(frame, 'id')) write({ id: frame.id, error: { code: -32601, message: 'Interaction unavailable in this profile.' } });
      else if (frame.method === 'account/updated' && !(await accountUpdateIsUnchanged?.(identity))) throw new Error('Native account authority changed.');
      return true;
    }
    if (!action || frame.id !== action.id) return false;
    if (!action.dispatched) throw new Error('Native action was not approved.');
    if (Object.hasOwn(frame, 'error')) { send({ id: frame.id, error: { code: -32000, message: 'Native account action did not complete.' } }); action = undefined; return true; }
    const result = await review(action.plan, frame.result); await check();
    action = undefined; send({ id: frame.id, result }); return true;
  }
  return { request, receive, check, close() { closed = true; action = undefined; } };
}
