// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import { createReadStream, existsSync } from 'node:fs';
import { resolve, sep, dirname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export function assistantRuntimeDevelopment() {
  return {name: 'operations-assistant-runtimes', apply: 'serve', configureServer(server) {
    server.middlewares.use('/assistant-runtime', async (request, response, next) => {
      const path = decodeURIComponent((request.url || '/').split('?')[0]);
      const built = resolve('dist/assistant-runtime');
      let file = resolve(built, '.' + path);
      if (!file.startsWith(built + sep)) return next();
      if (!existsSync(file) && path.startsWith('/litert/')) {
        const folder = resolve(dirname(require.resolve('@litert-lm/core/package.json')), 'wasm');
        file = resolve(folder, '.' + path.slice('/litert'.length));
        if (!file.startsWith(folder + sep)) return next();
        if (path === '/litert/candidate-bootstrap.js') file = resolve('src/lib/assistant/runtime/candidate-bootstrap.js');
      }
      if (!existsSync(file) && path.startsWith('/vision-ort/')) {
        const hf = dirname(dirname(require.resolve('@huggingface/transformers')));
        const hfRequire = createRequire(resolve(hf, 'package.json'));
        const folder = resolve(dirname(dirname(hfRequire.resolve('onnxruntime-web'))), 'dist');
        file = resolve(folder, '.' + path.slice('/vision-ort'.length));
        if (!file.startsWith(folder + sep)) return next();
      }
      const strands = path.match(/^\/decision\/vendor\/strands(?:-native-device)?\/ort\/(.+)$/);
      if (!existsSync(file) && strands) {
        const folder = resolve('node_modules/onnxruntime-web/dist'); file = resolve(folder, strands[1]);
        if (!file.startsWith(folder + sep)) return next();
      }
      let compressed = false;
      if (!existsSync(file) && existsSync(file + '.gz')) {file += '.gz'; compressed = true;}
      if (existsSync(file)) {
        for (const [name, value] of Object.entries(server.config.server.headers || {})) if (value !== undefined) response.setHeader(name, value);
        if (compressed || file.endsWith('.wasm.gz')) response.setHeader('Content-Encoding', 'gzip');
        response.setHeader('Content-Type', (file.endsWith('.wasm') || compressed) ? 'application/wasm' : file.endsWith('.json') ? 'application/json' : 'text/javascript');
        createReadStream(file).on('error', next).pipe(response); return;
      }
      const source = {'/gemma-worker.js': '/lib/assistant/runtime/litert-worker.js', '/vision-worker.js': '/lib/assistant/runtime/vision-worker.js'}[path];
      if (!source) return next();
      try {
        const transformed = await server.transformRequest(source);
        if (!transformed) return next();
        response.setHeader('Content-Type', 'text/javascript'); response.end(transformed.code);
      } catch (error) {next(error);}
    });
  }};
}
