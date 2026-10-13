// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

// Cases ported individually from laya-ai/test/unit/flow-routing-rounding.test.js.
import { routingScenario } from './flow-routing-test-support.mjs';
import assert from 'node:assert/strict';
import { roundedSegments } from './lib/flow-routing/rounding.js';

const corner = { points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }] };

routingScenario(
  "an orthogonal corner with sufficiently long adjoining legs",
  "the default circular corner segments are generated",
  "an 8-unit bend is a true quarter circle shared by line, arc, and label geometry",
  () => {
    const segments = roundedSegments(corner);
    return () => {
      assert.deepEqual(segments, [
        { from: { x: 0, y: 0 }, to: { x: 32, y: 0 }, command: 'L 32 0', length: 32, phase: 0 },
        { from: { x: 32, y: 0 }, to: { x: 40, y: 8 }, command: 'A 8 8 0 0 1 40 8', length: 4 * Math.PI, phase: 32,
          center: { x: 32, y: 8 }, radius: 8, sweep: 1 },
        { from: { x: 40, y: 8 }, to: { x: 40, y: 30 }, command: 'L 40 30', length: 22, phase: 8 },
      ]);
      const arc = segments[1];
      assert.equal(Math.hypot(arc.from.x - arc.center.x, arc.from.y - arc.center.y), 8);
      assert.equal(Math.hypot(arc.to.x - arc.center.x, arc.to.y - arc.center.y), 8);
    };
  }
);

routingScenario(
  "a right-angle route rotated through every orientation",
  "forward and reverse circular segments are compared",
  "reverse travel uses the opposite circular sweep in every orientation",
  () => {
    let points = corner.points;
    return () => {
      for (let turn = 0; turn < 4; turn++) {
        const forward = roundedSegments({ points }).find(segment => segment.radius);
        const reverse = roundedSegments({ points: [...points].reverse() }).find(segment => segment.radius);
        assert.equal(forward.sweep, 1);
        assert.equal(reverse.sweep, 0);
        assert.deepEqual(reverse.center, forward.center);
        assert.deepEqual(reverse.from, forward.to);
        assert.deepEqual(reverse.to, forward.from);
        assert.equal(reverse.length, forward.length);
        points = points.map(({ x, y }) => ({ x: 0 - y, y: x }));
      }
    };
  }
);

routingScenario(
  "two corners joined by a very short interior leg",
  "both corner radii are clamped to the available leg length",
  "short adjacent legs clamp both radii without overlapping or emitting empty pieces",
  () => {
    const segments = roundedSegments({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 5 }] });
    return () => {
      assert.deepEqual(segments.filter(segment => segment.radius).map(segment => segment.radius), [2.5, 2.5]);
      assert.equal(segments.length, 4);
      assert.ok(segments.every(segment => segment.length > 0));
      for (let index = 1; index < segments.length; index++) assert.deepEqual(segments[index].from, segments[index - 1].to);
      assert.deepEqual(segments[1].to, { x: 10, y: 2.5 });
    };
  }
);

routingScenario(
  "a corner containing duplicate and collinear intermediate vertices",
  "rounded and zero-radius segments are generated",
  "duplicate and forward-collinear vertices do not create corners, while radius zero retains subdivision",
  () => {
    const subdivided = { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }] };
    const actual = roundedSegments(subdivided);
    return () => {
      assert.deepEqual(actual, roundedSegments(corner));
      const sharp = roundedSegments(subdivided, 0);
      assert.equal(sharp.length, 3);
      assert.deepEqual(sharp.map(segment => segment.command), ['L 20 0', 'L 40 0', 'L 40 30']);
      assert.ok(sharp.every(segment => !segment.radius));
    };
  }
);

routingScenario(
  "two routes entering the same bend after different prefixes",
  "forward and reverse bend phases are calculated",
  "identical shared arcs retain their phase despite different route prefixes",
  () => {
    const first = { points: [{ x: -80, y: -30 }, { x: -80, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }] };
    const second = { points: [{ x: 15, y: -70 }, { x: 15, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 80 }] };
    const a = roundedSegments(first).filter(segment => segment.radius).at(-1);
    const b = roundedSegments(second).filter(segment => segment.radius).at(-1);
    return () => {
      assert.deepEqual(a, b);
      assert.equal(a.phase, 32);
      const reversed = roundedSegments({ points: [...second.points].reverse() }).find(segment => segment.radius);
      assert.equal(reversed.phase, -8, 'reverse arc phase uses its own incoming direction');
    };
  }
);

routingScenario(
  "obstacles inside and touching the corner rectangle",
  "rounding is evaluated with each obstacle placement",
  "a node inside a corner rectangle keeps that bend sharp; touching its boundary is allowed",
  () => {
    const blocked = roundedSegments(corner, 8, [{ x: 35, y: 2, width: 2, height: 2 }]);
    return () => {
      assert.deepEqual(blocked, roundedSegments(corner, 0));
      for (const obstacle of [{ x: 40, y: 0, width: 5, height: 8 }, { x: 32, y: 8, width: 8, height: 3 }]) {
        assert.deepEqual(roundedSegments(corner, 8, [obstacle]), roundedSegments(corner));
      }
      assert.deepEqual(roundedSegments(corner, 0, [{ x: 35, y: 2, width: 2, height: 2 }]), roundedSegments(corner, 0));
    };
  }
);

routingScenario(
  "valid route data alongside invalid points and radii",
  "the corner generator validates its inputs without mutation",
  "input geometry remains unchanged and unsupported geometry is rejected",
  () => {
    const route = structuredClone(corner), obstacles = [{ x: 35, y: 2, width: 2, height: 2 }];
    const snapshot = structuredClone({ route, obstacles });
    roundedSegments(route, 8, obstacles);
    return () => {
      assert.deepEqual({ route, obstacles }, snapshot);
      for (const invalid of [null, {}, { points: [] }, { points: [{ x: 0, y: 0 }] },
        { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, { points: [{ x: Infinity, y: 0 }] }]) {
        assert.deepEqual(roundedSegments(invalid), []);
      }
      for (const radius of [-1, NaN, Infinity]) assert.deepEqual(roundedSegments(corner, radius), []);
    };
  }
);
