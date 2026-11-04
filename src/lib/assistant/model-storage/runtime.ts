// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import {artifactsFor, profileById, type Progress} from './catalog.ts';
import {acquireModelUse, installModel, installedFetch} from './storage.ts';

/** Acquire logical use before installation so removal cannot race the marker. */
export async function prepareModelAssets(id: string, signal: AbortSignal, progress: (event: Progress) => void,
  network: typeof fetch = globalThis.fetch): Promise<() => Promise<void>> {
  const release = await acquireModelUse(id, signal);
  try { await installModel(id, progress, signal, globalThis.location?.href, network); signal.throwIfAborted(); return release; }
  catch (error) { await release(); throw error; }
}

/** Bundled application resources and local image bytes use the native reader.
 * Remote model/runtime requests must resolve to this exact installed catalog. */
export function modelAssetFetch(id: string, network: typeof fetch = globalThis.fetch): typeof fetch {
  const local = installedFetch(artifactsFor(profileById(id)));
  return (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, globalThis.location?.href);
    const localImage = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(url.href);
    return localImage || url.origin === globalThis.location?.origin ? network(input, init) : local(input, init);
  };
}
