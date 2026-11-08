// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Then } from '@cucumber/cucumber';
import { encodeSchemaPack, decodeCompactSchemaPack, compactSchemaPackPrefix as prefix } from './lib/schema-pack-codec.ts';
import { encodeAdaptiveSchemaPack, decodeAdaptiveSchemaPack, adaptiveSchemaPackPrefix as adaptivePrefix } from './lib/schema-pack-codec.ts';
import { encodeSchemaPack91, decodeCompactSchemaPack91, compactSchemaPack91Prefix as prefix91 } from './lib/schema-pack-codec.ts';
import { decodeServiceSchema, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { compactSchemaPacks } from '../build/schema-pack-plugin.mjs';

const decode = encoded => encoded.startsWith(adaptivePrefix) ? decodeAdaptiveSchemaPack(encoded.slice(adaptivePrefix.length)) : encoded.startsWith(prefix91) ? decodeCompactSchemaPack91(encoded.slice(prefix91.length)) : decodeCompactSchemaPack(encoded.slice(prefix.length));
Then('compact schema encoding roundtrips every bundled gzip file and partial byte group', async () => {
  assert.equal(encodeSchemaPack(new Uint8Array([0, 0, 0, 0])), prefix + '!!!!!');
  assert.deepEqual(decodeCompactSchemaPack('!!!!!'), new Uint8Array(4));
  for (let length = 0; length < 33; length++) for (const byte of [0, 255, undefined]) {
    const bytes = Uint8Array.from({ length }, (_, index) => byte ?? (index * 37 + length) % 256);
    const packed = encodeSchemaPack(bytes);
    assert.deepEqual(decode(packed), bytes); assert.doesNotMatch(packed.slice(prefix.length), /["'`\\<>/&?\s]/);
  }
  let count = 0;
  for (const directory of ['src/catalogs/services', 'src/catalogs/services/indexes'])
    for (const file of (await readdir(directory)).filter(file => file.endsWith('.json.gz'))) {
      const bytes = await readFile(`${directory}/${file}`);
      assert.deepEqual(Buffer.from(decode(encodeSchemaPack(bytes))), bytes, file); count++;
    }
  assert.equal(count, serviceSchemaDescriptors.length * 2);
});
Then('compact schema decoding rejects invalid lengths characters and overflowing groups', () => {
  for (const encoded of ['!', '!!!!!!']) assert.throws(() => decodeCompactSchemaPack(encoded), /length/);
  for (const encoded of ['<!!', '\\!!', ' !!', 'é!!']) assert.throws(() => decodeCompactSchemaPack(encoded), /character/);
  assert.throws(() => decodeCompactSchemaPack('~~~~~'), /value/);
});
Then('compact schema documents retain the same length hash and JSON checks', async () => {
  const document = { openapi: '3.1.0', info: { title: 'Compact transport', version: '1' }, paths: {} };
  const bytes = Buffer.from(JSON.stringify(document)), packed = encodeSchemaPack(gzipSync(bytes));
  const metadata = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  for (const value of [packed, encodeSchemaPack91(gzipSync(bytes)), encodeAdaptiveSchemaPack(gzipSync(bytes)), 'data:application/gzip;base64,' + gzipSync(bytes).toString('base64')]) {
    assert.deepEqual(await decodeServiceSchema(value, metadata), document);
    await assert.rejects(decodeServiceSchema(value, { ...metadata, sha256: '0'.repeat(64) }), /recorded hash/);
    await assert.rejects(decodeServiceSchema(value, { ...metadata, bytes: bytes.length - 1 }), /recorded size/);
  }
  await assert.rejects(decodeServiceSchema(prefix, metadata), /metadata is invalid/);
  await assert.rejects(decodeServiceSchema(packed, { ...metadata, sha256: '0'.repeat(64) }), /recorded hash/);
  await assert.rejects(decodeServiceSchema(packed, { ...metadata, bytes: bytes.length - 1 }), /recorded size/);
});
Then('the compact schema build plugin leaves other assets alone', async () => {
  const plugin = compactSchemaPacks(), file = new URL('./catalogs/services/twilio.json.gz', import.meta.url).pathname;
  for (const id of ['/outside/twilio.json.gz?url&inline', file, file + '?url', file + '?inline', file + '.js?url&inline'])
    assert.equal(await plugin.load(id), undefined);
  const module = await plugin.load(file + '?url&inline'), packed = JSON.parse(module.slice('export default '.length, -1));
  assert.deepEqual(Buffer.from(decode(packed)), await readFile(file));
  assert.ok(packed.startsWith(adaptivePrefix));
});

Then('dense schema encoding preserves binary groups and every shipped gzip asset', async () => {
  for (let length = 0; length < 65; length++) for (const byte of [0, 255, undefined]) {
    const bytes = Uint8Array.from({ length }, (_, i) => byte ?? (i * 37 + length) % 256), packed = encodeSchemaPack91(bytes);
    assert.deepEqual(decode(packed), bytes); assert.doesNotMatch(packed.slice(prefix91.length), /["\\<&]/);
    assert.equal(Function('return ' + JSON.stringify(packed))(), packed);
  }
  for (let word = 0; word < 8192; word++) {
    const bytes = Uint8Array.of(word & 255, word >> 8); assert.deepEqual(decode(encodeSchemaPack91(bytes)), bytes);
  }
  let count = 0, oldCharacters = 0, newCharacters = 0;
  for (const directory of ['src/catalogs/services', 'src/catalogs/services/indexes']) for (const file of (await readdir(directory)).filter(file => file.endsWith('.json.gz'))) {
    const bytes = await readFile(`${directory}/${file}`), packed = encodeSchemaPack91(bytes);
    assert.deepEqual(Buffer.from(decode(packed)), bytes, file); oldCharacters += encodeSchemaPack(bytes).length; newCharacters += packed.length; count++;
  }
  assert.equal(count, serviceSchemaDescriptors.length * 2); assert.ok(newCharacters < oldCharacters);
});
Then('dense schema decoding rejects invalid digits lengths and padding', () => {
  for (const value of [' ', '"!', '\\!', '<!', '&!', 'é!']) assert.throws(() => decodeCompactSchemaPack91(value));
  for (const value of ['~', '~~']) assert.throws(() => decodeCompactSchemaPack91(value));
  const truncated = encodeSchemaPack91(Uint8Array.of(0, 1)).slice(prefix91.length, -1);
  assert.throws(() => decodeCompactSchemaPack91(truncated), /padding/);
});


Then('adaptive schema encoding preserves every gzip asset and records paired decode timings', async () => {
  for (let length = 0; length <= 256; length++) for (const byte of [0, 255, undefined]) {
    const bytes = Uint8Array.from({ length }, (_, i) => byte ?? (i * 173 + length) % 256), packed = encodeAdaptiveSchemaPack(bytes);
    assert.deepEqual(decode(packed), bytes); assert.doesNotMatch(packed.slice(adaptivePrefix.length), /["\\<&]/);
    assert.equal(JSON.parse(JSON.stringify(packed)), packed);
  }
  for (let word = 0; word < 65536; word++) {
    const bytes = Uint8Array.of(word & 255, word >> 8); assert.deepEqual(decode(encodeAdaptiveSchemaPack(bytes)), bytes);
  }
  const files = []; let fixedCharacters = 0, adaptiveCharacters = 0;
  for (const directory of ['src/catalogs/services', 'src/catalogs/services/indexes']) for (const name of (await readdir(directory)).filter(n => n.endsWith('.json.gz'))) {
    const file = directory + '/' + name, bytes = await readFile(file), packed = encodeAdaptiveSchemaPack(bytes);
    assert.deepEqual(Buffer.from(decode(packed)), bytes, file); fixedCharacters += encodeSchemaPack91(bytes).length; adaptiveCharacters += packed.length;
    files.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  assert.equal(files.length, serviceSchemaDescriptors.length * 2); assert.ok(adaptiveCharacters < fixedCharacters);
  const samples = [];
  for (const descriptor of files.sort((a, b) => b.bytes - a.bytes).slice(0, 4)) {
    const bytes = await readFile(descriptor.file), fixed = encodeSchemaPack91(bytes).slice(prefix91.length), adaptive = encodeAdaptiveSchemaPack(bytes).slice(adaptivePrefix.length);
    for (let sample = 0; sample < 3; sample++) {
      const row = { ...descriptor, sample };
      for (const method of sample % 2 ? ['adaptive', 'fixed'] : ['fixed', 'adaptive']) {
        const started = performance.now(), decoded = method === 'fixed' ? decodeCompactSchemaPack91(fixed) : decodeAdaptiveSchemaPack(adaptive);
        row[method + 'Ms'] = performance.now() - started; assert.deepEqual(Buffer.from(decoded), bytes);
      }
      samples.push(row);
    }
  }
  await writeFile('tmp/schema-codec-adaptive.json', JSON.stringify({ runtime: process.version, measurement: 'Node decode only, warm functions, alternating paired order, no gzip/JSON parsing or browser startup claim', files: files.length, fixedCharacters, adaptiveCharacters, savedCharacters: fixedCharacters - adaptiveCharacters, samples }, null, 2));
});
Then('adaptive schema decoding accepts only canonical pairs and final groups', () => {
  for (const value of [' ', '~', '"!', '\\!', '<!', '&!', 'é!']) assert.throws(() => decodeAdaptiveSchemaPack(value));
  const alphabet = Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).filter(c => !['"', '\\', '<', '&'].includes(c)).join('');
  let seed = 7351;
  for (let i = 0; i < 8192; i++) {
    let encoded = '';
    for (let n = 0; n < 1 + i % 13; n++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; encoded += alphabet[seed % 91]; }
    let bytes; try { bytes = decodeAdaptiveSchemaPack(encoded); } catch { continue; }
    assert.equal(encodeAdaptiveSchemaPack(bytes), adaptivePrefix + encoded, 'A noncanonical frame was accepted.');
  }
});
