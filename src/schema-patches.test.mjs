// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { mergeSchemaDocuments, sameSchemaValue, schemaChanges } from './lib/schema-merge.ts';
import { applySchemaPatches, googleOauthAlternatives } from './lib/schema-patches.ts';

Then('schema merges preserve unrelated edits deletions and identical changes', () => {
  const base = { info: { title: 'Published', version: '1', description: 'Old' }, paths: { '/items': {} }, obsolete: true };
  const current = structuredClone(base); current.info.title = 'Personal name';
  const incoming = structuredClone(base); incoming.info.version = '2'; incoming.info.description = 'New'; incoming.paths['/new'] = {}; delete incoming.obsolete;
  const before = structuredClone([base, current, incoming]);
  const merged = mergeSchemaDocuments(base, current, incoming);
  assert.deepEqual(merged, { conflicts: [], document: { info: { title: 'Personal name', version: '2', description: 'New' }, paths: { '/items': {}, '/new': {} } } });
  assert.deepEqual([base, current, incoming], before);
  assert.deepEqual(mergeSchemaDocuments(base, incoming, incoming), { conflicts: [], document: incoming });
  assert.ok(sameSchemaValue({ a: 1, b: [2, 3] }, { b: [2, 3], a: 1 }));
});

Then('schema merge conflicts distinguish missing null arrays and concurrent object edits', () => {
  const base = { info: { title: 'Original' }, nullable: null, security: [{ token: [] }], removed: { a: 1 } };
  const current = structuredClone(base); current.info.title = 'Local'; current.security = [{ local: [] }]; current.removed.a = 2; delete current.nullable;
  const incoming = structuredClone(base); incoming.info.title = 'Upstream'; incoming.security = [{ remote: [] }]; incoming.nullable = 'new'; delete incoming.removed;
  const result = mergeSchemaDocuments(base, current, incoming);
  assert.deepEqual(result.conflicts.map(item => item.path).sort(), ['/info/title', '/nullable', '/removed', '/security']);
  assert.deepEqual(result.document, current);
  assert.equal(Object.hasOwn(result.conflicts.find(item => item.path === '/nullable'), 'current'), false);
  const resolved = mergeSchemaDocuments(base, current, incoming, { '/info/title': 'current', '/nullable': 'incoming', '/removed': 'incoming', '/security': 'incoming' });
  assert.deepEqual(resolved, { conflicts: [], document: { info: { title: 'Local' }, nullable: 'new', security: [{ remote: [] }] } });
  assert.throws(() => mergeSchemaDocuments(base, current, incoming, { '/info/title': 'unknown' }), /Choose/);
});

Then('schema merge paths preserve special keys and bound changed-field reports', () => {
  const base = JSON.parse('{"__proto__":{"safe":1},"a/b~c":1}');
  const current = JSON.parse('{"__proto__":{"safe":2},"a/b~c":2}');
  const incoming = JSON.parse('{"__proto__":{"safe":3},"a/b~c":3}');
  const result = mergeSchemaDocuments(base, current, incoming);
  assert.deepEqual(result.conflicts.map(item => item.path), ['/__proto__/safe', '/a~1b~0c']);
  assert.equal(Object.getPrototypeOf(result.document), Object.prototype);
  assert.equal(Object.hasOwn(result.document, '__proto__'), true);
  assert.equal({}.safe, undefined);
  const diff = schemaChanges(base, incoming, 1);
  assert.equal(diff.changes.length, 1);
  assert.equal(diff.truncated, true);
  assert.deepEqual(schemaChanges(base, { 'a/b~c': 1 }).changes, [{ path: '/__proto__', kind: 'removed', before: { safe: 1 } }]);
});

Then('reviewed schema corrections preserve upstream-fixed data and reject unknown recipes', () => {
  const fixed = { openapi: '3.0.3', security: [{ Oauth2: ['scope'] }, { Oauth2c: ['scope'] }], paths: {} };
  assert.deepEqual(applySchemaPatches(fixed, [googleOauthAlternatives]), fixed);
  assert.deepEqual(applySchemaPatches(applySchemaPatches(fixed, [googleOauthAlternatives]), [googleOauthAlternatives]), fixed);
  assert.throws(() => applySchemaPatches(fixed, [{ id: 'arbitrary', version: 1 }]), /unknown/);
  assert.throws(() => applySchemaPatches(fixed, [{ ...googleOauthAlternatives, version: 2 }]), /unknown/);
  assert.throws(() => applySchemaPatches(fixed, [googleOauthAlternatives, googleOauthAlternatives]), /duplicated/);
});
