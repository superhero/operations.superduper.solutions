// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

// Cases ported individually from laya-ai/test/unit/flow-routing-dashes.test.js.
import { routingScenario } from './flow-routing-test-support.mjs';
import assert from 'node:assert/strict';
import { dashSegments } from './lib/flow-routing/dashes.js';

const modulo = (value, period = 10) => ((value % period) + period) % period;
const phaseAt = (segment, start, point, animation = 0) => modulo(
  Math.abs(point.x - start.x) + Math.abs(point.y - start.y) + segment.offset + animation);

routingScenario(
  "shared straight sections using integer and fractional dash periods",
  "their world phases advance in all four directions",
  "custom dash periods preserve shared alignment and bounded offsets",
  () => {
    const samples = [];
    for (const period of [6, 7.5, 14]) for (const vertical of [false, true]) for (const sign of [1, -1]) {
      const point = value => vertical ? { x: -12.5, y: value } : { x: value, y: -12.5 };
      const from = point(sign * -23.5), later = point(sign * -7.25), to = point(sign * 41.5);
      const first = dashSegments({ points: [from, to] }, period)[0];
      const second = dashSegments({ points: [later, to] }, period)[0];
      samples.push({ period, first, second, phases: [-7, 0, 12.5, 40].flatMap(coordinate =>
        [0, -1.25, -7.5].map(animation => {
          const current = point(sign * coordinate);
          return [from, later].map((start, index) => modulo(
            Math.abs(current.x - start.x) + Math.abs(current.y - start.y) +
            [first, second][index].offset + animation, period));
        })) });
    }
    return () => {
      assert.equal(samples.length, 12);
      for (const { period, first, second, phases } of samples) {
        assert.ok(first.offset >= 0 && first.offset < period);
        assert.ok(second.offset >= 0 && second.offset < period);
        for (const [a, b] of phases) assert.equal(a, b, `shared section with period ${period}`);
      }
    };
  }
);

routingScenario(
  "shared rounded bends using integer and fractional dash periods",
  "their forward and reverse dash segments are generated",
  "custom dash periods preserve shared arcs and use each incoming direction",
  () => {
    const first = { points: [{ x: -80, y: -30 }, { x: -80, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }] };
    const second = { points: [{ x: 15, y: -70 }, { x: 15, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 80 }] };
    const samples = [[6, 2, 4], [7.5, 2, 7], [14, 4, 6]].map(([period, phase, reversedPhase]) => ({
      period, phase, reversedPhase,
      first: dashSegments(first, period, 8).filter(segment => segment.path.includes(' A ')).at(-1),
      second: dashSegments(second, period, 8).filter(segment => segment.path.includes(' A ')).at(-1),
      reverse: dashSegments({ points: [...second.points].reverse() }, period, 8)
        .find(segment => segment.path.includes(' A ')),
    }));
    return () => {
      for (const { first, second, reverse, phase, reversedPhase } of samples) {
        assert.deepEqual(first, second);
        assert.equal(first.path, 'M 32 0 A 8 8 0 0 1 40 8');
        assert.equal(first.offset, phase);
        assert.equal(reverse.path, 'M 40 8 A 8 8 0 0 0 32 0');
        assert.equal(reverse.offset, reversedPhase);
      }
    };
  }
);

routingScenario(
  "overlapping same-direction routes with different prefixes",
  "dash phases are sampled along their shared horizontal section",
  "same-direction shared runs align despite different prefixes and starting coordinates",
  () => {
    const first = { points: [{ x: 13, y: -97 }, { x: 13, y: 40 }, { x: 113, y: 40 }] };
    const second = { points: [{ x: -30, y: 15 }, { x: 38, y: 15 }, { x: 38, y: 40 }, { x: 88, y: 40 }] };
    const a = dashSegments(first).at(-1), b = dashSegments(second).at(-1);
    return () => {
      for (const x of [38, 40.5, 55, 87]) for (const animation of [0, -1.25, -7.5]) {
        const point = { x, y: 40 };
        assert.equal(phaseAt(a, first.points.at(-2), point, animation), phaseAt(b, second.points.at(-2), point, animation));
      }
    };
  }
);

routingScenario(
  "fractional negative coordinates in all four directions",
  "world-aligned dash phases are sampled along each direction",
  "all four directions align with fractional and negative world coordinates",
  () => {
    return () => {
      for (const vertical of [false, true]) for (const sign of [1, -1]) {
        const point = value => vertical ? { x: -12.5, y: value } : { x: value, y: -12.5 };
        const from = point(sign * -23.5), later = point(sign * -7.25), to = point(sign * 41.5);
        const a = dashSegments({ points: [from, to] })[0], b = dashSegments({ points: [later, to] })[0];
        for (const coordinate of [-7, 0, 12.5, 40]) {
          assert.equal(phaseAt(a, from, point(sign * coordinate), -2.25), phaseAt(b, later, point(sign * coordinate), -2.25));
        }
        assert.ok(a.offset >= 0 && a.offset < 10);
        assert.ok(b.offset >= 0 && b.offset < 10);
      }
    };
  }
);

routingScenario(
  "two routes traversing the same section in opposite directions",
  "their dash phases advance through the same animation interval",
  "opposite directions keep separate phases and move in opposite world directions",
  () => {
    return () => {
      for (const vertical of [false, true]) {
        const point = value => vertical ? { x: 5, y: value } : { x: value, y: 5 };
        const low = point(-23), high = point(47);
        const forward = dashSegments({ points: [low, high] })[0];
        const backward = dashSegments({ points: [high, low] })[0];
        assert.notEqual(phaseAt(forward, low, point(2)), phaseAt(backward, high, point(2)));
        assert.equal(phaseAt(forward, low, point(0)), 0);
        assert.equal(phaseAt(backward, high, point(0)), 0);
        assert.equal(phaseAt(forward, low, point(2), -2), 0, 'forward dash advances toward increasing coordinates');
        assert.equal(phaseAt(backward, high, point(-2), -2), 0, 'reverse dash advances toward decreasing coordinates');
        assert.notEqual(phaseAt(forward, low, point(2), -2), phaseAt(backward, high, point(2), -2));
      }
    };
  }
);

routingScenario(
  "a full route a subdivided route and a newly added overlapping route",
  "their dash phases are sampled using the shared animation clock",
  "segment subdivision and newly added edges use the same phase without an edge clock",
  () => {
    const full = { points: [{ x: -13, y: 6 }, { x: 93, y: 6 }] };
    const split = { points: [full.points[0], { x: 27.5, y: 6 }, full.points[1]] };
    const original = dashSegments(full)[0], subdivided = dashSegments(split)[1];
    const animation = -6.375;
    const newlyAdded = dashSegments({ points: [{ x: 18.25, y: 6 }, { x: 70, y: 6 }] })[0];
    return () => {
      for (const x of [28, 43.5, 69]) {
        const point = { x, y: 6 }, expected = phaseAt(original, full.points[0], point, animation);
        assert.equal(phaseAt(subdivided, split.points[1], point, animation), expected);
        assert.equal(phaseAt(newlyAdded, { x: 18.25, y: 6 }, point, animation), expected);
      }
    };
  }
);

routingScenario(
  "rounded routes sharing two bends after different prefixes",
  "their rounded dash geometry and phase are calculated",
  "rounded shared bends retain identical dash geometry and phase after different prefixes",
  () => {
    const first = { points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 100 }, { x: 140, y: 100 }] };
    const second = { points: [{ x: 20, y: -50 }, { x: 20, y: 0 }, ...first.points.slice(1)] };
    const a = dashSegments(first, 10, 8), b = dashSegments(second, 10, 8);
    const bends = a.filter(segment => segment.path.includes(' A '));
    return () => {
      assert.equal(bends.length, 2);
      for (const bend of bends) assert.ok(b.some(segment => segment.path === bend.path && segment.offset === bend.offset));
      assert.deepEqual(a.at(-1), b.at(-1), 'the shared outgoing straight keeps its world-aligned phase');
    };
  }
);

routingScenario(
  "duplicate route points custom periods and unsupported dash geometry",
  "the dash segment generator validates and splits the geometry",
  "geometry is not mutated, empty segments are skipped, and unsupported geometry stays unsplit",
  () => {
    const route = { points: [{ x: -3, y: 2 }, { x: -3, y: 2 }, { x: 9, y: 2 }, { x: 9, y: -6 }] };
    const snapshot = structuredClone(route);
    const actual = dashSegments(route);
    return () => {
      assert.deepEqual(actual, [
        { path: 'M -3 2 L 9 2', offset: 7 },
        { path: 'M 9 2 L 9 -6', offset: 8 },
      ]);
      assert.deepEqual(dashSegments(route, 6).map(segment => segment.offset), [3, 4]);
      assert.deepEqual(route, snapshot);
      for (const invalid of [null, {}, { points: [] }, { points: [{ x: 0, y: 0 }] },
        { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, { points: [{ x: NaN, y: 0 }] }]) {
        assert.deepEqual(dashSegments(invalid), []);
      }
      for (const period of [0, -1, NaN, Infinity]) assert.deepEqual(dashSegments(route, period), []);
    };
  }
);
