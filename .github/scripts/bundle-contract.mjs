// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import { lstatSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const BUNDLE_FILES = ['_headers', 'apple-touch-icon.png', 'favicon.bmp', 'favicon.gif', 'favicon.ico',
  'favicon.jpg', 'favicon.png', 'favicon.ppm', 'favicon.svg', 'favicon.tiff', 'index.html'];
export const OAUTH_FILES = ['oauth/bluesky-client-metadata.json'];
export const SPEECH_FILES = ['speech/worker.js', 'speech/features.js', 'speech/licenses/NOTICES.md',
  'speech/licenses/TEN-VAD-LICENSE', 'speech/licenses/TEN-VAD-NOTICES', 'speech/licenses/parakeet.js-LICENSE',
  'speech/licenses/onnxruntime-LICENSE', 'speech/licenses/onnxruntime-ThirdPartyNotices.txt'];
// Pinned optional native build assets; hashed worker chunks are checked separately.
export const ASSISTANT_FILES = [
  "assistant-runtime/chunks/transformers.web-SzAWJJQT.js",
  "assistant-runtime/compressed-assets.json",
  "assistant-runtime/decision/context-guard.mjs",
  "assistant-runtime/decision/elephant-OneJev.LICENSE",
  "assistant-runtime/decision/elephant-browser.mjs",
  "assistant-runtime/decision/elephant-prompt.mjs",
  "assistant-runtime/decision/engine.mjs",
  "assistant-runtime/decision/knowline-browser.mjs",
  "assistant-runtime/decision/knowline-prompt.mjs",
  "assistant-runtime/decision/load-progress.mjs",
  "assistant-runtime/decision/pplx-browser.mjs",
  "assistant-runtime/decision/pplx-prompt.mjs",
  "assistant-runtime/decision/pplx-publisher-LICENSE",
  "assistant-runtime/decision/pplx-publisher-NOTICE",
  "assistant-runtime/decision/range-blob.mjs",
  "assistant-runtime/decision/sources.json",
  "assistant-runtime/decision/vendor/hf-jinja/LICENSE",
  "assistant-runtime/decision/vendor/hf-jinja/index.js",
  "assistant-runtime/decision/vendor/hf-tokenizers/LICENSE",
  "assistant-runtime/decision/vendor/hf-tokenizers/tokenizers.mjs",
  "assistant-runtime/decision/vendor/strands-native-device/js/decider-client.js",
  "assistant-runtime/decision/vendor/strands-native-device/js/head.js",
  "assistant-runtime/decision/vendor/strands-native-device/js/prompt.js",
  "assistant-runtime/decision/vendor/strands-native-device/js/worker.js",
  "assistant-runtime/decision/vendor/strands-native-device/ort/ort-wasm-simd-threaded.asyncify.mjs",
  "assistant-runtime/decision/vendor/strands-native-device/ort/ort-wasm-simd-threaded.asyncify.wasm.gz",
  "assistant-runtime/decision/vendor/strands-native-device/ort/ort.webgpu.min.mjs",
  "assistant-runtime/decision/vendor/strands-native-device/tokenizers/tokenizers.min.mjs",
  "assistant-runtime/decision/vendor/strands/js/decider-client.js",
  "assistant-runtime/decision/vendor/strands/js/head.js",
  "assistant-runtime/decision/vendor/strands/js/prompt.js",
  "assistant-runtime/decision/vendor/strands/js/worker.js",
  "assistant-runtime/decision/vendor/strands/ort/ort-wasm-simd-threaded.asyncify.mjs",
  "assistant-runtime/decision/vendor/strands/ort/ort-wasm-simd-threaded.asyncify.wasm.gz",
  "assistant-runtime/decision/vendor/strands/ort/ort.webgpu.min.mjs",
  "assistant-runtime/decision/vendor/strands/tokenizers/tokenizers.min.mjs",
  "assistant-runtime/decision/vendor/wllama-d3-inspect/LICENCE",
  "assistant-runtime/decision/vendor/wllama-d3-inspect/build-receipt.json",
  "assistant-runtime/decision/vendor/wllama-d3-inspect/index.js",
  "assistant-runtime/decision/vendor/wllama-d3-inspect/wllama.wasm",
  "assistant-runtime/decision/vendor/wllama-elephant/LICENCE",
  "assistant-runtime/decision/vendor/wllama-elephant/build-receipt.json",
  "assistant-runtime/decision/vendor/wllama-elephant/index.js",
  "assistant-runtime/decision/vendor/wllama-elephant/wllama.wasm",
  "assistant-runtime/decision/vendor/wllama-pplx-v3/LICENCE",
  "assistant-runtime/decision/vendor/wllama-pplx-v3/build-receipt.json",
  "assistant-runtime/decision/vendor/wllama-pplx-v3/index.js",
  "assistant-runtime/decision/vendor/wllama-pplx-v3/wllama.wasm",
  "assistant-runtime/decision/vendor/wllama/LICENCE",
  "assistant-runtime/decision/vendor/wllama/index.js",
  "assistant-runtime/decision/vendor/wllama/wllama.wasm",
  "assistant-runtime/execution.js",
  "assistant-runtime/gemma-worker.js",
  "assistant-runtime/licenses/shared/LiteRT-LM-APACHE-2.0.txt",
  "assistant-runtime/licenses/shared/Strands-LICENSE",
  "assistant-runtime/licenses/shared/Strands-ORT1.30-LICENSE",
  "assistant-runtime/licenses/shared/Strands-ORT1.30-ThirdPartyNotices.txt",
  "assistant-runtime/licenses/shared/Strands-THIRD_PARTY_NOTICES.md",
  "assistant-runtime/licenses/shared/llama.cpp-LICENSE",
  "assistant-runtime/licenses/transformers/LICENSE",
  "assistant-runtime/litert/candidate-bootstrap.js",
  "assistant-runtime/litert/litertlm_wasm_asyncify_internal.js",
  "assistant-runtime/litert/litertlm_wasm_asyncify_internal.wasm.gz",
  "assistant-runtime/litert/litertlm_wasm_compat_asyncify_internal.js",
  "assistant-runtime/litert/litertlm_wasm_compat_asyncify_internal.wasm.gz",
  "assistant-runtime/litert/litertlm_wasm_compat_internal.js",
  "assistant-runtime/litert/litertlm_wasm_compat_internal.wasm",
  "assistant-runtime/litert/litertlm_wasm_internal.js",
  "assistant-runtime/litert/litertlm_wasm_internal.wasm",
  "assistant-runtime/load-language.mjs",
  "assistant-runtime/native-sources/README.md",
  "assistant-runtime/native-sources/base/build.sh",
  "assistant-runtime/native-sources/base/upstream-api.patch",
  "assistant-runtime/native-sources/d3-inspect/build.sh",
  "assistant-runtime/native-sources/d3-inspect/context-variant.json",
  "assistant-runtime/native-sources/d3-inspect/d3-inspect.patch",
  "assistant-runtime/native-sources/d3-inspect/upstream-api.patch",
  "assistant-runtime/native-sources/elephant/build.sh",
  "assistant-runtime/native-sources/elephant/elephant-native.patch",
  "assistant-runtime/native-sources/elephant/upstream-api.patch",
  "assistant-runtime/native-sources/pplx/build.sh",
  "assistant-runtime/native-sources/pplx/pplx-native.patch",
  "assistant-runtime/native-sources/pplx/upstream-api.patch",
  "assistant-runtime/ornith/engine.mjs",
  "assistant-runtime/ornith/range-blob.mjs",
  "assistant-runtime/ornith/settings.js",
  "assistant-runtime/ornith/upstream/LICENCE",
  "assistant-runtime/ornith/upstream/build-receipt.json",
  "assistant-runtime/ornith/upstream/index.js",
  "assistant-runtime/ornith/upstream/wllama.wasm",
  "assistant-runtime/runtime-versions.json",
  "assistant-runtime/settings.js",
  "assistant-runtime/text-engines.js",
  "assistant-runtime/text-protocol.js",
  "assistant-runtime/vision-engine.js",
  "assistant-runtime/vision-ort/ort-wasm-simd-threaded.asyncify.mjs",
  "assistant-runtime/vision-ort/ort-wasm-simd-threaded.asyncify.wasm.gz",
  "assistant-runtime/vision-ort/ort-wasm-simd-threaded.jsep.mjs",
  "assistant-runtime/vision-ort/ort-wasm-simd-threaded.jsep.wasm.gz",
  "assistant-runtime/vision-ort/ort-wasm-simd-threaded.jspi.mjs",
  "assistant-runtime/vision-ort/ort-wasm-simd-threaded.jspi.wasm",
  "assistant-runtime/vision-ort/ort-wasm-simd-threaded.mjs",
  "assistant-runtime/vision-ort/ort-wasm-simd-threaded.wasm",
  "assistant-runtime/vision-worker.js"
];
const assistantChunk = /^assistant-runtime\/chunks\/[A-Za-z0-9_-]+\.js$/;
const chunk = /^speech\/chunks\/[A-Za-z0-9_-]+\.js$/;

// Retain legacy complete bundles for validation reuse. Public OAuth metadata is
// an explicit optional asset; speech still requires its complete runtime.
export function validBundlePaths(paths) {
  if (!Array.isArray(paths) || new Set(paths).size !== paths.length || !BUNDLE_FILES.every(path => paths.includes(path))) return false;
  const assistant = paths.some(path => path.startsWith('assistant-runtime/'));
  if (!paths.every(path => BUNDLE_FILES.includes(path) || OAUTH_FILES.includes(path) || SPEECH_FILES.includes(path) || chunk.test(path)
    || assistant && (path === '_redirects' || ASSISTANT_FILES.includes(path) || assistantChunk.test(path)))) return false;
  if (assistant && (!paths.includes('_redirects') || !ASSISTANT_FILES.every(path => paths.includes(path)) || !paths.some(path => assistantChunk.test(path)))) return false;
  return !paths.some(path => path.startsWith('speech/'))
    || SPEECH_FILES.every(path => paths.includes(path)) && paths.some(path => chunk.test(path));
}

export function listBundleFiles(directory) {
  const absolute = resolve(directory), paths = [];
  for (let path = absolute; ; path = dirname(path)) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid bundle directory.');
    if (dirname(path) === path) break;
  }
  function visit(relative = '') {
    const entries = readdirSync(join(absolute, relative));
    if (!entries.length) throw new Error('Empty bundle directory.');
    for (const name of entries) {
      if (name.startsWith('.') || /[\0\r\n\\]/.test(name)) throw new Error('Unsupported bundle filename.');
      const path = relative ? `${relative}/${name}` : name, stat = lstatSync(join(absolute, path));
      if (stat.isSymbolicLink()) throw new Error('Bundle contains a symlink.');
      if (stat.isDirectory()) visit(path);
      else {
        if (!stat.isFile() || !stat.size || stat.size > 25 * 1024 ** 2) throw new Error('Invalid bundle file or Pages size limit exceeded.');
        paths.push(path);
      }
    }
  }
  visit();
  if (!validBundlePaths(paths)) throw new Error('Incomplete or unsupported application bundle.');
  return paths.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Expected bundle directory.');
    process.stdout.write(listBundleFiles(process.argv[2]).join('\0') + '\0');
  } catch { process.stderr.write('Invalid deployment bundle contents.\n'); process.exitCode = 1; }
}
