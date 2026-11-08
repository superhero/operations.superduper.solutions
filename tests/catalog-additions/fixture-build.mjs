// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function buildAdditionFixture(root) {
  const [{ build }, { compactSchemaPacks }, { compactInlineWorkers }] = await Promise.all([
    import('vite'), import('../../build/schema-pack-plugin.mjs'), import('../../build/inline-worker-plugin.mjs')]);
  const built = await build({ configFile: false, root, logLevel: 'error', plugins: [compactSchemaPacks(), compactInlineWorkers()], worker: { format: 'es', plugins: () => [compactSchemaPacks()] },
    build: { write: false, target: 'es2024', minify: false, lib: { entry: resolve(root, 'tests/catalog-additions/browser.fixture.ts'), formats: ['es'] } } });
  const output = Array.isArray(built) ? built[0] : built;
  const files = new Map(output.output.map(file => ['/' + file.fileName, file.type === 'chunk' ? file.code : file.source]));
  files.set('/fixture.js', output.output.find(file => file.type === 'chunk' && file.isEntry).code);
  return files;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function saveAdditionFixture(path, sourceFingerprint, files) {
  const blobs = {}, names = {};
  for (const [name, source] of files) {
    const bytes = Buffer.from(source), digest = hash(bytes); names[name] = digest; blobs[digest] ??= bytes.toString('base64');
  }
  await writeFile(path, JSON.stringify({ version: 1, sourceFingerprint, names, blobs }));
}
export async function loadAdditionFixture(path, sourceFingerprint) {
  const record = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(record.version, 1, 'Unknown prepared fixture format.');
  assert.equal(record.sourceFingerprint, sourceFingerprint, 'Prepared fixture source changed; prepare it again.');
  assert.ok(record.names && record.blobs && Object.keys(record.names).length <= 512 && Object.keys(record.blobs).length <= 512, 'Invalid prepared fixture inventory.');
  const blobs = new Map(); let total = 0;
  for (const [digest, encoded] of Object.entries(record.blobs)) {
    assert.match(digest, /^[a-f0-9]{64}$/); assert.equal(typeof encoded, 'string');
    assert.ok(encoded.length <= 96 * 1024 ** 2, 'Prepared fixture asset exceeds its bound.');
    const bytes = Buffer.from(encoded, 'base64'); total += bytes.length;
    assert.ok(total <= 64 * 1024 ** 2, 'Prepared fixture exceeds 64 MiB.');
    assert.equal(bytes.toString('base64'), encoded, 'Prepared fixture encoding changed.'); assert.equal(hash(bytes), digest, 'Prepared fixture asset changed.');
    blobs.set(digest, bytes);
  }
  const files = new Map();
  for (const [name, digest] of Object.entries(record.names)) {
    assert.match(name, /^\/[A-Za-z0-9_./-]+$/); assert.ok(!name.split('/').includes('..') && blobs.has(digest), 'Invalid prepared fixture file.');
    files.set(name, blobs.get(digest));
  }
  assert.ok(files.has('/fixture.js'), 'Prepared fixture entry is missing.'); return files;
}
