// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeHostFixture } from './native-runtime.fixture.mjs';
import { seedNativeAccountBackend } from './native-account-read-sdk.fixture.mjs';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';
import { sameNativeIdentity } from '../src/lib/native-runtime-contract.ts';
export async function seedNativeGateway({ home, backend }) {
  const origin = backend.origin;
  await writeFile(join(home, 'config.toml'), 'model_provider="owned_gateway"\nmodel="owned-gateway-model"\n[features]\nsecret_auth_storage=true\n'
    + '[model_providers.owned_gateway]\nname="Owned gateway fixture"\nbase_url=' + JSON.stringify(origin + '/v1') + '\nwire_api="responses"\nrequires_openai_auth=false\n'
    + '[model_providers.owned_gateway.gateway_oauth]\nauthorization_url=' + JSON.stringify(origin + '/authorize') + '\ntoken_url=' + JSON.stringify(origin + '/token')
    + '\nclient_id="operations-owned-gateway"\ndelivery={kind="header",name="X-Gateway-Authorization"}\n', { mode: 0o600 });
}

export async function nativeGatewayFixture(options = {}) {
  let backend, fixture;
  try {
    fixture = await nativeHostFixture({ ...options, allowGatewayOAuth: options.allowGatewayOAuth ?? true, allowAgent: false,
      async runtimeFactory(f) {
        let pending, current;
        if (options.real) {
          backend = await seedNativeAccountBackend(f.home); f.backend = backend; await rm(join(f.home, 'auth.json'));
          await seedNativeGateway({ home: f.home, backend });
          const real = await openCodexRuntime({ runtimeId: f.identity.runtimeId, home: f.home, workspace: f.workspace, allowGatewayOAuth: true,
            executable: process.env.OPERATIONS_CODEX_QUALIFICATION_BINARY, binarySha256: process.env.OPERATIONS_CODEX_QUALIFICATION_SHA256 });
          return { ...real, async prepareGatewayOAuth() {
            try { return await real.prepareGatewayOAuth(); }
            catch (error) {
              const effective = await real.inspectConfiguration().catch(() => null);
              f.gatewayDiagnostics = { stage: 'prepare', type: error.constructor.name, configKeys: Object.keys(effective?.config ?? {}),
                providerKeys: Object.keys(effective?.config?.model_providers?.owned_gateway ?? {}) };
              throw error;
            }
          }, async start(receive, exited) {
            f.starts++; const child = await real.start(receive, exited); let stopped = false;
            return { send(frame) { f.frames.push(structuredClone(frame)); child.send(frame); }, async close() { await child.close(); if (!stopped) { stopped = true; f.stops++; } } };
          } };
        }
        const authority = async () => structuredClone(f.identity);
        f.primaryEpoch = 1;
        const check = async context => {
          if (current !== context || f.primaryEpoch !== context.primary || !sameNativeIdentity(context.before, { ...f.identity, accountEpoch: context.before.accountEpoch })) throw new Error('Owned gateway fixture authority changed.');
          return authority();
        };
        return { authority,
          async prepareGatewayOAuth() { if (current) throw new Error('Owned gateway fixture busy.'); return current = { providerId: 'owned_gateway', primary: f.primaryEpoch, before: await authority() }; },
          gatewayOAuthAuthority: check,
          async reviewGatewayOAuthNotice(context, authUrl) { await check(context); if (new URL(authUrl).origin !== 'https://gateway.example.test') throw new Error('Foreign handoff.'); return authUrl; },
          async reviewGatewayOAuth(context) { await check(context); if (!f.gatewaySucceeded) throw new Error('Unconfirmed gateway fixture.'); return authority(); },
          async finishGatewayOAuth(context, cancelled) { await check(context); if (cancelled && context.before.accountEpoch !== f.identity.accountEpoch) throw new Error('Changed cancelled credentials.'); current = undefined; },
          async start(receive, exited) {
            f.starts++; let stopped = false;
            return { send(frame) {
              f.frames.push(structuredClone(frame)); if (!Object.hasOwn(frame, 'id')) return;
              const emit = value => queueMicrotask(() => { if (!stopped) receive(value); });
              if (options.onFrame?.(frame, f, emit) === true) return;
              if (frame.method === 'initialize') return emit({ id: frame.id, result: { userAgent: 'owned-gateway-fixture', codexHome: f.home, platformFamily: 'unix', platformOs: 'linux' } });
              if (frame.method === 'account/read') return emit({ id: frame.id, result: { account: null, requiresOpenaiAuth: false } });
              if (frame.method === 'account/gatewayOAuth/login') {
                pending = frame.id; f.gatewaySucceeded = false;
                f.finishGateway = () => { f.gatewaySucceeded = true; f.identity.accountEpoch = randomUUID(); emit({ id: pending, result: {} }); pending = undefined; };
                return emit({ method: 'account/gatewayOAuth/changed', params: { providerId: 'owned_gateway', status: 'started', authUrl: 'https://gateway.example.test/authorize?state=owned', error: null } });
              }
              if (frame.method === 'account/gatewayOAuth/cancel') {
                const error = pending ? { id: pending, error: { code: -32000, message: 'Owned fixture cancelled.' } } : undefined;
                if (options.errorFirst && error) emit(error);
                emit({ id: frame.id, result: {} }); if (!options.errorFirst && error) emit(error); pending = undefined; return;
              }
              throw new Error('Unreviewed gateway fixture method.');
            }, async close() { if (!stopped) { stopped = true; f.stops++; current = undefined; exited(); } } };
          } };
      } });
  } catch (error) { await backend?.close(); throw error; }
  const close = fixture.close; fixture.close = async () => { try { await close(); } finally { await backend?.close(); } };
  if (options.real) fixture.runtime.requestMs = 15000;
  return fixture;
}
