// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, Then } from '@cucumber/cucumber';

Before({ tags: '@schema-lifecycle' }, async function () {
  await this.page.evaluate(async () => { globalThis.schemaFixture = await import('/schema-lifecycle-fixture.js'); });
});

Then('native RPC schema storage preserves model identity and publishes complete batches only', async function () {
  const first = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture, metadata = await api.setupNative();
    const identity = api.schemaMetadataIdentity(metadata);
    const discovery = await api.readSchemaDiscovery(metadata.id), before = api.counters();
    const ids = discovery.operations.map(operation => operation.id);
    let oversized = false, atomic = false, unpublished = false;
    try { await api.readSchemaOperations(metadata.id, identity, ids); } catch { oversized = true; }
    try { await api.readSchemaOperations(metadata.id, identity, [ids[0], 'native-fixture:absent']); } catch { atomic = true; }
    const valid = await api.readSchemaOperations(metadata.id, identity, [ids[1]]);
    const forged = { ...valid[0].operation, id: ids[0], name: 'read/0', path: 'read/0', rpc: { ...valid[0].operation.rpc, method: 'read/0' } };
    const doc = structuredClone(valid[0].document); doc.definitions.ClientRequest.oneOf[0].properties.method.enum = ['read/0'];
    try { await api.assertCurrentSchema(await api.approvedNativeOperation(forged, doc)); } catch (error) { unpublished = error.code === 'PERMISSION'; }
    const models = await api.readSchemaOperations(metadata.id, identity, ids.slice(0, 16));
    const approvals = [];
    for (const model of models) {
      const descriptor = await api.approvedNativeOperation(model.operation, model.document);
      await api.assertCurrentSchema(descriptor); approvals.push(descriptor.fingerprint);
    }
    return { before, counters: api.counters(), oversized, atomic, unpublished, identity, approvals,
      models: models.map(model => ({ protocol: model.protocol, origin: model.origin, rpc: model.operation.rpc,
        reason: model.operation.unavailableReason, paths: model.document.paths, operations: model.document.definitions.ClientRequest.oneOf.length })) };
  });
  assert.equal(first.before.reads['native-fixture'] ?? 0, 0);
  assert.equal(first.counters.reads['native-fixture'], 1);
  assert.equal(first.oversized, true); assert.equal(first.atomic, true); assert.equal(first.unpublished, true);
  assert.equal(first.models.length, 16); assert.equal(new Set(first.approvals).size, 16);
  for (const model of first.models) {
    assert.equal(model.protocol, 'json-rpc'); assert.equal(model.origin, undefined); assert.equal(model.paths, undefined);
    assert.equal(model.rpc.version, '0.163.0'); assert.equal(model.rpc.result, true); assert.equal(model.operations, 1);
    assert.match(model.reason, /not enabled/);
  }
  await this.page.reload();
  const reloaded = await this.page.evaluate(async () => {
    const api = await import('/schema-lifecycle-fixture.js');
    const metadata = await api.setupNative(), identity = api.schemaMetadataIdentity(metadata);
    const model = await api.readSchemaOperation('native-fixture:read/0', identity);
    const approved = await api.approvedNativeOperation(model.operation, model.document);
    await api.assertCurrentSchema(approved);
    return { identity, fingerprint: approved.fingerprint, rpc: model.operation.rpc };
  });
  assert.equal(reloaded.identity, first.identity); assert.equal(reloaded.fingerprint, first.approvals[0]);
  assert.deepEqual(reloaded.rpc, first.models[0].rpc);
});

Then('native RPC schema policies reject disabled replaced and forged models', async function () {
  const result = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture, metadata = await api.setupNative();
    const identity = api.schemaMetadataIdentity(metadata), operationId = 'native-fixture:read/0';
    const original = await api.readSchemaOperation(operationId, identity);
    const approved = await api.approvedNativeOperation(original.operation, original.document);
    await api.assertCurrentSchema(approved);
    const rejected = async action => { try { await action(); return false; } catch { return true; } };
    await api.setSchemaDocumentEnabled(metadata.id, false);
    const disabledPolicy = await rejected(() => api.assertCurrentSchema(approved));
    const disabledModel = await rejected(() => api.readSchemaOperation(operationId, identity));
    await api.setSchemaDocumentEnabled(metadata.id, true);
    await api.setupNative(1);
    const stalePolicy = await rejected(() => api.assertCurrentSchema(approved));
    const staleModel = await rejected(() => api.readSchemaOperation(operationId, identity));
    const current = (await api.listSchemaMetadata()).find(record => record.id === metadata.id);
    const model = await api.readSchemaOperation(operationId, api.schemaMetadataIdentity(current));
    const next = await api.approvedNativeOperation(model.operation, model.document);
    await api.assertCurrentSchema(next);
    const changed = structuredClone(model.document); changed.definitions.Params.properties.input.minLength = 99;
    const forged = await api.approvedNativeOperation(model.operation, changed);
    const forgedPolicy = await rejected(() => api.assertCurrentSchema(forged));
    await api.editStore('policies', metadata.id, 'delete-policy');
    const missingPolicy = await rejected(() => api.assertCurrentSchema(next));
    return { disabledPolicy, disabledModel, stalePolicy, staleModel, forgedPolicy, missingPolicy,
      old: approved.fingerprint, next: next.fingerprint, version: model.operation.rpc.version };
  });
  for (const key of ['disabledPolicy', 'disabledModel', 'stalePolicy', 'staleModel', 'forgedPolicy', 'missingPolicy']) assert.equal(result[key], true, key);
  assert.notEqual(result.old, result.next); assert.equal(result.version, '0.163.1');
});

Then('deletion preserves default schemas and rejects enabled uploads before removing any saved data', async function () {
  const evidence = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    await api.setup();
    const stored = async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('v1/catalogs/index');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        const names = ['catalog', 'policies', 'indexes', 'pending', 'removed', 'state'];
        const tx = db.transaction(names, 'readonly');
        return JSON.stringify(await Promise.all(names.map(name => new Promise((resolve, reject) => {
          const request = tx.objectStore(name).getAll();
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        }))));
      } finally { db.close(); }
    };
    const refusals = [];
    const refuse = async (id, reason) => {
      const before = await stored();
      const reads = JSON.stringify(api.counters());
      try { await api.deleteSchemaDocument(id); throw new Error(`Unexpectedly deleted ${id}`); }
      catch (error) {
        if (!error.message.includes(reason)) throw error;
        refusals.push(id);
      }
      if (before !== await stored()) throw new Error(`A refused deletion changed saved data for ${id}`);
      if (reads !== JSON.stringify(api.counters())) throw new Error(`A refused deletion decoded a schema for ${id}`);
    };
    for (const id of ['demo', 'httpbin', 'factory-a', 'factory-b']) {
      await refuse(id, 'Default schemas cannot be deleted');
      await api.setSchemaDocumentEnabled(id, false, { metadataOnly: true });
      await refuse(id, 'Default schemas cannot be deleted');
    }
    await api.renameSchemaDocument('factory-a', 'My renamed default');
    const replacement = await api.readSchemaDocument('factory-b');
    await api.putSchemaDocument({ ...replacement, document: { ...replacement.document,
      info: { ...replacement.document.info, title: 'My replaced default' } } });
    for (const id of ['factory-a', 'factory-b']) {
      const history = await api.getSchemaBranchHistory(id);
      await refuse(id, 'Default schemas cannot be deleted');
      if (JSON.stringify(history) !== JSON.stringify(await api.getSchemaBranchHistory(id))) throw new Error(`Changed default history: ${id}`);
    }
    const document = { openapi: '3.1.0', info: { title: 'Uploaded fixture', version: '1' },
      servers: [{ url: 'https://schema.example.test' }],
      paths: { '/items': { get: { operationId: 'list', responses: { '200': { description: 'OK' } } } } } };
    const upload = { id: 'uploaded-fixture', file: 'upload.json', document, enabled: true, createdAt: 1, updatedAt: 1 };
    await api.putSchemaDocument(upload);
    await api.putSchemaDocument({ ...upload, id: 'other-upload' });
    await api.readSchemaDiscovery(upload.id);
    const history = await api.getSchemaBranchHistory(upload.id);
    await refuse(upload.id, 'Disable this schema before deleting it');
    if (JSON.stringify(history) !== JSON.stringify(await api.getSchemaBranchHistory(upload.id))) throw new Error('Enabled upload history changed');
    await api.setSchemaDocumentEnabled(upload.id, false, { metadataOnly: true });
    // Queue an enable before deletion to emulate a stale disabled client snapshot.
    const outcomes = await Promise.allSettled([
      api.setSchemaDocumentEnabled(upload.id, true, { metadataOnly: true }),
      api.deleteSchemaDocument(upload.id),
    ]);
    const concurrent = outcomes.map(outcome => ({ status: outcome.status, error: outcome.reason?.message }));
    await refuse(upload.id, 'Disable this schema before deleting it');
    const otherHistory = await api.getSchemaBranchHistory('other-upload');
    await api.setSchemaDocumentEnabled(upload.id, false, { metadataOnly: true });
    await api.deleteSchemaDocument(upload.id);
    const remaining = (await api.listSchemaMetadata()).map(record => record.id).sort();
    const otherUnchanged = JSON.stringify(otherHistory) === JSON.stringify(await api.getSchemaBranchHistory('other-upload'));
    return { refusals, concurrent, remaining, otherUnchanged };
  });
  assert.equal(evidence.refusals.length, 12);
  assert.equal(evidence.concurrent[0].status, 'fulfilled');
  assert.equal(evidence.concurrent[1].status, 'rejected');
  assert.match(evidence.concurrent[1].error, /Disable this schema before deleting it/);
  assert.deepEqual(evidence.remaining, ['demo', 'factory-a', 'factory-b', 'httpbin', 'other-upload']);
  assert.equal(evidence.otherUnchanged, true);
});

Then('unchanged bundled revisions preserve factory metadata and authored changes', async function () {
  const result = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    const id = 'google-fixture';
    const label = 'Google / Cloud / Fixture';
    const metadata = async () => (await api.listSchemaMetadata()).find(record => record.id === id);
    await api.setupGoogle(1, false, label);
    await api.setSchemaDocumentEnabled(id, false, { metadataOnly: true });
    const history = await api.getSchemaBranchHistory(id);
    const before = await metadata();
    const reads = api.counters();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      throw new Error(`An unchanged bundle attempted to write ${this.name}.`);
    };
    let afterReads;
    try {
      await api.updateSchemaFromBundle(id);
      await api.updateSchemaFromBundle(id);
      afterReads = api.counters();
      await api.updateSchemaUpstream(id, api.googleDocument(1), 'google.json');
    } finally { IDBObjectStore.prototype.put = put; }
    const after = await metadata();
    const afterHistory = await api.getSchemaBranchHistory(id);
    await api.setupGoogle(2, false, label);
    const advanced = await api.readSchemaDocument(id);
    await api.renameSchemaDocument(id, 'My Google service');
    const authored = await metadata();
    const authoredHistory = await api.getSchemaBranchHistory(id);
    await api.updateSchemaFromBundle(id);
    await api.updateSchemaFromBundle(id);
    return { label, before, after, history, afterHistory, reads, afterReads,
      advanced, authored, authoredHistory, repeated: await metadata(), repeatedHistory: await api.getSchemaBranchHistory(id) };
  });
  assert.equal(result.before.displayName, result.label);
  assert.ok(result.before.factoryDigest);
  assert.equal(result.before.enabled, false);
  assert.deepEqual(result.after, result.before, 'An identical bundle/source changes no metadata, ownership or identity.');
  assert.deepEqual(result.afterHistory, result.history);
  assert.deepEqual(result.afterReads, result.reads, 'Applying a current factory bundle reads neither source nor upstream content.');
  assert.equal(result.advanced.displayName, result.label);
  assert.equal(result.advanced.document.info.title, 'Google fixture');
  assert.equal(result.advanced.document.info.version, '2', 'No-op application must preserve automatic bundled updates.');
  assert.equal(result.advanced.enabled, false);
  assert.equal(result.authored.summary.name, 'My Google service');
  assert.deepEqual(result.repeated, result.authored, 'A repeated source preserves local edits and their metadata.');
  assert.deepEqual(result.repeatedHistory, result.authoredHistory);
});

Then('schema diffs preserve arbitrary comparison endpoints and load exact field changes separately', async function () {
  const result = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    await api.setupGoogle();
    const initial = await api.getSchemaBranchHistory('google-fixture');
    const published = initial.branches.find(branch => branch.name === 'Published').oid;
    const correction = await api.getSchemaRevisionDiff('google-fixture', initial.current);
    const baseline = await api.getSchemaRevisionDiff('google-fixture', published);
    await api.renameSchemaDocument('google-fixture', 'My Google');
    const local = await api.getSchemaBranchHistory('google-fixture');
    await api.updateSchemaUpstream('google-fixture', api.googleDocument(2), 'v2.json');
    const merged = await api.getSchemaBranchHistory('google-fixture');
    const current = merged.revisions.find(revision => revision.oid === merged.current);
    const first = await api.getSchemaRevisionDiff('google-fixture', current.oid);
    const second = await api.getSchemaRevisionDiff('google-fixture', current.oid, 200, current.parents[1]);
    const ancestor = await api.getSchemaRevisionDiff('google-fixture', current.oid, 200, published);
    const reverse = await api.getSchemaRevisionDiff('google-fixture', published, 200, current.oid);
    const same = await api.getSchemaRevisionDiff('google-fixture', current.oid, 200, current.oid);
    const field = await api.getSchemaRevisionFieldDiff('google-fixture', current.oid, published, '/paths/~1items/get/security');
    const added = await api.getSchemaRevisionFieldDiff('google-fixture', current.oid, published, '/paths/~1items/get/x-upstream-security');
    const removed = await api.getSchemaRevisionFieldDiff('google-fixture', published, current.oid, '/paths/~1items/get/x-upstream-security');
    const source = await api.readSchemaVersion('google-fixture', published);
    const target = await api.readSchemaVersion('google-fixture', current.oid);
    const other = await api.putSchemaDocument({ id: 'unrelated-schema', file: 'other.json', enabled: false, createdAt: 0, updatedAt: 0,
      document: { openapi: '3.1.0', info: { title: 'Other', version: '1' }, servers: [{ url: 'https://other.example.test' }],
        paths: { '/other': { get: { responses: { '200': { description: 'OK' } } } } } } });
    const otherHistory = await api.getSchemaHistory(other.id);
    const failures = [];
    for (const args of [[current.oid, otherHistory[0].oid], [otherHistory[0].oid, published], [current.oid, 'bad']]) {
      try { await api.getSchemaRevisionDiff('google-fixture', args[0], 200, args[1]); failures.push(false); }
      catch { failures.push(true); }
    }
    let invalidField = false;
    try { await api.getSchemaRevisionFieldDiff('google-fixture', current.oid, published, '/missing'); }
    catch { invalidField = true; }
    return { initial, published, correction, baseline, local, merged, first, second, ancestor, reverse, same,
      field, added, removed, source, target, failures, invalidField,
      unchanged: await api.getSchemaBranchHistory('google-fixture') };
  });
  assert.deepEqual(result.baseline.revision, { oid: result.published, message: result.initial.revisions.find(item => item.oid === result.published).message });
  assert.equal(result.baseline.base, null);
  assert.deepEqual(result.baseline.parents, []);
  assert.equal(result.correction.revision.oid, result.initial.current);
  assert.equal(result.correction.base.oid, result.published);
  assert.deepEqual(result.correction.parents.map(parent => parent.oid), [result.published]);
  assert.equal(result.first.revision.oid, result.merged.current);
  assert.equal(result.first.base.oid, result.local.current);
  assert.ok(result.first.changes.some(change => change.path === '/info/version'));
  assert.equal(result.first.changes.some(change => change.path === '/info/title'), false);
  assert.equal(result.second.revision.oid, result.merged.current);
  assert.equal(result.second.base.oid, result.merged.branches.find(branch => branch.name === 'Corrections').oid);
  assert.deepEqual(result.second.changes.map(change => change.path), ['/info/title']);
  const commit = result.merged.revisions.find(revision => revision.oid === result.merged.current);
  assert.deepEqual(result.first.parents.map(parent => parent.oid), commit.parents);
  assert.deepEqual(result.second.parents, result.first.parents);
  assert.equal(result.ancestor.base.oid, result.published);
  assert.ok(result.ancestor.changes.some(change => change.path === '/info/title'));
  assert.ok(result.ancestor.changes.some(change => change.path === '/paths/~1items/get/security'));
  assert.ok(result.ancestor.changes.every(change => !Object.hasOwn(change, 'before') && !Object.hasOwn(change, 'after')), 'Collapsed changes carry no source previews.');
  assert.equal(result.same.base.oid, result.merged.current); assert.deepEqual(result.same.changes, []);
  assert.equal(result.reverse.revision.oid, result.published);
  assert.equal(result.reverse.base.oid, result.merged.current);
  assert.ok(result.reverse.changes.some(change => change.path.endsWith('/x-upstream-security') && change.kind === 'removed'));
  for (const [side, document] of [['before', result.source], ['after', result.target]]) {
    const lines = JSON.stringify(document.paths['/items'].get.security, null, 2).split('\n');
    for (const row of result.field.rows) if (row[side]) assert.equal(row[side].text, lines[row[side].number - 1]);
  }
  assert.equal(result.field.truncated, false);
  assert.ok(result.field.rows.some(row => row.before?.kind === 'removed'));
  assert.ok(result.field.rows.some(row => row.after?.kind === 'added'));
  assert.equal(result.added.before, false); assert.equal(result.added.after, true);
  assert.equal(result.removed.before, true); assert.equal(result.removed.after, false);
  assert.deepEqual(result.failures, [true, true, true]); assert.equal(result.invalidField, true);
  assert.deepEqual(result.unchanged, result.merged, 'Comparisons and field expansion leave every revision and branch unchanged.');
});

Then('schema corrections and local edits survive independent published updates', async function () {
  const result = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    await api.setupGoogle();
    const before = await api.getSchemaBranchHistory('google-fixture');
    const published = before.branches.find(branch => branch.name === 'Published').oid;
    const corrected = before.branches.find(branch => branch.name === 'Corrections').oid;
    const raw = await api.readSchemaVersion('google-fixture', published);
    const patched = await api.readSchemaVersion('google-fixture', corrected);
    const patchDiff = await api.getSchemaRevisionDiff('google-fixture', corrected);
    await api.renameSchemaDocument('google-fixture', 'My Google service');
    const incoming = api.googleDocument(2);
    incoming.paths['/new'] = { get: { operationId: 'new', responses: { '200': { description: 'Added upstream' } } } };
    await api.updateSchemaUpstream('google-fixture', incoming, 'google-v2.json');
    const record = await api.readSchemaDocument('google-fixture');
    const history = await api.getSchemaBranchHistory('google-fixture');
    const again = await api.getSchemaBranchHistory('google-fixture');
    await api.updateSchemaUpstream('google-fixture', incoming, 'google-v2.json');
    const repeated = await api.getSchemaBranchHistory('google-fixture');
    const metadata = (await api.listSchemaMetadata()).find(record => record.id === 'google-fixture');
    const model = await api.readSchemaOperation('google-fixture:list', api.schemaMetadataIdentity(metadata));
    await api.assertCurrentSchema(await api.approvedOperation(model.operation, model.origin));
    return { before, raw, patched, patchDiff, record, history, again, repeated, security: model.operation.security };
  });
  assert.equal(result.raw.paths['/items'].get.security.length, 1);
  assert.deepEqual(Object.keys(result.raw.paths['/items'].get.security[0]), ['Oauth2', 'Oauth2c']);
  assert.equal(result.patched.paths['/items'].get.security.length, 2);
  assert.ok(result.patchDiff.changes.some(change => change.path === '/paths/~1items/get/security'));
  assert.equal(result.record.document.info.title, 'My Google service');
  assert.equal(result.record.document.info.version, '2');
  assert.ok(result.record.document.paths['/new']);
  assert.equal(result.security.length, 2);
  assert.equal(result.history.incoming, undefined);
  assert.deepEqual(result.again, result.history);
  assert.deepEqual(result.repeated, result.history, 'The same published snapshot does not create duplicate commits.');
  assert.deepEqual(result.history.branches.map(branch => branch.name), ['Working', 'Published', 'Corrections']);
  const rank = new Map(result.history.revisions.map((revision, index) => [revision.oid, index]));
  for (const revision of result.history.revisions) for (const parent of revision.parents)
    assert.ok(rank.get(parent) > rank.get(revision.oid), 'Parents follow children even with identical timestamps.');
  assert.ok(result.history.revisions.some(revision => revision.parents.length === 2));
});

Then('upstream-fixed authentication preserves both flow choices without duplicate patch content', async function () {
  const result = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    await api.setupGoogle();
    await api.renameSchemaDocument('google-fixture', 'Personal Google');
    await api.setupGoogle(2, true);
    await api.updateSchemaFromBundle('google-fixture');
    const history = await api.getSchemaBranchHistory('google-fixture');
    const corrected = history.branches.find(branch => branch.name === 'Corrections').oid;
    return { history, diff: await api.getSchemaRevisionDiff('google-fixture', corrected), document: (await api.readSchemaDocument('google-fixture')).document };
  });
  assert.equal(result.document.info.title, 'Personal Google');
  assert.equal(result.document.info.version, '2');
  assert.equal(result.document.paths['/items'].get.security.length, 2);
  assert.equal(Object.hasOwn(result.document.paths['/items'].get, 'x-upstream-security'), false);
  assert.deepEqual(result.diff.changes, []);
  assert.ok(result.history.revisions.some(revision => /Upstream already includes/.test(revision.message)));
});

Then('schema conflicts survive reload and reject obsolete review decisions', async function () {
  const review = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    await api.setupGoogle();
    await api.renameSchemaDocument('google-fixture', 'Local name');
    const incoming = api.googleDocument(2); incoming.info.title = 'New published name';
    await api.updateSchemaUpstream('google-fixture', incoming, 'v2.json');
    return { history: await api.getSchemaBranchHistory('google-fixture'), document: (await api.readSchemaDocument('google-fixture')).document };
  });
  assert.equal(review.document.info.title, 'Local name');
  assert.equal(review.document.info.version, '1');
  assert.deepEqual(review.history.incoming.conflicts.map(item => item.path), ['/info/title']);
  await this.page.reload();
  const result = await this.page.evaluate(async previous => {
    const api = await import('/schema-lifecycle-fixture.js');
    await api.setupGoogle();
    const reloaded = await api.getSchemaBranchHistory('google-fixture');
    const record = await api.readSchemaDocument('google-fixture');
    record.document.info.description = 'Changed after review';
    await api.putSchemaDocument(record);
    let obsolete;
    try { await api.resolveSchemaUpdate('google-fixture', previous.current, previous.incoming.revision, { '/info/title': 'incoming' }); }
    catch (error) { obsolete = error.message; }
    const fresh = await api.getSchemaBranchHistory('google-fixture');
    await api.resolveSchemaUpdate('google-fixture', fresh.current, fresh.incoming.revision, { '/info/title': 'current', '/info/description': 'current' });
    return { reloaded, obsolete, document: (await api.readSchemaDocument('google-fixture')).document, history: await api.getSchemaBranchHistory('google-fixture') };
  }, review.history);
  assert.deepEqual(result.reloaded, review.history);
  assert.match(result.obsolete, /schema changed/i);
  assert.equal(result.document.info.title, 'Local name');
  assert.equal(result.document.info.version, '2');
  assert.equal(result.document.info.description, 'Changed after review');
  assert.equal(result.history.incoming, undefined);
  assert.equal(result.history.branches.some(branch => branch.name === 'Incoming'), false);
});

Then('interrupted schema correction branches recover without duplicate commits', async function () {
  const result = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    await api.setupGoogle();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'catalog' && value.id === 'google-fixture' && value.historyDigest === value.factoryDigest)
        throw new DOMException('Interrupted correction publication', 'QuotaExceededError');
      return put.call(this, value, ...args);
    };
    let failure;
    try { await api.getSchemaBranchHistory('google-fixture'); } catch (error) { failure = error.message; }
    finally { IDBObjectStore.prototype.put = put; }
    const recovered = await api.getSchemaBranchHistory('google-fixture');
    const again = await api.getSchemaBranchHistory('google-fixture');
    return { failure, recovered, again, document: (await api.readSchemaDocument('google-fixture')).document };
  });
  assert.match(result.failure, /Interrupted correction publication/);
  assert.equal(result.recovered.revisions.length, 2);
  assert.deepEqual(result.again, result.recovered);
  assert.equal(result.document.paths['/items'].get.security.length, 2);
});

Then('already applied schema edits merge their upstream ancestry exactly once', async function () {
  const result = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    await api.setupGoogle();
    const record = await api.readSchemaDocument('google-fixture');
    // A local edit independently matches the later published version exactly.
    record.document.info.version = '2'; record.document.info.description = 'Upstream version 2.';
    record.document.paths['/items'].get.responses['200'].description = 'Version 2';
    await api.putSchemaDocument(record);
    const before = await api.getSchemaBranchHistory('google-fixture');
    await api.updateSchemaUpstream('google-fixture', api.googleDocument(2), 'v2.json');
    const merged = await api.getSchemaBranchHistory('google-fixture');
    const diff = await api.getSchemaRevisionDiff('google-fixture', merged.current);
    await api.updateSchemaUpstream('google-fixture', api.googleDocument(2), 'v2.json');
    return { before, merged, diff, repeated: await api.getSchemaBranchHistory('google-fixture') };
  });
  const incoming = result.merged.branches.find(branch => branch.name === 'Corrections').oid;
  const merge = result.merged.revisions.find(revision => revision.oid === result.merged.current);
  assert.deepEqual(merge.parents, [result.before.current, incoming]);
  assert.deepEqual(result.diff.changes, []);
  assert.deepEqual(result.repeated, result.merged);
});

Then('discarded conflicting schema updates leave current content and ancestry unchanged', async function () {
  const result = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    await api.setupGoogle();
    await api.renameSchemaDocument('google-fixture', 'Local service');
    const before = await api.getSchemaBranchHistory('google-fixture');
    const original = (await api.readSchemaDocument('google-fixture')).document;
    const incoming = api.googleDocument(2); incoming.info.title = 'Conflicting upstream';
    await api.updateSchemaUpstream('google-fixture', incoming, 'v2.json');
    const review = await api.getSchemaBranchHistory('google-fixture');
    await api.dismissSchemaUpdate('google-fixture', review.current, review.incoming.revision);
    return { before, original, after: await api.getSchemaBranchHistory('google-fixture'), document: (await api.readSchemaDocument('google-fixture')).document };
  });
  assert.deepEqual(result.after, result.before);
  assert.deepEqual(result.document, result.original);
});

Then('new factory labels refresh without decoding sources or replacing personal names', async function () {
  const result = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    await api.setup(1, 1, { 'factory-a': 'Google Cloud — Compute', 'factory-b': 'Google Gemini — Interactions' });
    await api.setSchemaDocumentEnabled('factory-a', false, { metadataOnly: true });
    await api.renameSchemaDocument('factory-b', 'My Gemini API');
    const before = await api.listSchemaMetadata();
    const authoredHistory = await api.getSchemaHistory('factory-b');
    const counters = api.counters();
    const names = { 'factory-a': 'Google / Cloud / Compute', 'factory-b': 'Google / Gemini / Interactions' };
    const after = await api.setup(1, 1, names);
    const again = await api.setup(1, 1, names);
    return { before, after, again, authoredHistory, currentHistory: await api.getSchemaHistory('factory-b'),
      counters, currentCounters: api.counters() };
  });
  const original = result.before.find(record => record.id === 'factory-a');
  const current = result.after.find(record => record.id === 'factory-a');
  assert.equal(current.displayName, 'Google / Cloud / Compute');
  assert.equal(current.enabled, false);
  assert.equal(current.factoryDigest, original.factoryDigest);
  assert.equal(current.revision, original.revision);
  assert.deepEqual(result.after.map(record => record.id), result.before.map(record => record.id));
  assert.deepEqual(result.after.find(record => record.id === 'factory-b'), result.before.find(record => record.id === 'factory-b'));
  assert.equal(result.after.find(record => record.id === 'factory-b').summary.name, 'My Gemini API');
  assert.deepEqual(result.currentHistory, result.authoredHistory);
  assert.deepEqual(result.again, result.after);
  assert.deepEqual(result.currentCounters, result.counters);
});

Then('renamed examples and protected defaults sort by name when schema defaults initialize again', async function () {
  const records = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    await api.setup();
    await api.renameSchemaDocument('demo', 'Zulu example');
    await api.renameSchemaDocument('httpbin', 'Alpha echo');
    return (await api.setup(2)).map(record => ({ id: record.id, name: record.summary.name }));
  });
  assert.deepEqual(records, [{ id: 'httpbin', name: 'Alpha echo' },
    { id: 'factory-a', name: 'factory-a v2' }, { id: 'factory-b', name: 'factory-b v2' },
    { id: 'demo', name: 'Zulu example' }]);
});

Then('schema metadata and discovery avoid disabled and unrelated document reads', async function () {
  const evidence = await this.page.evaluate(async () => {
    const api = globalThis.schemaFixture;
    const records = await api.setup();
    const a = records.find(record => record.id === 'factory-a');
    await api.setSchemaDocumentEnabled(a.id, false, { metadataOnly: true });
    await api.readSchemaDiscovery('factory-b');
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
    return { metadataOnly, description: current.summary.description, beforeModel, afterModel: api.counters(), disabled, firstHistory, secondHistory,
      stillFactory: !!after.factoryDigest, sourceIdentity: model.sourceIdentity, expectedIdentity: api.schemaMetadataIdentity(current),
      fields: model.operation.fields.map(field => ({ name: field.name, type: field.type })) };
  });
  assert.deepEqual(evidence.metadataOnly.reads, {});
  assert.equal(evidence.description, 'Description of factory-a v1.');
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
    return { originalA, originalB, updatedA, oldA, retained, authored, authoredHistory,
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
  assert.equal(result.authoredMetadata.summary.description, 'Description of factory-a v2.');
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
