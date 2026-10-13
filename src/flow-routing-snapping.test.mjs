// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

// Cases ported individually from laya-ai/test/unit/flow-connection-snapping.test.js.
import { routingScenario } from './flow-routing-test-support.mjs';
import assert from 'node:assert/strict';
import { nearestWorkflowInput as nearestInput } from './lib/workflow-connection-snap.ts';
import { isValueConnection } from './lib/workflow-utilities.ts';

const handle = (id, y, type = 'target') => ({ id, nodeId: 'switch', type, position: 'left', x: -4, y: y - 4, width: 8, height: 8 });
const source = { id: 'source', type: 'data', data: { direction: 'outputs', fields: [
  { id: 'text', type: 'Text', connectable: true }, { id: 'object-field', type: 'Object', connectable: true },
] } };
const target = (id = 'switch', z = 0) => ({ id, type: 'switch', position: { x: 999, y: 999 }, origin: [0, 0.5],
  measured: { width: 200, height: 120 }, data: { gates: [{ id: 'first', operator: '==', value: '' }, { id: 'second', operator: '==', value: '' }] },
  internals: { positionAbsolute: { x: 200, y: 100 }, z, handleBounds: {
    target: [handle('value', 20), handle('gate-value:first', 60), handle('gate-value:second', 100)],
    source: [handle('first', 60, 'source')],
  } },
});
const active = (sourceHandle = 'text') => ({ inProgress: true, isValid: null, fromNode: source,
  fromHandle: { ...handle(sourceHandle, 20, 'source'), nodeId: source.id } });
const validator = (nodes, edges = []) => (connection) => isValueConnection(connection, source, nodes.find(node => node.id === connection.target), edges);

routingScenario(
  "a text output over a Switch panel with two compatible gate inputs",
  "the nearest compatible input is selected using absolute measured geometry",
  "chooses the nearest compatible input and uses measured absolute handle centers",
  () => {
    const node = target();
    const found = nearestInput(active(), [node], { x: 240, y: 195 }, validator([node]));
    return () => {
      assert.deepEqual(found.connection, { source: 'source', sourceHandle: 'text', target: 'switch', targetHandle: 'gate-value:second' });
      assert.deepEqual(found.point, { x: 200, y: 200 });
      assert.equal(found.node, node);
      assert.equal(found.handle, node.internals.handleBounds.target[2]);
    };
  }
);

routingScenario(
  "a Switch panel with its nearest gate already occupied",
  "text object and structural outputs attempt to snap to the panel",
  "filters occupied Switch gates before choosing the nearest acceptable input",
  () => {
    const node = target();
    const edges = [{ id: 'existing', source: 'other', sourceHandle: 'field', target: node.id, targetHandle: 'gate-value:first' }];
    const found = nearestInput(active(), [node], { x: 205, y: 170 }, validator([node], edges));
    return () => {
      assert.equal(found.connection.targetHandle, 'gate-value:second');
      assert.equal(nearestInput(active('object-field'), [node], { x: 220, y: 160 }, validator([node])), null);
      assert.equal(nearestInput(active('object'), [node], { x: 220, y: 160 }, validator([node])), null);
    };
  }
);

routingScenario(
  "out-of-bounds pointers and unavailable measured target panels",
  "body snapping checks target eligibility",
  "only snaps inside a visible, measured, connectable node other than the source",
  () => {
    const node = target();
    const valid = validator([node]);
    return () => {
      for (const pointer of [{ x: 199, y: 160 }, { x: 240, y: 221 }, { x: NaN, y: 160 }]) {
        assert.equal(nearestInput(active(), [node], pointer, valid), null);
      }
      for (const extra of [{ hidden: true }, { connectable: false }, { measured: {} }, { measured: { width: 0, height: 120 } }, { id: source.id }]) {
        assert.equal(nearestInput(active(), [{ ...node, ...extra }], { x: 240, y: 160 }, () => true), null);
      }
      assert.equal(nearestInput(active(), [{ ...node, internals: {} }], { x: 240, y: 160 }, valid), null);
      for (const unavailable of [{ internals: undefined }, { measured: undefined }]) {
        assert.equal(nearestInput(active(), [{ ...node, ...unavailable }], { x: 240, y: 160 }, valid), null);
      }
    };
  }
);

routingScenario(
  "overlapping eligible Switch panels with different stacking orders",
  "body snapping ranks valid panels in both iteration orders",
  "overlaps prefer the highest eligible node, with later nodes winning equal z-index",
  () => {
    const lower = target('lower', 2), upper = target('upper', 3), later = target('later', 3);
    const nodes = [lower, upper, later];
    const actual = nearestInput(active(), nodes, { x: 240, y: 160 }, validator(nodes)).node;
    return () => {
      assert.equal(actual, later);
      assert.equal(nearestInput(active(), [...nodes].reverse(), { x: 240, y: 160 }, validator(nodes)).node, upper);
      assert.equal(nearestInput(active(), nodes, { x: 240, y: 160 }, candidate => candidate.target === lower.id).node, lower);
    };
  }
);

routingScenario(
  "native snaps reverse drags inactive origins and source-only panels",
  "body snapping checks whether a candidate is needed",
  "preserves native valid snaps and ignores reverse drags and source-only nodes",
  () => {
    const node = target();
    return () => {
      for (const connection of [null, { ...active(), isValid: true }, { ...active(), inProgress: false },
        { ...active(), fromHandle: handle('value', 20, 'target') }, { ...active(), fromNode: null }]) {
        assert.equal(nearestInput(connection, [node], { x: 240, y: 160 }, () => true), null);
      }
      node.internals.handleBounds.target = [];
      assert.equal(nearestInput(active(), [node], { x: 240, y: 160 }, () => true), null);
    };
  }
);

routingScenario(
  "a connection with origin-adjusted measured coordinates",
  "body snapping evaluates preview and final drag states",
  "keeps input state unchanged, including origin-adjusted geometry and final drag state",
  () => {
    const node = target(), connection = active(), nodes = [node], pointer = { x: 240, y: 160 };
    const snapshot = structuredClone({ connection, nodes, pointer });
    const actual = nearestInput(connection, nodes, pointer, validator(nodes));
    return () => {
      assert.ok(actual);
      assert.deepEqual({ connection, nodes, pointer }, snapshot);
      const { inProgress, ...finalConnection } = connection;
      assert.ok(nearestInput(finalConnection, nodes, pointer, validator(nodes)));
    };
  }
);
