// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { parseAst } from 'rolldown/parseAst';
import { Then } from '@cucumber/cucumber';
import { compactInlineWorkerModule } from '../build/inline-worker-plugin.mjs';
import { decodeInlineWorkerSource, maxCompactInlineWorkerBytes } from './lib/inline-worker-codec.ts';
import { encodeSchemaPack, compactSchemaPackPrefix } from './lib/schema-pack-codec.ts';

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
