// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { layoutAddedGraph, placeUtilityNode } from './lib/workflow-layout.ts';

const operation = (id, width, height, position = { x: 180, y: 180 }) => ({ id, type: 'operation', position,
  measured: { width, height }, data: { operationId: id, name: id, description: '', method: 'GET', path: '/' } });
const panel = (id, direction, width, height, ownerId = 'owner') => ({ id, type: 'data', position: { x: 0, y: 0 },
  measured: { width, height }, data: { ownerId, direction, label: id, fields: [] } });
const edge = (parent, child, input = false) => ({ id: `${parent}-${child}`, kind: 'schema',
  source: input ? child : parent, target: input ? parent : child });
const center = node => ({ x: node.position.x + node.measured.width / 2, y: node.position.y + node.measured.height / 2 });
const right = node => node.position.x + node.measured.width;
const bottom = node => node.position.y + node.measured.height;

function assertNoOverlap(nodes) {
  for (let i = 0; i < nodes.length; i++) for (const other of nodes.slice(i + 1)) {
    const node = nodes[i];
    assert.ok(right(node) <= other.position.x || right(other) <= node.position.x || bottom(node) <= other.position.y || bottom(other) <= node.position.y,
      `${node.id} must not overlap ${other.id}`);
  }
}

Then('measured workflow schema trees keep wide owners clear, align columns, and separate unequal nested subtrees', () => {
  const nodes = [operation('owner', 481, 143), panel('query', 'inputs', 277, 231), panel('nested-query', 'inputs', 323, 112),
    panel('response', 'outputs', 293, 208), panel('error', 'outputs', 209, 351), panel('body', 'outputs', 267, 471),
    panel('headers', 'outputs', 192, 146), panel('body-a', 'outputs', 193, 149), panel('body-b', 'outputs', 299, 177)];
  const edges = [edge('owner', 'query', true), edge('query', 'nested-query', true), edge('owner', 'response'), edge('owner', 'error'),
    edge('response', 'body'), edge('response', 'headers'), edge('body', 'body-a'), edge('body', 'body-b')];
  const before = structuredClone(nodes);
  for (const grid of [1, 12, 32]) {
    const result = layoutAddedGraph(nodes, edges, [], grid, 'owner');
    const byId = new Map(result.map(node => [node.id, node]));
    assertNoOverlap(result);
    assert.deepEqual(result.map(node => node.id), nodes.map(node => node.id));
    for (const node of result) for (const value of Object.values(center(node)))
      assert.ok(Math.abs(value / grid - Math.round(value / grid)) < 1e-9, 'Every new center must lie on the grid.');
    assert.equal(center(byId.get('response')).x, center(byId.get('error')).x);
    assert.equal(center(byId.get('body')).x, center(byId.get('headers')).x);
    assert.ok(byId.get('response').position.x - right(byId.get('owner')) >= 64);
    assert.ok(byId.get('owner').position.x - right(byId.get('query')) >= 64);
    assert.ok(byId.get('headers').position.y - bottom(byId.get('body')) >= 32);
    assert.ok(byId.get('body-b').position.y - bottom(byId.get('body-a')) >= 32);
  }
  assert.deepEqual(nodes, before, 'Layout must not mutate its input nodes.');
});

Then('appended workflow nodes place all new inputs after existing bounds and preserve the previous owner row', () => {
  const existing = [operation('previous', 413, 111, { x: -313, y: -47.5 }),
    { ...panel('previous-output', 'outputs', 397, 200, 'previous'), position: { x: 511, y: 500 } },
    { ...panel('hidden', 'outputs', 500, 500), position: { x: 1_000_000, y: 1_000_000 }, hidden: true }];
  const original = structuredClone(existing);
  const added = [operation('owner', 587, 170, { x: -1000, y: -1000 }), panel('query', 'inputs', 255, 124),
    panel('nested-query', 'inputs', 303, 143), panel('response', 'outputs', 249, 245)];
  const result = layoutAddedGraph(added, [edge('owner', 'query', true), edge('query', 'nested-query', true), edge('owner', 'response')], existing, 16, 'owner');
  assert.ok(Math.min(...result.map(node => node.position.x)) >= 908 + 80 + 16);
  assert.equal(center(result[0]).y, 16, 'The next owner follows the previous owner, not its lowest data panel or the panned viewport.');
  assertNoOverlap([...existing.filter(node => !node.hidden), ...result]);
  assert.deepEqual(existing, original, 'Existing user-arranged nodes must stay unchanged.');
});

Then('single-node operation trees append to the right and snap their centers', () => {
  const previous = [operation('previous', 220, 96, { x: 0, y: 0 })];
  const utility = operation('next', 231, 82, { x: 8, y: -700 });
  const result = layoutAddedGraph([utility], [], previous, 12, utility.id);
  assert.ok(result[0].position.x >= 220 + 80 + 12);
  assert.equal(center(result[0]).y, 48);
  assert.equal(center(result[0]).x % 12, 0);
  assert.equal(result[0].data, utility.data);
});

Then('unmeasured workflow nodes use explicit dimensions or safe defaults while missing owners stay untouched', () => {
  const owner = operation('owner');
  delete owner.measured;
  const child = panel('response', 'outputs');
  delete child.measured;
  const explicit = { ...panel('explicit', 'outputs'), measured: undefined, width: 400, height: 120 };
  const result = layoutAddedGraph([owner, child, explicit], [edge('owner', 'response'), edge('owner', 'explicit')], [], NaN, 'owner');
  assert.equal(result[0].position.x, owner.position.x);
  assert.ok(result[1].position.x >= result[0].position.x + 160 + 64);
  assert.equal(result[1].position.x + 130, result[2].position.x + 200);
  assert.ok(result.every(node => Number.isFinite(node.position.x) && Number.isFinite(node.position.y)));
  assert.deepEqual(layoutAddedGraph([owner], [], [], 12, 'absent'), [owner]);
});

Then('nonstructural, hidden, duplicate and cyclic workflow edges cannot distort the new schema tree', () => {
  const owner = operation('owner', 200, 80);
  const child = panel('child', 'outputs', 240, 100);
  const hidden = { ...panel('hidden', 'outputs', 900, 900), hidden: true };
  const orphan = panel('orphan', 'outputs', 240, 100);
  const basic = [edge('owner', 'child')];
  const result = layoutAddedGraph([owner, child, hidden, orphan], [
    ...basic, { ...basic[0], id: 'duplicate' }, edge('child', 'child'),
    { ...edge('owner', 'orphan'), kind: 'mapping' },
    { ...edge('owner', 'orphan'), hidden: true }, edge('missing', 'orphan'),
    edge('owner', 'missing'), edge('owner', 'hidden'),
  ], [], 12, 'owner');
  const plain = layoutAddedGraph([owner, child], basic, [], 12, 'owner');
  assert.deepEqual(result.slice(0, 2), plain);
  assert.equal(result[2], hidden);
  assert.equal(center(result[3]).x % 12, 0);
  assert.equal(center(result[3]).y % 12, 0);
  const previous = [panel('old', 'outputs', 100, 120)];
  const appended = layoutAddedGraph([owner, child], basic, previous, 12, 'owner');
  assert.equal(center(appended[0]).y, 60);
});


Then('utility placement finds the nearest free viewport position and falls back outside without moving existing nodes', () => {
  const node = operation('utility', 40, 30, { x: -900, y: -900 });
  const viewport = { x: -100, y: -100, width: 200, height: 200 };
  const placed = placeUtilityNode(node, [], viewport);
  assert.deepEqual(center(placed), { x: 0, y: 0 });
  const blocked = operation('block', 40, 40, { x: -20, y: -20 });
  const original = structuredClone(blocked);
  const nearby = placeUtilityNode(node, [blocked], viewport);
  assert.equal(Math.hypot(center(nearby).x, center(nearby).y), 59);
  assertNoOverlap([nearby, blocked]); assert.deepEqual(blocked, original);
  assert.deepEqual(placeUtilityNode(node, [{ ...blocked, hidden: true }], viewport).position, placed.position);
  const full = operation('full', 200, 200, { x: -100, y: -100 });
  const outside = placeUtilityNode(node, [full], viewport);
  assertNoOverlap([outside, full]);
  assert.equal(Math.hypot(center(outside).x, center(outside).y), 139);
  const oversized = placeUtilityNode(operation('large', 240, 220), [], viewport);
  assert.deepEqual(center(oversized), { x: 0, y: 0 });
  assert.deepEqual(center(placeUtilityNode(node, [], viewport, NaN)), { x: 0, y: 0 });
});

Then('gridded utility placement matches an exhaustive nearest-space search across crowded and panned viewports', () => {
  const viewport = { x: -100, y: -80, width: 200, height: 160 };
  const node = operation('utility', 36, 22);
  for (const existing of [[], [operation('center', 40, 40, { x: -20, y: -20 })],
    [operation('wide', 130, 60, { x: -70, y: -20 }), operation('upper', 50, 50, { x: 60, y: -90 })],
    [operation('all', 250, 180, { x: -130, y: -90 })]]) {
    const result = placeUtilityNode(node, existing, viewport, 10);
    const actual = center(result);
    assert.equal(Math.abs(actual.x % 10), 0); assert.equal(Math.abs(actual.y % 10), 0);
    const free = (x, y) => existing.every(item => x + 18 + 24 <= item.position.x || x - 18 - 24 >= right(item) ||
      y + 11 + 24 <= item.position.y || y - 11 - 24 >= bottom(item));
    const candidates = [];
    for (let x = -400; x <= 400; x += 10) for (let y = -400; y <= 400; y += 10) if (free(x, y))
      candidates.push({ x, y, inside: x - 18 >= viewport.x && x + 18 <= viewport.x + viewport.width &&
        y - 11 >= viewport.y && y + 11 <= viewport.y + viewport.height });
    const inside = candidates.filter(item => item.inside);
    const minimum = Math.min(...(inside.length ? inside : candidates).map(item => item.x ** 2 + item.y ** 2));
    assert.equal(actual.x ** 2 + actual.y ** 2, minimum);
    assert.ok(free(actual.x, actual.y));
    const shifted = placeUtilityNode(node, existing.map(item => ({ ...item,
      position: { x: item.position.x + 300, y: item.position.y - 500 } })),
      { ...viewport, x: viewport.x + 300, y: viewport.y - 500 }, 10);
    assert.deepEqual(shifted.position, { x: result.position.x + 300, y: result.position.y - 500 });
  }
});
