// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
/// <reference lib="webworker" />
import {decisionProfile, checkDecisionCompatibility, validateDecisionRequest, validateDecisionResult} from './decision-models.ts';
import {BrowserRuntimeOwner} from './runtime-ownership.js';
import {encodeError} from '../worker-rpc.ts';
import {prepareModelAssets, modelAssetFetch} from './model-storage/runtime.ts';
const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const networkFetch = globalThis.fetch.bind(globalThis);
let releaseAssets: (() => Promise<void>) | undefined;
let engine: {decide(value: unknown, signal?: AbortSignal): Promise<unknown>; dispose(): Promise<void>} | undefined;
let busy = false, controller: AbortController | undefined;
let unconfirmedAllocation: unknown;
let loadEngine: ((signal: AbortSignal) => Promise<NonNullable<typeof engine>>) | undefined;
const owner = new BrowserRuntimeOwner({
  async suspend() { if (unconfirmedAllocation) throw new Error('Decision initialization cleanup is unconfirmed; terminate this worker.', {cause: unconfirmedAllocation}); if (engine) {await engine.dispose(); engine = undefined; scope.postMessage({type: 'suspended'});} },
  status: message => scope.postMessage({type: 'progress', value: {message}}),
  onError: error => scope.postMessage({type: 'error', error: encodeError(error)}),
});
scope.onmessage = ({data}) => {
  if (data.type === 'dispose') {
    controller?.abort(new DOMException('Decision model unloaded.', 'AbortError'));
    void owner.close().then(async () => {await releaseAssets?.(); releaseAssets = undefined; scope.postMessage({type: 'disposed'});}).catch(error => scope.postMessage({type: 'error', error: encodeError(error)}));
    return;
  }
  void (async () => {
    if (busy) throw new Error('One decision operation at a time.');
    busy = true;
    const active = controller = new AbortController();
    try {
      const reply = await owner.run(async () => {
        if (data.type === 'check' || data.type === 'load') {
          const compatibility = await checkDecisionCompatibility(data.profile, scope);
          if (data.type === 'check') return {type: 'compatibility', value: compatibility};
          scope.postMessage({type: 'compatibility', value: compatibility});
          if (!compatibility.ready) throw new Error(compatibility.summary);
          if (loadEngine) throw new Error('Unload the previous decision model.');
          const base = new URL(data.assetBase);
          if (!['http:', 'https:'].includes(base.protocol) || base.origin !== scope.location.origin) throw new Error('Decision assets must come from this application.');
          const profile = decisionProfile(data.profile);
          const stored = ['shared-fp32-gpu-v1','strands-int4-fp32-v1'].includes(profile.native_variant ?? '');
          const modelId = 'decision:' + profile.id;
          if (stored) releaseAssets = await prepareModelAssets(modelId,
            AbortSignal.any([active.signal, AbortSignal.timeout(profile.settings.load_timeout_ms)]),
            value => scope.postMessage({type: 'progress', value}), networkFetch);
          const cachedFetch = stored ? modelAssetFetch(modelId, networkFetch) : undefined;
          // Keep an identifier template so Vite does not inject its page-only query helper.
          const url = new URL('decision/engine.mjs', base).href;
          const runtime = await import(/* @vite-ignore */ `${url}`) as {loadDecisionEngine(profile: unknown, onProgress: (value: unknown) => void, options?: unknown): Promise<NonNullable<typeof engine>>};
          loadEngine = async signal => {try {return await runtime.loadDecisionEngine(profile, value => scope.postMessage({type: 'progress', value}),
            {fetch: cachedFetch, signal: AbortSignal.any([signal, AbortSignal.timeout(profile.settings.load_timeout_ms)])});} catch (error) {unconfirmedAllocation = error instanceof Error ? error : new Error("Native allocation failed.", {cause: error}); throw error;}};
          engine = await loadEngine(active.signal); active.signal.throwIfAborted();
          return {type: 'ready'};
        } else if (data.type === 'decide') {
          if (!loadEngine) throw new Error('Choose and load a decision model.');
          const request = validateDecisionRequest(data.request);
          if (!engine) engine = await loadEngine(active.signal);
          active.signal.throwIfAborted();
          return {type: 'result', value: validateDecisionResult(request, await engine.decide(request, active.signal))};
        }
        throw new Error('Unknown decision command.');
      }, {signal: active.signal, resident: data.type !== 'check'});
      scope.postMessage({...reply, suspended: !engine});
    } finally {busy = false; if (controller === active) controller = undefined;}
  })().catch(error => scope.postMessage({type: 'error', error: encodeError(error)}));
};
