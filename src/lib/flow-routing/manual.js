// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { EPSILON, rectangles, terminalRectangles, clearRoute } from './clearance.js';
import { projectRoute } from './path.js';

const LIMIT = 1_000_000, MAX_POINTS = 128;
const defaults = { nodePadding: 12, stubLength: 20, maxWork: 500000 };
const same = (a, b) => a.x === b.x && a.y === b.y;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const direction = (a, b) => a.y === b.y ? b.x > a.x ? 'right' : 'left' : b.y > a.y ? 'bottom' : 'top';
const result = points => ({ points, length: points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0), status: 'routed' });
const spend = (budget, work) => (budget.work -= work) >= 0;

export function normalizeManualRoute(input) {
  if (!Array.isArray(input) || input.length < 2 || input.length > MAX_POINTS) return null;
  const output = [];
  for (const point of input) {
    if (!point || typeof point !== 'object' || Array.isArray(point) || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > LIMIT || Math.abs(point.y) > LIMIT) return null;
    const previous = output.at(-1);
    if (previous && same(previous, point)) continue;
    if (previous && previous.x !== point.x && previous.y !== point.y) return null;
    if (output.length > 1) {
      const before = output.at(-2);
      if (before.x === previous.x && previous.x === point.x || before.y === previous.y && previous.y === point.y) {
        if ((previous.x - before.x) * (point.x - previous.x) + (previous.y - before.y) * (point.y - previous.y) < 0) return null;
        output.pop();
      }
    }
    output.push({ x: point.x, y: point.y });
  }
  return output.length > 1 ? output : null;
}

export function segmentHandles(route) {
  const points = normalizeManualRoute(route?.points);
  return points ? points.slice(1).map((b, index) => {
    const a = points[index];
    return { index, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, axis: a.y === b.y ? 'y' : 'x' };
  }) : [];
}

function settings(options) {
  const config = { ...defaults };
  for (const name of Object.keys(defaults)) if (Number.isFinite(options[name]) && options[name] >= 0) config[name] = options[name];
  return config;
}

function attached(points, edge) {
  return points && points[0].x === edge.sourceX && points[0].y === edge.sourceY &&
    points.at(-1).x === edge.targetX && points.at(-1).y === edge.targetY &&
    direction(points[0], points[1]) === edge.sourcePosition && direction(points.at(-1), points.at(-2)) === edge.targetPosition;
}

function certify(points, edge, nodes, config, budget) {
  // Charge input validation and construction before allocating scene-sized arrays.
  if (!spend(budget, nodes.length * 2 + points.length)) return null;
  const valid = nodes.filter(node => [node.x, node.y, node.width, node.height].every(Number.isFinite) && node.width > 0 && node.height > 0);
  const full = rectangles(valid, config.nodePadding);
  if (clearRoute(points, full, edge, budget)) return full;
  if (budget.work < 0 || !config.nodePadding) return null;
  // Two rectangle arrays, terminal-owner lookups, face pairs and terminal gaps:
  // twelve node visits conservatively bound terminalRectangles' construction.
  if (!spend(budget, valid.length * 12)) return null;
  const constrained = terminalRectangles(valid, config.nodePadding, edge);
  return clearRoute(points, constrained, edge, budget) ? constrained : null;
}

export function resolveManualRoute(input, edge, nodes, options = {}, sharedBudget) {
  const original = normalizeManualRoute(input);
  if (!original) return null;
  const config = settings(options), budget = sharedBudget ?? { work: config.maxWork };
  if (!spend(budget, original.length)) return null;
  const projected = projectRoute(result(original), edge);
  const points = normalizeManualRoute(projected?.points);
  if (!attached(points, edge) || !certify(points, edge, nodes, config, budget)) return null;
  return { ...result(points), manualState: 'applied' };
}

// The selected owner's buffer must end before the new elbow can bend.
function exitDistance(point, other, id, boxes, along) {
  const owner = boxes.find(box => box.id === id);
  if (!owner) return 0;
  const face = along === 'x' ? other.x > point.x ? 'right' : 'left' : other.y > point.y ? 'bottom' : 'top';
  return Math.max(0, (owner[face] - point[along]) * Math.sign(other[along] - point[along]));
}

function materialize(drag, coordinate) {
  return drag.points.map((point, index) => ({ ...point,
    ...(drag.movingIndices.includes(index) ? { [drag.axis]: coordinate } : {}) }));
}

export function prepareSegmentDrag(route, index, edge, nodes, options = {}) {
  const original = normalizeManualRoute(route.points);
  if (!attached(original, edge) || !Number.isInteger(index) || index < 0 || index >= original.length - 1) return null;
  const config = settings(options), budget = { work: config.maxWork };
  const boxes = certify(original, edge, nodes, config, budget);
  if (!boxes) return null;
  const a = original[index], b = original[index + 1];
  const axis = a.y === b.y ? 'y' : 'x', along = axis === 'y' ? 'x' : 'y';
  const first = index === 0, last = index === original.length - 2;
  const points = original.map(point => ({ ...point }));
  let movingIndex = index;
  if (first || last) {
    if (points.length + 2 * (Number(first) + Number(last)) > MAX_POINTS || !spend(budget, boxes.length * 2)) return null;
    const span = distance(a, b), sign = Math.sign(b[along] - a[along]), preferred = Math.max(config.stubLength, 1);
    const sourceGap = first ? exitDistance(a, b, edge.source, boxes, along) : 0;
    const targetGap = last ? exitDistance(b, a, edge.target, boxes, along) : 0;
    const free = span - sourceGap - targetGap;
    if (free <= EPSILON) return null;
    const reserve = free / (first && last ? 3 : 2);
    const start = { ...a, [along]: a[along] + sign * (sourceGap + Math.min(Math.max(preferred - sourceGap, 0), reserve)) };
    const end = { ...b, [along]: b[along] - sign * (targetGap + Math.min(Math.max(preferred - targetGap, 0), reserve)) };
    const segment = [a, ...(first ? [start, { ...start }] : []), ...(last ? [{ ...end }, end] : []), b];
    points.splice(index, 2, ...segment);
    movingIndex += first ? 2 : 0;
    // Exempt only the fixed endpoint stubs, never the new movable run.
    if (!clearRoute(points, boxes, edge, budget)) return null;
  }
  const drag = { points, movingIndices: [movingIndex, movingIndex + 1], axis, startCoordinate: a[axis], low: -LIMIT, high: LIMIT, original };
  const [from, to] = drag.movingIndices;
  const run = [points[from][along], points[to][along]];
  const connectors = [
    { fixed: points[from - 1], moving: points[from], segment: from },
    { fixed: points[to + 1], moving: points[to], segment: to + 1 },
  ];
  if (!spend(budget, boxes.length * 3 + points.length * 2)) return null;
  for (const box of boxes) {
    const [u0, u1, v0, v1] = along === 'x' ? [box.left, box.right, box.top, box.bottom] : [box.top, box.bottom, box.left, box.right];
    const limit = fixed => {
      if (fixed <= v0) drag.high = Math.min(drag.high, v0);
      else if (fixed >= v1) drag.low = Math.max(drag.low, v1);
      else return false;
      return true;
    };
    if (Math.max(...run) > u0 && Math.min(...run) < u1 && !limit(drag.startCoordinate)) return null;
    for (const { fixed, moving, segment } of connectors) {
      if (segment === 1 && box.id === edge.source || segment === points.length - 1 && box.id === edge.target) continue;
      if (moving[along] > u0 && moving[along] < u1 && !limit(fixed[axis])) return null;
    }
  }
  // A connector may invert if its zero-length state merges into a valid path.
  // Opposite adjacent runs or reversed ports instead stop just before collapse.
  for (const coordinate of new Set(connectors.map(({ fixed }) => fixed[axis]))) {
    if (attached(normalizeManualRoute(materialize(drag, coordinate)), edge)) continue;
    const gap = Math.min(1e-6, Math.abs(drag.startCoordinate - coordinate));
    if (drag.startCoordinate < coordinate) drag.high = Math.min(drag.high, coordinate - gap);
    // Inserted zero elbows at the start normalize to the certified original;
    // every invalid collapse therefore lies strictly on one side of the start.
    else drag.low = Math.max(drag.low, coordinate + gap);
  }
  return drag.low <= drag.startCoordinate && drag.startCoordinate <= drag.high ? drag : null;
}

export function moveSegment(drag, coordinate) {
  const actual = Number.isFinite(coordinate) ? Math.max(drag.low, Math.min(drag.high, coordinate)) : drag.startCoordinate;
  return { route: result(materialize(drag, actual)), coordinate: actual, limited: actual !== coordinate };
}
