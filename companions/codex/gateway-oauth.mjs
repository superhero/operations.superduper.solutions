// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { nativeObject, sameNativeIdentity } from '../../src/lib/native-runtime-contract.ts';
import { nativeGatewayOAuthParams, nativeGatewayOAuthNotification } from '../../src/lib/native-gateway-oauth.ts';

/** One secondary sign-in owner, with native completion and credential-store confirmation. */
export function createCodexGatewayOAuthSession({ identity, authority, prepare, checkAuthority, review, reviewNotice, finish, send, write }) {
  const requests = new Map(), cancelled = new Set();
  let login, cancellation, closed = false;
  async function check() {
    if (closed) throw new Error('Gateway sign-in owner closed.');
    const current = login ? await checkAuthority(login.context) : await authority();
    if (!sameNativeIdentity(identity, login ? { ...current, accountEpoch: identity.accountEpoch } : current)) throw new Error('Gateway sign-in authority changed.');
    return current;
  }
  const failure = id => ({ id, error: { code: -32000, message: 'Gateway sign-in did not complete.' } });
  async function request(frame) {
    await check(); nativeGatewayOAuthParams(frame.params);
    if (frame.method === 'account/gatewayOAuth/login') {
      if (login || cancellation || requests.size) throw new Error('Gateway sign-in is already pending.');
      login = { id: frame.id, context: await prepare(), handoff: false };
    } else if (frame.method === 'account/gatewayOAuth/cancel') {
      if (cancellation || requests.size && !login) throw new Error('Gateway cancellation is already pending.');
      cancellation = { id: frame.id };
    } else throw new Error('Unsupported gateway control.');
    requests.set(frame.id, frame.method);
    return { ...frame, params: null };
  }
  async function receive(frame) {
    if (Object.hasOwn(frame, 'method')) {
      if (Object.hasOwn(frame, 'id')) { write({ id: frame.id, error: { code: -32601, message: 'Interaction unavailable in this profile.' } }); return true; }
      await check();
      if (frame.method === nativeGatewayOAuthNotification && login) {
        const params = nativeObject(frame.params, ['authUrl', 'providerId', 'status', 'error']);
        if (params.providerId !== login.context.providerId || !['notReady', 'started', 'succeeded', 'failed'].includes(params.status)) throw new Error('Foreign gateway notification.');
        if (params.authUrl !== null) {
          if (params.status !== 'started' || params.error !== null || login.handoff || cancellation) throw new Error('Unexpected gateway handoff.');
          const authUrl = await reviewNotice(login.context, params.authUrl);
          login.handoff = true; send({ method: nativeGatewayOAuthNotification, params: { providerId: params.providerId, authUrl } });
        }
      }
      return true;
    }
    const method = requests.get(frame.id);
    if (!method) return false;
    requests.delete(frame.id); await check();
    if (method === 'account/gatewayOAuth/cancel') {
      nativeObject(frame.result, []);
      if (!cancellation || cancellation.id !== frame.id) throw new Error('Unowned gateway cancellation.');
      cancellation = undefined;
      if (login) {
        const pending = login;
        await finish(pending.context, true); login = undefined;
        cancelled.add(pending.id); if (cancelled.size > 64) throw new Error('Gateway cancellation limit.');
        send({ id: frame.id, result: {} });
        if (pending.error) { cancelled.delete(pending.id); send(failure(pending.id)); }
      } else send({ id: frame.id, result: {} });
      return true;
    }
    if (!login || login.id !== frame.id) {
      if (!cancelled.delete(frame.id) || !Object.hasOwn(frame, 'error')) throw new Error('Unexpected late gateway result.');
      send(failure(frame.id)); return true;
    }
    if (Object.hasOwn(frame, 'error')) {
      if (cancellation) { login.error = true; return true; }
      await finish(login.context, true); login = undefined; send(failure(frame.id)); return true;
    }
    if (cancellation || !login.handoff) throw new Error('Gateway completion has no owned handoff.');
    nativeObject(frame.result, []);
    const current = await review(login.context);
    await finish(login.context, false); login = undefined;
    Object.assign(identity, current); send({ type: 'authority', identity: { ...identity } });
    send({ id: frame.id, result: {} }); return true;
  }
  return { check, request, receive, close() { closed = true; requests.clear(); if (login) void finish(login.context, true).catch(() => {}); login = undefined; } };
}
