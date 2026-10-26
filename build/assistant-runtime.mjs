// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Build optional engines separately so opening Assistant never loads native runtimes.
import { build } from 'vite';
import { cp, mkdir, readFile, readdir, writeFile, rm, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const digest = value => createHash('sha256').update(value).digest('hex');
const publicRoot = resolve('src/public/assistant-runtime');
const output = resolve('dist/assistant-runtime');
const receipt = JSON.parse(await readFile(`${publicRoot}/ornith/upstream/build-receipt.json`, 'utf8'));
for (const name of ['index.js', 'wllama.wasm', 'LICENCE']) {
  if (digest(await readFile(`${publicRoot}/ornith/upstream/${name}`)) !== receipt.files[name]) throw Error(`Pinned Wllama asset changed: ${name}`);
}
await rm(output, {recursive: true, force: true});
const decisionSources = JSON.parse(await readFile(`${publicRoot}/decision/sources.json`, 'utf8'));
for (const file of decisionSources.files) {
  if (digest(await readFile(resolve(file.target))) !== file.sha256) throw Error(`Decision source/artifact pin changed: ${file.target}`);
}
await mkdir(output, {recursive: true});
await cp(publicRoot, output, {recursive: true});
await build({configFile: false, publicDir: false,
  resolve: {conditions: ['onnxruntime-web-use-extern-wasm', 'module', 'browser', 'production']},
  build: {target: 'es2024', outDir: output, emptyOutDir: false,
    lib: {entry: {'gemma-worker': resolve('src/lib/assistant/runtime/litert-worker.js'),
      'vision-worker': resolve('src/lib/assistant/runtime/vision-worker.js')}, formats: ['es']},
    rollupOptions: {output: {entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]'}},
  },
});
const lite = dirname(require.resolve('@litert-lm/core/package.json'));
const hf = dirname(dirname(require.resolve('@huggingface/transformers')));
const hfRequire = createRequire(`${hf}/package.json`);
const ort = dirname(dirname(hfRequire.resolve('onnxruntime-web')));
for (const [folder, version] of [[lite, '0.18.0'], [hf, '4.3.1'], [ort, '1.31.0-dev.20260914-8d85527a0']]) {
  if (JSON.parse(await readFile(`${folder}/package.json`, 'utf8')).version !== version) throw Error(`Runtime dependency pin changed: ${folder}`);
}
await cp(`${lite}/wasm`, `${output}/litert`, {recursive: true});
await cp('src/lib/assistant/runtime/candidate-bootstrap.js', `${output}/litert/candidate-bootstrap.js`);
await mkdir(`${output}/vision-ort`, {recursive: true});
for (const file of await readdir(`${ort}/dist`)) {
  if (file.startsWith('ort-wasm-simd-threaded') && /\.(?:mjs|wasm)$/.test(file)) await cp(`${ort}/dist/${file}`, `${output}/vision-ort/${file}`);
}
for (const [name, folder] of [['litert-lm', lite], ['transformers', hf], ['vision-ort', ort]]) {
  for (const file of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'ThirdPartyNotices.txt']) {
    if ((await readdir(folder)).includes(file)) {
      await mkdir(`${output}/licenses/${name}`, {recursive: true});
      await cp(`${folder}/${file}`, `${output}/licenses/${name}/${file}`);
    }
  }
}
await writeFile(`${output}/runtime-versions.json`, JSON.stringify({litert: '0.18.0', transformers: '4.3.1', visionOrt: '1.31.0-dev.20260914-8d85527a0', speechOrt: '1.30.0', modelWeightsBundled: false}, null, 2) + '\n');

await cp('src/lib/assistant/runtime/licenses', `${output}/licenses/shared`, {recursive: true});
await cp('build/native-runtime-sources', `${output}/native-sources`, {recursive: true});
// Native Strands uses its accepted ORT1.30, isolated from LFM's ORT1.31.
for (const variant of ['strands', 'strands-native-device']) {
  const target = `${output}/decision/vendor/${variant}/ort`;
  await mkdir(target, {recursive: true});
  for (const name of ['ort.webgpu.min.mjs', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'])
    await cp(`node_modules/onnxruntime-web/dist/${name}`, `${target}/${name}`);
}
// Pages serves precompressed binaries through exact rewrites. Browser decoding
// restores the pinned Wasm bytes; the native loaders and their URLs stay intact.
const compressed = [];
async function compressLargeAssets(folder) {
  for (const entry of (await readdir(folder, {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name))) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) {await compressLargeAssets(path); continue;}
    const bytes = await readFile(path);
    if (bytes.length <= 25 * 1024 * 1024) continue;
    if (!entry.name.endsWith('.wasm')) throw Error(`Runtime asset exceeds the deployment limit: ${path}`);
    const packed = gzipSync(bytes, {level: 9});
    if (packed.length > 25 * 1024 * 1024) throw Error(`Compressed runtime still exceeds the deployment limit: ${path}`);
    await writeFile(path + '.gz', packed); await rm(path);
    compressed.push({path: path.slice(resolve('dist').length), bytes: bytes.length, sha256: digest(bytes), compressedBytes: packed.length});
  }
}
await compressLargeAssets(output);
if (compressed.length) {
  let headers = await readFile('dist/_headers', 'utf8').catch(() => '');
  let redirects = await readFile('dist/_redirects', 'utf8').catch(() => '');
  for (const item of compressed) {
    headers += `\n${item.path}\n  Content-Type: application/wasm\n  Content-Encoding: gzip\n${item.path}.gz\n  Content-Type: application/wasm\n  Content-Encoding: gzip\n`;
    redirects += `\n${item.path} ${item.path}.gz 200\n`;
  }
  await writeFile('dist/_headers', headers); await writeFile('dist/_redirects', redirects);
}
await writeFile(`${output}/compressed-assets.json`, JSON.stringify(compressed, null, 2) + '\n');
