// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {assistantWorkerBuildOptions} from './assistant-worker-build.mjs';

/** Native ORT's variable imports must stay outside Vite's page/HMR transform.
 * Cache a production-equivalent bundle in memory, keyed by its authored inputs.
 * Serialize builds so concurrent worker requests share the same resource use. */
export function createDevelopmentVisionWorker({buildWorker} = {}) {
  let queue = Promise.resolve(), cachedKey, cached;
  return server => {
    const next = queue.then(async () => {
      const root = resolve(server.config.root, '..');
      const inputs = ['src/lib/assistant/runtime/vision-worker.js', 'src/lib/assistant/runtime/vision-runtime.js',
        'src/public/assistant-runtime/vision-engine.js', 'build/assistant-worker-build.mjs', 'package-lock.json',
        'src/lib/assistant/model-storage/runtime.ts', 'src/lib/assistant/model-storage/storage.ts',
        'src/lib/assistant/model-storage/catalog.ts', 'src/lib/assistant/model-storage/events.ts',
        'src/lib/assistant/language-profiles.json', 'src/lib/assistant/vision-profile.json', 'src/lib/assistant/vision-compatible-profile.json'];
      const signature = async () => {
        const hash = createHash('sha256');
        for (const file of inputs) {hash.update(file); hash.update(await readFile(resolve(root, file)));}
        return hash.digest('hex');
      };
      const key = await signature();
      if (key === cachedKey) return cached;
      const compile = buildWorker ?? (await import('vite')).build;
      const result = await compile({...assistantWorkerBuildOptions(resolve(server.config.cacheDir, 'operations-vision'),
        {'vision-worker': resolve(root, inputs[0])}, {write: false, inlineDynamicImports: true}), logLevel: 'warn'});
      const output = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output);
      const chunks = output.filter(file => file.type === 'chunk');
      if (chunks.length !== 1 || !chunks[0].isEntry) throw Error('The development image runtime did not produce one isolated worker.');
      if (await signature() !== key) throw Error('Image runtime sources changed while compiling. Retry the request.');
      cached = {code: chunks[0].code, assets: new Map(output.filter(file => file.type === 'asset').map(file => ['/' + file.fileName, file.source]))};
      cachedKey = key;
      return cached;
    });
    queue = next.then(() => {}, () => {});
    return next;
  };
}
