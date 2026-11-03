// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Share the qualified package graph between production and development workers.
export function assistantWorkerBuildOptions(outDir, entry, {write = true, inlineDynamicImports = false} = {}) {
  return {configFile: false, publicDir: false,
    resolve: {conditions: ['onnxruntime-web-use-extern-wasm', 'module', 'browser', 'production']},
    build: {target: 'es2024', outDir, emptyOutDir: false, write,
      lib: {entry, formats: ['es']},
      rollupOptions: {output: {entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]', ...(inlineDynamicImports ? {inlineDynamicImports: true} : {})}},
    },
  };
}
