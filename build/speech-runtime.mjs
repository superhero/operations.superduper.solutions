// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import { build } from 'vite';
import { resolve } from 'node:path';
import { cp, mkdir } from 'node:fs/promises';
import { parakeetSerialInitialization } from './parakeet-plugin.mjs';

// Optional speech resources have their own chunks; the main single-file client
// must not eagerly load ORT. The 26 MB Asyncify WASM is fetched by immutable pin.
await build({ configFile: false, publicDir: false,
  plugins: [parakeetSerialInitialization()],
  resolve: { alias: [{ find: /^onnxruntime-web$/, replacement: resolve('node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs') }] },
  build: { target: 'es2024', outDir: 'dist/speech', emptyOutDir: true,
    lib: { entry: { worker: resolve('src/lib/speech/inference.worker.js'), features: resolve('src/lib/speech/features.worker.js') }, formats: ['es'] },
    rollupOptions: { output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' } },
  },
});
await mkdir('dist/speech/licenses', { recursive: true });
for (const [from, to] of [
  ['src/lib/speech/NOTICES.md', 'NOTICES.md'],
  ['src/lib/speech/vendor/ten-vad/LICENSE', 'TEN-VAD-LICENSE'],
  ['src/lib/speech/vendor/ten-vad/NOTICES', 'TEN-VAD-NOTICES'],
  ['node_modules/parakeet.js/LICENSE', 'parakeet.js-LICENSE'],
  ['src/lib/speech/vendor/onnxruntime/LICENSE', 'onnxruntime-LICENSE'],
  ['src/lib/speech/vendor/onnxruntime/ThirdPartyNotices.txt', 'onnxruntime-ThirdPartyNotices.txt'],
]) await cp(from, `dist/speech/licenses/${to}`);
