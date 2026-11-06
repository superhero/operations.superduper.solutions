// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';
import { encodeSchemaPack, compactSchemaPackPrefix } from '../src/lib/schema-pack-codec.ts';
import { createAsyncInlineWorkerProgram, maximumAsyncWorkerBytes } from './async-inline-worker.mjs';

const codec = fileURLToPath(new URL('../src/lib/inline-worker-codec.ts', import.meta.url));
const maximum = 2 * 1024 * 1024, minimumSaving = 64 * 1024;
/** Retain Vite's worker factory and exact program. Packing only bounded, useful
 * wins keeps the large schema-library program out of synchronous inflation. */
export function compactInlineWorkerModule(code, id, options = {}) {
  const maxBytes = options.maximumBytes ?? maximum, minSaving = options.minimumSaving ?? minimumSaving;
  const asyncLibrary = /(?:^|[/\\])schema-library\.worker\.ts\?worker&inline(?:$|&)/.test(id);
  const limit = asyncLibrary ? maximumAsyncWorkerBytes : maxBytes;
  if (!id.includes('worker&inline') || code.length > limit * 2 + 4096) return;
  const ast = parseAst(code), declarations = ast.body.filter(node => node.type === 'VariableDeclaration');
  const program = declarations.find(node => node.declarations.some(entry => entry.id?.name === 'jsContent'));
  const literal = program?.declarations.find(entry => entry.id?.name === 'jsContent')?.init;
  const source = literal?.value;
  if (typeof source !== 'string') throw new Error('The Vite inline worker program format changed; requalify its packing.');
  const bytes = Buffer.from(source);
  if (bytes.length > limit) return;
  const packed = encodeSchemaPack(gzipSync(bytes, { level: 9 })).slice(compactSchemaPackPrefix.length);
  if (bytes.length - packed.length < minSaving) return;
  const blob = declarations.find(node => node.declarations.some(entry => entry.id?.name === 'blob'));
  const factory = ast.body.find(node => node.type === 'ExportDefaultDeclaration')?.declaration;
  if (!blob || factory?.type !== 'FunctionDeclaration' || factory.id?.name !== 'WorkerWrapper' || !factory.body
    || program.declarations.length !== 1 || blob.declarations.length !== 1)
    throw new Error('The Vite inline worker constructor format changed; requalify its packing.');
  if (bytes.length > maxBytes) {
    const bootstrap = createAsyncInlineWorkerProgram(packed,bytes.length);
    if (bytes.length - Buffer.byteLength(bootstrap) < minSaving) return;
    return {code:code.slice(0,program.start)+`const jsContent = ${JSON.stringify(bootstrap)};`+code.slice(program.end),map:null,
      meta:{mode:'async',originalBytes:bytes.length,packedCharacters:packed.length,bootstrapBytes:Buffer.byteLength(bootstrap)}};
  }
  const blobCode = code.slice(blob.start, blob.end);
  const edits = [
    { start: program.start, end: program.end, value: `const __operationsPackedWorker = ${JSON.stringify(packed)};` },
    { start: blob.start, end: blob.end, value: '' },
    { start: factory.body.start + 1, end: factory.body.start + 1,
      value: `\nconst jsContent = __operationsDecodeWorker(__operationsPackedWorker, ${bytes.length});\n${blobCode}\n` },
  ].sort((left, right) => right.start - left.start);
  let result = code;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  return { code: `import { decodeInlineWorkerSource as __operationsDecodeWorker } from ${JSON.stringify(codec)};\n` + result,
    map: null, meta: { originalBytes: bytes.length, packedCharacters: packed.length } };
}
export function compactInlineWorkers(options = {}) {
  return { name: 'operations-compact-inline-workers', apply: 'build', enforce: 'post', transform(code, id) {
    const result = compactInlineWorkerModule(code, id);
    if (result) options.onPacked?.({ id, ...result.meta });
    return result;
  } };
}
