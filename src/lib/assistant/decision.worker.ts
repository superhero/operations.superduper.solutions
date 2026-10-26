// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
/// <reference lib="webworker" />
import {decisionProfile, checkDecisionCompatibility, validateDecisionRequest, validateDecisionResult} from './decision-models.ts';
import {encodeError} from '../worker-rpc.ts';
const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
let engine: {decide(value: unknown): Promise<unknown>; dispose(): Promise<void>} | undefined;
let busy = false;
scope.onmessage = ({data}) => {void (async () => {
  if (busy) throw new Error('One decision operation at a time.');
  busy = true;
  try {
    if (data.type === 'check' || data.type === 'load') {
      const compatibility = await checkDecisionCompatibility(data.profile, scope);
      scope.postMessage({type: 'compatibility', value: compatibility});
      if (data.type === 'check') return;
      if (!compatibility.ready) throw new Error(compatibility.summary);
      if (engine) throw new Error('Unload the previous decision model.');
      const base = new URL(data.assetBase);
      if (!['http:', 'https:'].includes(base.protocol) || base.origin !== scope.location.origin) throw new Error('Decision assets must come from this application.');
      const url = new URL('decision/engine.mjs', base).href;
      const runtime = await import(/* @vite-ignore */ `${url}`) as {loadDecisionEngine(profile: unknown, onProgress: (value: unknown) => void): Promise<NonNullable<typeof engine>>};
      engine = await runtime.loadDecisionEngine(decisionProfile(data.profile), value => scope.postMessage({type: 'progress', value}));
      scope.postMessage({type: 'ready'});
    } else if (data.type === 'decide') {
      if (!engine) throw new Error('Choose and load a decision model.');
      const request = validateDecisionRequest(data.request);
      const result = validateDecisionResult(request, await engine.decide(request));
      scope.postMessage({type: 'result', value: result});
    } else throw new Error('Unknown decision command.');
  } finally {busy = false;}
})().catch(error => {scope.postMessage({type: 'error', error: encodeError(error)});});};
