// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { auditOperations, selectOperations } from '../tests/catalog-additions/audit.mjs';

Then('the catalog audit selects exact operation identifiers without hiding unknown selections', () => {
  const inventory = [{ id: 'a:one', catalog: 'a' }, { id: 'b:two', catalog: 'b' }, { id: 'a:three', catalog: 'a' }];
  assert.deepEqual(selectOperations(inventory), inventory);
  assert.deepEqual(selectOperations(inventory, { catalogs: ['a'] }), [inventory[0], inventory[2]]);
  assert.deepEqual(selectOperations(inventory, { operations: ['a:three', 'a:one', 'a:one'], limit: 1 }), [inventory[0]]);
  assert.deepEqual(selectOperations(inventory, { catalogs: ['a'], operations: ['a:three'] }), [inventory[2]]);
  assert.throws(() => selectOperations(inventory, { catalogs: ['unknown'] }), /Unknown catalog/);
  assert.throws(() => selectOperations(inventory, { operations: ['missing'] }), /Unknown operation/);
  assert.throws(() => selectOperations(inventory, { catalogs: ['a'], operations: ['b:two'] }), /Unknown operation/);
});

const inventory = ['one', 'two', 'three'].map(id => ({ id }));
function fixture() {
  const live = new Set(), events = [], results = [];
  const adapter = {
    async add(id, workflowId) {
      assert.equal(live.size, 0); live.add(workflowId); events.push(['add', id, workflowId]);
      return { ok: true, stage: 'added', persistedWorkflows: live.size };
    },
    async remove(workflowId) { assert.ok(live.delete(workflowId)); events.push(['remove', workflowId]); return { remainingWorkflows: live.size }; },
    async reset() { events.push(['reset']); live.clear(); },
  };
  return { adapter, live, events, results, record: async row => { assert.equal(live.size, 0); results.push(row); } };
}
Then('the catalog audit deletes each workflow before attempting the next operation', async () => {
  const f = fixture(); await auditOperations(inventory, f.adapter, f.record);
  assert.deepEqual(f.events.map(event => event[0]), ['add', 'remove', 'add', 'remove', 'add', 'remove']);
  assert.equal(new Set(f.results.map(row => row.workflowId)).size, inventory.length);
  assert.equal(f.live.size, 0); assert.ok(f.results.every(row => row.ok && row.cleanup.remainingWorkflows === 0 && row.persistedWorkflows === 1));
});
Then('the catalog audit retains insertion errors while completing the remaining inventory', async () => {
  const f = fixture(), add = f.adapter.add;
  f.adapter.add = async (id, workflowId) => { const outcome = await add(id, workflowId); if (id === 'two') throw new Error('Real insertion failure'); return outcome; };
  await auditOperations(inventory, f.adapter, f.record);
  assert.deepEqual(f.results.map(row => [row.id, row.ok]), [['one', true], ['two', false], ['three', true]]);
  assert.equal(f.results[1].reason, 'Real insertion failure'); assert.equal(f.live.size, 0);
});
Then('the catalog audit discards a dirty context or stops before the next addition', async () => {
  for (const resetFails of [false, true]) {
    const f = fixture(), remove = f.adapter.remove; let once = true;
    f.adapter.remove = async id => { if (once) { once = false; return { remainingWorkflows: 1 }; } return remove(id); };
    if (resetFails) f.adapter.reset = async () => { throw new Error('Cannot close context'); };
    const run = auditOperations(inventory, f.adapter, f.record);
    if (resetFails) {
      await assert.rejects(run, /Cannot close context/);
      assert.equal(f.events.filter(event => event[0] === 'add').length, 1);
      assert.equal(f.results.length, 0, 'An unclean attempt is never recorded as completed.');
    } else {
      await run; assert.equal(f.results.length, 3); assert.equal(f.results[0].ok, false);
      assert.equal(f.results[0].stage, 'cleanup'); assert.equal(f.results[0].cleanup.contextReset, true);
      assert.equal(f.live.size, 0); assert.equal(f.events.filter(event => event[0] === 'reset').length, 1);
    }
  }
});
Then('the catalog audit refuses to reuse a previous workflow identity', async () => {
  const f = fixture();
  await assert.rejects(auditOperations(inventory, f.adapter, f.record, () => 'same-id'), /unique workflow ID/);
  assert.equal(f.results.length, 1); assert.equal(f.live.size, 0);
});
