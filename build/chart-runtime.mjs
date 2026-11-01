// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import { build } from 'vite';
import { cp } from 'node:fs/promises';
import { resolve } from 'node:path';

await build({ configFile: false, publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: { target: 'es2024', outDir: 'dist/charts', emptyOutDir: true, minify: true,
    lib: { entry: resolve('src/lib/workflow-chart-runtime.js'), formats: ['es'], fileName: () => 'engine.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
await cp('src/lib/workflow-chart-NOTICES.txt', 'dist/charts/NOTICES.txt');
