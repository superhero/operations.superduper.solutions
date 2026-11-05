// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Then } from '@cucumber/cucumber';
import { encodeSchemaPack, decodeCompactSchemaPack, compactSchemaPackPrefix as prefix } from './lib/schema-pack-codec.ts';
import { decodeServiceSchema, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { compactSchemaPacks } from '../build/schema-pack-plugin.mjs';

const decode = encoded => decodeCompactSchemaPack(encoded.slice(prefix.length));
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
  assert.deepEqual(await decodeServiceSchema(packed, metadata), document);
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
});
