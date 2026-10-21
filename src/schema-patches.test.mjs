// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { mergeSchemaDocuments, sameSchemaValue, schemaChanges } from './lib/schema-merge.ts';
import { applySchemaPatches, googleOauthAlternatives, schemaPatchName } from './lib/schema-patches.ts';
import { schemaLineDiff, schemaPointerValue } from './lib/schema-diff.ts';

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
  const additions = mergeSchemaDocuments({}, { created: { title: 'Local' } }, { created: { title: 'Published' } });
  assert.deepEqual(additions, { document: { created: { title: 'Local' } }, conflicts: [
    { path: '/created', current: { title: 'Local' }, incoming: { title: 'Published' } },
  ] }, 'Concurrent additions conflict without inventing a base value.');
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
  assert.deepEqual(schemaChanges({ removed: null }, { added: null }), { changes: [
    { path: '/removed', kind: 'removed', before: null }, { path: '/added', kind: 'added', after: null },
  ], truncated: false }, 'Missing values and explicit null stay distinct in either direction.');
  assert.deepEqual(schemaChanges('before', 'after'), { changes: [
    { path: '/', kind: 'changed', before: 'before', after: 'after' },
  ], truncated: false }, 'A complete value replacement has a root path.');
});

Then('reviewed schema corrections preserve upstream-fixed data and reject unknown recipes', () => {
  const fixed = { openapi: '3.0.3', security: [{ Oauth2: ['scope'] }, { Oauth2c: ['scope'] }], paths: {} };
  assert.equal(applySchemaPatches(fixed), fixed, 'Documents without corrections retain their original identity.');
  assert.equal(applySchemaPatches(fixed, []), fixed);
  assert.equal(schemaPatchName(googleOauthAlternatives), 'Google OAuth alternatives');
  assert.equal(schemaPatchName({ id: 'unrecognized', version: 1 }), 'Unknown schema correction');
  assert.deepEqual(applySchemaPatches(fixed, [googleOauthAlternatives]), fixed);
  assert.deepEqual(applySchemaPatches(applySchemaPatches(fixed, [googleOauthAlternatives]), [googleOauthAlternatives]), fixed);
  assert.throws(() => applySchemaPatches(fixed, [{ id: 'arbitrary', version: 1 }]), /unknown/);
  assert.throws(() => applySchemaPatches(fixed, [{ ...googleOauthAlternatives, version: 2 }]), /unknown/);
  assert.throws(() => applySchemaPatches(fixed, [googleOauthAlternatives, googleOauthAlternatives]), /duplicated/);
  const incomplete = { openapi: '3.1.0', info: { title: 'No paths' } };
  assert.deepEqual(applySchemaPatches(incomplete, [googleOauthAlternatives]), incomplete);
  const metadata = { paths: { '/missing': null, '/items': { summary: 'Metadata', get: null, post: [] } } };
  assert.deepEqual(applySchemaPatches(metadata, [googleOauthAlternatives]), metadata,
    'Corrections leave non-operation path metadata and malformed entries untouched.');
});

Then('schema line diffs preserve additions removals context and JSON pointer values', () => {
  const before = '[\n  {\n    "Oauth2": ["scope"],\n    "Oauth2c": ["scope"]\n  }\n]';
  const after = '[\n  {\n    "Oauth2": ["scope"]\n  },\n  {\n    "Oauth2c": ["scope"]\n  }\n]';
  const diff = schemaLineDiff(before, after);
  assert.equal(diff.truncated, false);
  assert.equal(diff.coarse, false);
  assert.equal(diff.rows.flatMap(row => row.before ? [row.before.text] : []).join('\n'), before);
  assert.equal(diff.rows.flatMap(row => row.after ? [row.after.text] : []).join('\n'), after);
  for (const side of ['before', 'after']) {
    const lines = diff.rows.flatMap(row => row[side] ? [row[side]] : []);
    assert.deepEqual(lines.map(line => line.number), lines.map((_, index) => index + 1));
  }
  assert.ok(diff.rows.some(row => row.before?.kind === 'removed'));
  assert.ok(diff.rows.some(row => row.after?.kind === 'added'));
  assert.ok(diff.rows.some(row => row.before?.kind === 'context' && row.after?.kind === 'context'));
  const addition = schemaLineDiff(undefined, 'null');
  assert.equal(addition.before, false);
  assert.equal(addition.after, true);
  assert.deepEqual(addition.rows, [{ after: { number: 1, kind: 'added', text: 'null' } }]);
  assert.deepEqual(schemaLineDiff('null', undefined).rows, [{ before: { number: 1, kind: 'removed', text: 'null' } }]);
  assert.deepEqual(schemaLineDiff('same', 'same').rows, []);
  // Repeated lines must not disappear or be paired out of order.
  for (const [left, right] of [['a\na\nb\na', 'a\nb\na\na'], ['one\ntwo\n', 'zero\none\n'], ['', 'x'], ['<script>&', '<b>']]) {
    const rows = schemaLineDiff(left, right).rows;
    assert.equal(rows.flatMap(row => row.before ? [row.before.text] : []).join('\n'), left);
    assert.equal(rows.flatMap(row => row.after ? [row.after.text] : []).join('\n'), right);
  }
  const document = JSON.parse('{"a/b~c":{"":null},"__proto__":{"safe":1}}');
  assert.equal(schemaPointerValue(document, '/a~1b~0c/'), null);
  assert.equal(schemaPointerValue(document, '/a~1b~0c/missing'), undefined);
  assert.equal(schemaPointerValue(document, '/__proto__/safe'), 1);
  assert.equal(schemaPointerValue(document, '/constructor'), undefined);
  assert.throws(() => schemaPointerValue(document, '/bad~2escape'), /valid/);
});

Then('schema line diffs fold context and expose bounded output without inventing source values', () => {
  const lines = Array.from({ length: 100 }, (_, index) => `unchanged ${index}`);
  const edited = [...lines]; edited[5] = 'first change'; edited[90] = 'last change';
  const diff = schemaLineDiff(lines.join('\n'), edited.join('\n'));
  assert.equal(diff.truncated, false);
  assert.ok(diff.rows.some(row => row.omitted > 0));
  assert.ok(diff.rows.some(row => row.after?.number === 6 && row.after.text === 'first change'));
  assert.ok(diff.rows.some(row => row.after?.number === 91 && row.after.text === 'last change'));
  assert.ok(diff.rows.length < 25);
  const added = schemaLineDiff(undefined, lines.join('\n'), 2);
  assert.equal(added.rows.length, 2); assert.equal(added.truncated, true);
  assert.equal(schemaLineDiff(undefined, lines.join('\n'), 100).truncated, false);
  const large = schemaLineDiff('a'.repeat(600_000), 'b'.repeat(600_000));
  assert.equal(large.truncated, true);
  assert.ok(large.rows.flatMap(row => [row.before?.text ?? '', row.after?.text ?? '']).join('').length <= 512 * 1024);
  const unicode = schemaLineDiff(undefined, '😀'.repeat(180_000));
  assert.equal(unicode.textTruncated, true);
  assert.ok(new TextEncoder().encode(unicode.rows[0].after.text).byteLength <= 512 * 1024);
  assert.equal(unicode.rows[0].after.text.slice(-2), '😀');
  const coarse = schemaLineDiff(Array.from({ length: 1200 }, (_, index) => `old ${index}`).join('\n'),
    Array.from({ length: 1200 }, (_, index) => `new ${index}`).join('\n'), 1500);
  assert.equal(coarse.coarse, true); assert.equal(coarse.truncated, false);
  assert.equal(coarse.rows.length, 1200);
  assert.equal(coarse.rows[1199].before.text, 'old 1199');
  assert.equal(coarse.rows[1199].after.text, 'new 1199');
  assert.throws(() => schemaLineDiff('a', 'b', 5001), /1–5000/);
});
