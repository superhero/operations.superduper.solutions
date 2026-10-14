// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { workflowCurve } from './lib/workflow-curve.ts';

Then('workflow curves follow every port orientation and keep their label at the cubic midpoint', () => {
  for (const [sourcePosition, targetPosition, targetX, targetY, expected] of [
    ['right', 'left', 200, 100, ['M0,0 C100,0 100,100 200,100', 100, 50]],
    ['left', 'right', -200, 100, ['M0,0 C-100,0 -100,100 -200,100', -100, 50]],
    ['bottom', 'top', 100, 200, ['M0,0 C0,100 100,100 100,200', 50, 100]],
    ['top', 'bottom', 100, -200, ['M0,0 C0,-100 100,-100 100,-200', 50, -100]],
  ]) {
    const points = { sourceX: 0, sourceY: 0, sourcePosition, targetX, targetY, targetPosition };
    assert.deepEqual(workflowCurve(points, 50), expected);
    assert.equal(workflowCurve(points, 0)[0], `M0,0 C0,0 ${targetX},${targetY} ${targetX},${targetY}`);
  }
});

Then('backward workflow connections bow out farther with increased curve strength', () => {
  const points = { sourceX: 0, sourceY: 0, sourcePosition: 'right', targetX: -100, targetY: 100, targetPosition: 'left' };
  assert.deepEqual(workflowCurve(points, 50), ['M0,0 C62.5,0 -162.5,100 -100,100', -50, 50]);
  assert.deepEqual(workflowCurve(points, 100), ['M0,0 C125,0 -225,100 -100,100', -50, 50]);
});
