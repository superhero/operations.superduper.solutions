// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { parseAst } from 'rolldown/parseAst';
import { Then } from '@cucumber/cucumber';
import { compactInlineWorkerModule } from '../build/inline-worker-plugin.mjs';
import { createAsyncInlineWorkerProgram, maximumAsyncWorkerBytes } from '../build/async-inline-worker.mjs';
import { decodeInlineWorkerSource, maxCompactInlineWorkerBytes } from './lib/inline-worker-codec.ts';
import { encodeSchemaPack, decodeCompactSchemaPack, compactSchemaPackPrefix, encodeAdaptiveSchemaPack, decodeAdaptiveSchemaPack, adaptiveSchemaPackPrefix } from './lib/schema-pack-codec.ts';

const id = '/fixture/worker.ts?worker&inline';
const source = 'self.onmessage=event=>self.postMessage(event.data);\n/*' + 'Repeated program 日本語 α / controls\n'.repeat(6000) + '*/';
function wrapper(program) {
  return `const jsContent = ${JSON.stringify(program)};
const blob = typeof self !== "undefined" && self.Blob && new Blob(['URL.revokeObjectURL(import.meta.url);',jsContent], {type:'text/javascript;charset=utf-8'});
export default function WorkerWrapper(options) {
  let objURL;
  try {
    objURL = blob && (self.URL || self.webkitURL).createObjectURL(blob);
    if (!objURL) throw '';
    const worker = new Worker(objURL, {type:'module',name:options?.name});
    worker.addEventListener('error',()=>{(self.URL || self.webkitURL).revokeObjectURL(objURL);});
    return worker;
  } catch(error) {
    return new Worker('data:text/javascript;charset=utf-8,'+encodeURIComponent(jsContent), {type:'module',name:options?.name});
  }
}`;
}
Then('useful inline workers decode byte for byte inside the original Vite constructor', () => {
  const before = wrapper(source), result = compactInlineWorkerModule(before, id); assert.ok(result);
  const ast = parseAst(result.code), declarations = ast.body.filter(node => node.type === 'VariableDeclaration');
  const packed = declarations.flatMap(node => node.declarations).find(node => node.id.name === '__operationsPackedWorker').init.value;
  assert.equal(decodeInlineWorkerSource(packed, result.meta.originalBytes), source);
  assert.equal(createHash('sha256').update(decodeInlineWorkerSource(packed, result.meta.originalBytes)).digest('hex'),
    createHash('sha256').update(source).digest('hex'));
  assert.ok(result.meta.originalBytes - result.meta.packedCharacters > 65536);
  assert.equal(declarations.some(node => node.declarations.some(item => item.id.name === 'blob' || item.id.name === 'jsContent')), false);
  const factory = ast.body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
  assert.equal(factory.body.body[0].declarations[0].id.name, 'jsContent');
  assert.equal(factory.body.body[1].declarations[0].id.name, 'blob');
  const originalFactory = parseAst(before).body.find(node => node.type === 'ExportDefaultDeclaration').declaration;
  assert.ok(result.code.endsWith(before.slice(originalFactory.body.start + 1)), 'Worker options, fallback, return, and URL/error handling remain exact.');
});
Then('inline worker packing bounds source sizes validates payloads and rejects compiler drift', () => {
  assert.equal(compactInlineWorkerModule(wrapper('self.postMessage(1)'), id), undefined);
  assert.equal(compactInlineWorkerModule(wrapper(source), '/fixture/ordinary.ts'), undefined);
  assert.equal(compactInlineWorkerModule(wrapper('x'.repeat(maxCompactInlineWorkerBytes + 1)), id), undefined);
  assert.throws(() => compactInlineWorkerModule('export default 42;', id), /program format changed/);
  assert.throws(() => compactInlineWorkerModule('const jsContent=' + JSON.stringify(source) + ';', id), /constructor format changed/);
  const pack = bytes => encodeSchemaPack(gzipSync(bytes)).slice(compactSchemaPackPrefix.length), bytes = Buffer.from(source);
  for (const length of [0, -1, NaN, Infinity, 1.5, maxCompactInlineWorkerBytes + 1]) assert.throws(() => decodeInlineWorkerSource(pack(bytes), length), /size/);
  assert.throws(() => decodeInlineWorkerSource(pack(bytes), bytes.length + 1), /length/);
  assert.throws(() => decodeInlineWorkerSource('!', 1));
  assert.throws(() => decodeInlineWorkerSource(pack(Uint8Array.of(255)), 1));
});
Then('only bounded schema library workers use the asynchronous bootstrap without changing their factory', () => {
  const largeSource = source + '/*' + 'large worker payload\n'.repeat(120000) + '*/';
  const before = wrapper(largeSource), result = compactInlineWorkerModule(before, '/fixture/schema-library.worker.ts?worker&inline');
  assert.ok(Buffer.byteLength(largeSource) > maxCompactInlineWorkerBytes);
  assert.equal(compactInlineWorkerModule(before, id), undefined);
  assert.equal(result.meta.mode, 'async');
  const original = parseAst(before).body[0], ast = parseAst(result.code), declaration = ast.body[0];
  assert.equal(result.code.slice(declaration.end), before.slice(original.end), 'The original Blob, worker options, fallback and URL lifecycle remain exact.');
  const bootstrap = declaration.declarations[0].init.value;
  assert.equal(Buffer.byteLength(bootstrap), result.meta.bootstrapBytes);
  assert.ok(result.meta.originalBytes - result.meta.bootstrapBytes > 65536);
  const program = parseAst(bootstrap).body[0].expression.callee.body.body.at(-1).expression;
  const packed = program.arguments[0].value;
  assert.equal(gunzipSync(packed.startsWith(adaptiveSchemaPackPrefix) ? decodeAdaptiveSchemaPack(packed.slice(adaptiveSchemaPackPrefix.length)) : decodeCompactSchemaPack(packed)).toString('utf8'), largeSource);
  assert.equal(program.arguments[1].value, Buffer.byteLength(largeSource));
  assert.match(bootstrap, /DecompressionStream\('gzip'\)/);
  assert.doesNotMatch(bootstrap, /\beval\s*\(|new Function\s*\(/);
  for (const size of [0, -1, NaN, Infinity, 1.5, maximumAsyncWorkerBytes + 1])
    assert.throws(() => createAsyncInlineWorkerProgram(packed, size), /size/);
  assert.equal(compactInlineWorkerModule(wrapper('x'.repeat(maximumAsyncWorkerBytes + 1)), '/fixture/schema-library.worker.ts?worker&inline'), undefined);
});
Then('adaptive worker transport saves bytes while legacy programs and integrity checks remain valid', () => {
  const program = 'self.onmessage=e=>self.postMessage(e.data);/*' + Array.from({ length: 8000 }, (_, i) => createHash('sha256').update(String(i)).digest('hex')).join('\n') + '*/';
  const bytes = Buffer.from(program), compressed = gzipSync(bytes, { level: 9 }), legacy = encodeSchemaPack(compressed).slice(compactSchemaPackPrefix.length), adaptive = encodeAdaptiveSchemaPack(compressed);
  assert.ok(adaptive.length < legacy.length);
  assert.equal(decodeInlineWorkerSource(legacy, bytes.length), program); assert.equal(decodeInlineWorkerSource(adaptive, bytes.length), program);
  const built = compactInlineWorkerModule(wrapper(program), id), ast = parseAst(built.code);
  const packed = ast.body.filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations).find(node => node.id.name === '__operationsPackedWorker').init.value;
  assert.equal(packed, adaptive);
  for (const invalid of [adaptiveSchemaPackPrefix + '!', adaptive + '!', adaptive.slice(0, -1)]) assert.throws(() => decodeInlineWorkerSource(invalid, bytes.length));
  assert.throws(() => decodeInlineWorkerSource(adaptive, bytes.length + 1), /length/);
  process.stdout.write(JSON.stringify({ workerSourceBytes: bytes.length, legacyCharacters: legacy.length, adaptiveCharacters: adaptive.length, savedBytes: legacy.length - adaptive.length }) + '\n');
});
