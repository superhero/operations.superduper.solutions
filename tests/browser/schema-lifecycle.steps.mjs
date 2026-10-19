// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, Then } from '@cucumber/cucumber';

Before({ tags: '@schema-lifecycle' }, async function () {
  await this.page.evaluate(async () => { globalThis.schemaFixture = await import('/schema-lifecycle-fixture.js'); });
});

Then('schema metadata and discovery avoid disabled and unrelated document reads', async function () {
  const evidence = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    const records = await api.setup();
    const a = records.find(record => record.id === 'factory-a');
    await api.setSchemaDocumentEnabled(a.id, false, { metadataOnly: true });
    await api.readSchemaDiscovery('factory-b');
    await api.moveSchemaDocument('factory-b', 'demo', 'before');
    const metadataOnly = api.counters();
    let disabled;
    try { await api.readSchemaOperation('factory-a:list', api.schemaMetadataIdentity(a)); }
    catch (error) { disabled = error.message; }
    await api.setSchemaDocumentEnabled(a.id, true, { metadataOnly: true });
    const beforeModel = api.counters();
    const current = (await api.listSchemaMetadata()).find(record => record.id === a.id);
    const model = await api.readSchemaOperation('factory-a:list', api.schemaMetadataIdentity(current));
    await api.assertCurrentSchema(await api.approvedOperation(model.operation, model.origin));
    const firstHistory = await api.getSchemaHistory(a.id);
    await api.readSchemaOperation('factory-a:list', api.schemaMetadataIdentity(current));
    const secondHistory = await api.getSchemaHistory(a.id);
    const after = (await api.listSchemaMetadata()).find(record => record.id === a.id);
    return { metadataOnly, beforeModel, afterModel: api.counters(), disabled, firstHistory, secondHistory,
      stillFactory: !!after.factoryDigest, sourceIdentity: model.sourceIdentity, expectedIdentity: api.schemaMetadataIdentity(current),
      fields: model.operation.fields.map(field => ({ name: field.name, type: field.type })) };
  });
  assert.deepEqual(evidence.metadataOnly.reads, {});
  assert.deepEqual(evidence.beforeModel.reads, {});
  assert.match(evidence.disabled, /schema changed/);
  assert.deepEqual(evidence.afterModel.reads, { 'factory-a': 1 });
  assert.equal(evidence.firstHistory.length, 1);
  assert.deepEqual(evidence.secondHistory, evidence.firstHistory);
  assert.equal(evidence.stillFactory, true);
  assert.equal(evidence.sourceIdentity, evidence.expectedIdentity);
  assert.deepEqual(evidence.fields, [{ name: 'limit', type: 'integer' }]);
  await this.attach(JSON.stringify(evidence), 'application/json');
});

Then('schema cache repair preserves history and retries failed reads', async function () {
  const result = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    const records = await api.setup();
    const a = records.find(record => record.id === 'factory-a');
    const identity = api.schemaMetadataIdentity(a);
    await api.readSchemaDiscovery(a.id);
    await api.readSchemaOperation('factory-a:list', identity);
    const history = await api.getSchemaHistory(a.id);
    await api.editStore('indexes', a.id, 'corrupt-index');
    const repaired = await api.readSchemaDiscovery(a.id);
    const repairedHistory = await api.getSchemaHistory(a.id);
    await api.editStore('policies', a.id, 'corrupt-policy');
    const repairedModel = await api.readSchemaOperation('factory-a:list', identity);
    await api.assertCurrentSchema(await api.approvedOperation(repairedModel.operation, repairedModel.origin));
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'indexes') throw new DOMException('Injected index quota failure', 'QuotaExceededError');
      return put.call(this, value, ...args);
    };
    let uncached;
    try { uncached = await api.readSchemaDiscovery('factory-b'); }
    finally { IDBObjectStore.prototype.put = put; }
    api.releaseSchemaDocument(a.id);
    api.failRead(a.id);
    let failure;
    try { await api.readSchemaOperation('factory-a:list', identity); } catch (error) { failure = error.message; }
    const retried = await api.readSchemaOperation('factory-a:list', identity);
    return { history, repairedHistory, sourceRevision: repaired.sourceRevision, expectedRevision: a.factoryDigest,
      failure, operationId: retried.operation.id, uncachedOperations: uncached.operations.length, counters: api.counters() };
  });
  assert.deepEqual(result.repairedHistory, result.history);
  assert.equal(result.sourceRevision, result.expectedRevision);
  assert.match(result.failure, /Injected schema read failure/);
  assert.equal(result.operationId, 'factory-a:list');
  assert.equal(result.uncachedOperations, 1);
  assert.equal(result.counters.reads['factory-b'], undefined);
});

Then('factory revisions retain independent Git ancestry and authored ownership', async function () {
  const result = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    await api.setup();
    const originalA = await api.getSchemaHistory('factory-a');
    const originalB = await api.getSchemaHistory('factory-b');
    await api.setup(2);
    const beforeRead = await api.listSchemaMetadata();
    const updatedA = await api.getSchemaHistory('factory-a');
    const oldA = await api.readSchemaVersion('factory-a', originalA[0].oid);
    const retained = (await api.listSchemaMetadata()).find(record => record.id === 'factory-a').factoryDigest;
    await api.renameSchemaDocument('factory-a', 'My authored service');
    const authored = await api.getSchemaHistory('factory-a');
    await api.setup(3);
    const after = await api.listSchemaMetadata();
    const authoredHistory = await api.getSchemaHistory('factory-a');
    await api.deleteSchemaDocument('factory-b');
    await api.setup(3);
    const deletedRemainsAbsent = !(await api.listSchemaMetadata()).some(record => record.id === 'factory-b');
    return { originalA, originalB, updatedA, oldA, retained, authored, authoredHistory, deletedRemainsAbsent,
      factoryAfterViewingHistory: beforeRead.find(record => record.id === 'factory-a').factoryDigest,
      authoredMetadata: after.find(record => record.id === 'factory-a') };
  });
  assert.notEqual(result.originalA[0].oid, result.originalB[0].oid);
  assert.equal(result.updatedA.length, 2);
  assert.deepEqual(result.updatedA[0].parents, [result.originalA[0].oid]);
  assert.equal(result.oldA.info.version, '1');
  assert.equal(result.retained, result.factoryAfterViewingHistory);
  assert.equal(result.authored.length, 3);
  assert.deepEqual(result.authoredHistory, result.authored);
  assert.equal(result.authoredMetadata.factoryDigest, undefined);
  assert.equal(result.authoredMetadata.summary.name, 'My authored service');
  assert.equal(result.deletedRemainsAbsent, true);
});

Then('schema model loading and credential policies reject a stale source revision', async function () {
  const current = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    const a = (await api.setup()).find(record => record.id === 'factory-a');
    const identity = api.schemaMetadataIdentity(a);
    const model = await api.readSchemaOperation('factory-a:list', identity);
    return { identity, approved: await api.approvedOperation(model.operation, model.origin) };
  });
  const other = await this.context.newPage();
  try {
    await other.goto(`${this.baseURL}/vault-fixture.html`);
    await other.evaluate(async () => {
      const api = await import('/schema-lifecycle-fixture.js');
      await api.setup();
      const record = structuredClone(await api.readSchemaDocument('factory-a'));
      record.document.paths['/items'].get.description = 'Changed in another tab';
      await api.putSchemaDocument(record);
    });
    const errors = await this.page.evaluate(async previous => {
      const api = globalThis.schemaFixture;
      const errors = [];
      for (const action of [() => api.readSchemaOperation('factory-a:list', previous.identity),
        () => api.assertCurrentSchema(previous.approved)]) {
        try { await action(); errors.push('unexpected success'); } catch (error) { errors.push({ message: error.message, code: error.code }); }
      }
      return errors;
    }, current);
    assert.match(errors[0].message, /schema changed/);
    assert.equal(errors[1].code, 'PERMISSION');
  } finally { await other.close(); }
});

Then('unfinished factory history writes recover before canonical models become usable', async function () {
  const result = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    await api.setup();
    const original = await api.getSchemaHistory('factory-a');
    await api.setup(2);
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'catalog' && value.id === 'factory-a' && value.historyDigest === value.factoryDigest)
        throw new DOMException('Injected history finalization failure', 'QuotaExceededError');
      return put.call(this, value, ...args);
    };
    let failure;
    try { await api.getSchemaHistory('factory-a'); } catch (error) { failure = error.message; }
    finally { IDBObjectStore.prototype.put = put; }
    const recovered = await api.getSchemaHistory('factory-a');
    const metadata = (await api.listSchemaMetadata()).find(record => record.id === 'factory-a');
    const model = await api.readSchemaOperation('factory-a:list', api.schemaMetadataIdentity(metadata));
    await api.assertCurrentSchema(await api.approvedOperation(model.operation, model.origin));
    return { original, recovered, failure, version: model.document.info.version };
  });
  assert.match(result.failure, /Injected history finalization failure/);
  assert.equal(result.recovered.length, 2);
  assert.deepEqual(result.recovered[0].parents, [result.original[0].oid]);
  assert.equal(result.version, '2');
});

Then('schema operation batches preserve canonical models and publish policies atomically', async function () {
  const evidence = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    const record = (await api.setup(1, 6)).find(record => record.id === 'factory-a');
    const identity = api.schemaMetadataIdentity(record);
    const ids = (await api.readSchemaDiscovery(record.id)).operations.map(operation => operation.id);
    await api.getSchemaHistory(record.id);
    const nativeTransaction = IDBDatabase.prototype.transaction;
    let transactions = 0, policyTransactions = 0;
    IDBDatabase.prototype.transaction = function (stores, ...args) {
      if (this.name === 'v1/catalogs/index') {
        transactions++;
        if ([stores].flat().includes('policies')) policyTransactions++;
      }
      return nativeTransaction.call(this, stores, ...args);
    };
    let singles, batch, singleCounts, batchCounts;
    try {
      singles = [];
      for (const id of ids) singles.push(await api.readSchemaOperation(id, identity));
      singleCounts = { transactions, policyTransactions };
      transactions = policyTransactions = 0;
      batch = await api.readSchemaOperations(record.id, identity, [...ids, ids[0]]);
      batchCounts = { transactions, policyTransactions };
    } finally { IDBDatabase.prototype.transaction = nativeTransaction; }
    for (const model of batch) await api.assertCurrentSchema(await api.approvedOperation(model.operation, model.origin));
    await api.editStore('policies', record.id, 'delete-policy');
    const failures = [];
    for (const group of [[], ['factory-b:list'], Array.from({ length: 17 }, (_, i) => `factory-a:${i}`), [ids[0], 'factory-a:missing']]) {
      try { await api.readSchemaOperations(record.id, identity, group); failures.push('unexpected success'); }
      catch (error) { failures.push(error.message); }
    }
    let partialPolicy;
    try { await api.assertCurrentSchema(await api.approvedOperation(batch[0].operation, batch[0].origin)); }
    catch (error) { partialPolicy = error.code; }
    await api.setSchemaDocumentEnabled(record.id, false, { metadataOnly: true });
    let disabled;
    try { await api.readSchemaOperations(record.id, identity, ids); }
    catch (error) { disabled = error.message; }
    return { singles, batch, singleCounts, batchCounts, failures, partialPolicy, disabled, counters: api.counters() };
  });
  assert.deepEqual(evidence.batch, evidence.singles);
  assert.equal(evidence.batch.length, 6);
  assert.equal(evidence.batchCounts.policyTransactions, 1);
  assert.equal(evidence.singleCounts.policyTransactions, 6);
  assert.ok(evidence.batchCounts.transactions < evidence.singleCounts.transactions / 2);
  assert.ok(evidence.failures.every(message => /batch|not available/.test(message)));
  assert.equal(evidence.partialPolicy, 'PERMISSION');
  assert.match(evidence.disabled, /schema changed/);
  assert.deepEqual(evidence.counters.reads, { 'factory-a': 1 });
  await this.attach(JSON.stringify({ single: evidence.singleCounts, batch: evidence.batchCounts }), 'application/json');
});
