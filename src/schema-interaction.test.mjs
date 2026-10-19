// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { createMatchingIndexCache, createMatchingLibrary } from './lib/matching-index.ts';
import { prepareMatchingOperations, evaluateOperations, evaluatePreparedOperations } from './lib/matching.ts';
import { createSchemaModelLoader, schemaModelBatchSize } from './lib/schema-models.ts';

Then('search indexes follow immutable schema descriptors and release disabled schemas', () => {
  const cache = createMatchingIndexCache();
  const original = [{ id: 'a:one', name: 'List items' }, { id: 'b:two', name: 'Create item' }, { id: 'legacy', name: 'Legacy item' }];
  const first = cache.prepare(original);
  assert.equal(cache.prepare(original), first);
  assert.deepEqual(first.catalogs.flatMap(catalog => catalog.prepared), prepareMatchingOperations(original));
  const reordered = cache.prepare([original[1], original[0], original[2]]);
  assert.equal(reordered.revision, first.revision);
  for (const catalog of reordered.catalogs) assert.equal(catalog, first.catalogs.find(entry => entry.id === catalog.id));
  const changed = cache.prepare([original[0], { ...original[1], name: 'Updated title' }, original[2]]);
  assert.equal(changed.catalogs[0], first.catalogs[0]);
  assert.notEqual(changed.catalogs[1], first.catalogs[1]);
  assert.notEqual(changed.revision, first.revision);
  const added = { id: 'a:new', name: 'Another item' };
  const extended = cache.prepare([...original, added]);
  assert.notEqual(extended.catalogs[0], first.catalogs[0]);
  assert.equal(extended.byId.get(added.id), added);
  const removed = cache.prepare([original[0]]);
  assert.deepEqual(removed.catalogs.map(catalog => catalog.id), ['a']);
  const restored = cache.prepare(original);
  assert.notEqual(restored.catalogs[1], first.catalogs[1], 'Removed schemas do not keep a hidden normalized index.');
  assert.deepEqual(cache.prepare([]).catalogs, []);
});

Then('search index deltas cannot publish an incomplete or stale snapshot', () => {
  const cache = createMatchingIndexCache(), library = createMatchingLibrary();
  assert.throws(() => library.read('not-installed'), /changed/);
  const operations = [{ id: 'a:one', name: 'List items' }, { id: 'b:two', name: 'Create item' }];
  const first = cache.prepare(operations);
  library.configure(first.catalogs, ['a', 'b'], first.revision);
  assert.deepEqual(evaluatePreparedOperations('items', library.read(first.revision)), evaluateOperations('items', operations));
  assert.throws(() => library.configure([], ['a', 'missing'], 'bad'), /incomplete/);
  assert.equal(library.read(first.revision).length, 2);
  const next = cache.prepare([operations[0], { ...operations[1], name: 'Updated item' }]);
  library.configure([next.catalogs[1]], ['b', 'a'], next.revision);
  assert.equal(library.read(next.revision)[0].operation.name, 'Updated item');
  assert.throws(() => library.read(first.revision), /changed/);
  library.configure([], ['b'], 'only-b');
  assert.equal(library.read('only-b').length, 1);
  assert.throws(() => library.configure([], ['a'], 'removed'), /incomplete/);
  library.configure([], [], 'empty');
  assert.deepEqual(library.read('empty'), []);
});

function models() {
  const installed = new Map(), reads = [], pending = [];
  let identity = 'v1';
  const model = (id, sourceIdentity = identity) => ({ operation: { id, name: id }, sourceIdentity });
  const load = createSchemaModelLoader({
    existing: id => installed.get(id), identity: id => id.startsWith('missing:') ? undefined : identity,
    read: (schema, version, ids) => { reads.push({ schema, version, ids }); return new Promise((resolve, reject) => pending.push({ resolve, reject, ids })); },
    install: value => { if (value.sourceIdentity !== identity) throw new Error('The schema changed'); installed.set(value.operation.id, value.operation); return value.operation; },
  });
  return { load, reads, pending, installed, model, change: value => { identity = value; }, async complete() {
    await Promise.resolve();
    const request = pending.shift(); assert.ok(request, 'Expected a model request');
    request.resolve(request.ids.map(id => model(id)));
    // Drain the loader's scheduling and cleanup promises without a wall-clock delay.
    for (let count = 0; count < 10; count++) await Promise.resolve();
  } };
}

Then('overlapping workflow loads share bounded schema batches and preserve requested order', async () => {
  const api = models();
  const ids = Array.from({ length: schemaModelBatchSize + 3 }, (_, index) => `a:op${index}`);
  const result = api.load([ids[0], 'b:op', ...ids, 'b:op']);
  const overlapping = api.load([ids[0], ids.at(-1)]);
  await api.complete();
  assert.equal(api.reads.length, 2);
  assert.equal(api.reads[0].ids.length, schemaModelBatchSize);
  assert.equal(api.reads[1].ids.length, 3);
  await api.complete(); await api.complete();
  assert.deepEqual((await result).map(operation => operation.id), [ids[0], 'b:op', ...ids.slice(1)]);
  assert.deepEqual((await overlapping).map(operation => operation.id), [ids[0], ids.at(-1)]);
  assert.deepEqual(api.reads.map(read => read.schema), ['a', 'a', 'b']);
  assert.deepEqual(await api.load([ids[0]]), [api.installed.get(ids[0])]);
  assert.deepEqual(await api.load([]), []);
  assert.equal(api.reads.length, 3);
});

Then('invalid failed and obsolete model batches cannot become cached operations', async () => {
  const api = models();
  for (const id of ['missing:op', 'legacy']) await assert.rejects(api.load([id]), /not available/);
  for (const malformed of [[], [api.model('other:op')], [api.model('a:op', 'obsolete')]]) {
    const work = api.load(['a:op']);
    const failed = assert.rejects(work, /incomplete or outdated/);
    await Promise.resolve(); api.pending.shift().resolve(malformed); await failed;
    assert.equal(api.installed.size, 0);
  }
  const failure = api.load(['a:op']);
  const rejected = assert.rejects(failure, /Read failed/);
  await Promise.resolve(); api.pending.shift().reject(new Error('Read failed')); await rejected;
  const obsolete = api.load(['a:op']);
  const changed = assert.rejects(obsolete, /schema changed/);
  await Promise.resolve(); api.change('v2'); api.pending.shift().resolve([api.model('a:op', 'v1')]); await changed;
  const retry = api.load(['a:op']); await api.complete();
  assert.deepEqual(await retry, [api.installed.get('a:op')]);
});

Then('incremental index preparation is measured against full normalization', { timeout: 30_000 }, async function () {
  const { Worker } = await import('node:worker_threads');
  const { serviceIndexDescriptors, readServiceSchemaIndex } = await import('./lib/service-schema-indexes.ts');
  const operations = [];
  for (const descriptor of serviceIndexDescriptors) operations.push(...(await readServiceSchemaIndex(descriptor.id)).operations.map(({ id, name }) => ({ id, name })));
  // This timing-only worker uses native modules. Keep its coverage maps separate
  // from Vite's maps; functional index assertions above cover the same code.
  const { NODE_V8_COVERAGE: _coverage, ...environment } = process.env;
  const worker = new Worker(new URL('./schema-interaction.fixture.mjs', import.meta.url), {
    env: environment, workerData: { operations, schema: 'frankfurter' },
  });
  const result = await new Promise((resolve, reject) => {
    worker.once('message', resolve); worker.once('error', reject);
    worker.once('exit', code => reject(new Error(`Index benchmark exited without a result (${code})`)));
  }).finally(() => worker.terminate());
  assert.equal(result.operations, operations.length);
  assert.equal(result.retainedSchemas, serviceIndexDescriptors.length - 1);
  assert.ok(result.updatedOperations > 0);
  assert.ok(Number.isFinite(result.incrementalMedianMs));
  if (process.env.SCHEMA_PROFILE_OUTPUT) {
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(process.env.SCHEMA_PROFILE_OUTPUT, { recursive: true });
    await writeFile(`${process.env.SCHEMA_PROFILE_OUTPUT}/incremental-index.json`, JSON.stringify(result, null, 2) + '\n');
  }
  await this.attach(JSON.stringify(result), 'application/json');
});
