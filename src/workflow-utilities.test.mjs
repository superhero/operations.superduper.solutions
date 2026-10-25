// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { isWorkflowConnectionTypeCompatible } from './lib/workflow-utilities.ts';

Then('opaque JSON connections accept JSON values and require a cast before concrete routing', () => {
  const panel = (id, direction, type, jsonValue = false) => ({ id, type: 'data', position: { x: 0, y: 0 },
    data: { ownerId: id + '-operation', direction, fields: [{ id: 'value', label: 'Value', type, connectable: true, ...(jsonValue ? { jsonValue: true } : {}) }] } });
  const nodes = [panel('opaque-output', 'outputs', 'Unknown', true), panel('opaque-input', 'inputs', 'Unknown', true),
    panel('object-input', 'inputs', 'Object'), panel('text-output', 'outputs', 'Text'), panel('binary-output', 'outputs', 'Binary'),
    { id: 'cast', type: 'cast', position: { x: 0, y: 0 }, data: { targetType: 'Text' } },
    { id: 'switch', type: 'switch', position: { x: 0, y: 0 }, data: { gates: [] } }];
  const accepts = (source, target) => isWorkflowConnectionTypeCompatible({ source, sourceHandle: 'value', target, targetHandle: 'value' }, nodes, []);
  assert.equal(accepts('opaque-output', 'opaque-input'), true);
  assert.equal(accepts('opaque-output', 'object-input'), false);
  assert.equal(accepts('opaque-output', 'switch'), false);
  assert.equal(accepts('opaque-output', 'cast'), true);
  assert.equal(accepts('text-output', 'opaque-input'), true);
  assert.equal(accepts('binary-output', 'opaque-input'), false);
});
