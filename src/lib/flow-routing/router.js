// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

// Orthogonal routing over obstacle boundaries, independent of Svelte and the DOM.
// Searches are deliberately bounded: impossible or very crowded scenes retain a
// visible fallback connection instead of holding up the editor.
import { EPSILON, rectangles, terminalRectangles, intersects, clearRoute } from './clearance.js';
import { resolveManualRoute } from './manual.js';
const directions = { right: [1, 0], bottom: [0, 1], left: [-1, 0], top: [0, -1] };
const defaults = { nodePadding: 12, stubLength: 20, maxLengthRatio: 4, maxGridPoints: 8192, maxWork: 500000, maxRoutedEdges: 250 };
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const same = (a, b) => distance(a, b) < EPSILON;
const directionOf = (a, b) => a.x < b.x ? 0 : a.x > b.x ? 2 : a.y < b.y ? 1 : 3;
const length = (points) => points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
const compareId = (a, b) => String(a.id).localeCompare(String(b.id), 'en');
const result = (points, status = 'routed') => ({ points: simplify(points), length: length(points), status });

function simplify(points) {
  const output = [];
  for (const point of points) {
    if (output.length && same(output.at(-1), point)) continue;
    while (output.length > 1) {
      const a = output.at(-2), b = output.at(-1);
      if (Math.abs(distance(a, b) + distance(b, point) - distance(a, point)) > EPSILON ||
          !((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) break;
      output.pop();
    }
    output.push({ x: point.x, y: point.y });
  }
  return output;
}

function clear(a, b, boxes, budget, except) {
  for (const box of boxes) {
    if (--budget.work < 0) return false;
    if (box.id !== except && intersects(a, b, box)) return false;
  }
  return true;
}

function endpoints(edge) {
  return [{ x: edge.sourceX, y: edge.sourceY }, { x: edge.targetX, y: edge.targetY }];
}

function stem(point, side, amount) {
  const [x, y] = directions[side] || directions.right;
  return { x: point.x + x * amount, y: point.y + y * amount };
}

function fallback(edge, options) {
  const [source, target] = endpoints(edge);
  if (![source.x, source.y, target.x, target.y].every(Number.isFinite)) return result([], 'fallback');
  const a = stem(source, edge.sourcePosition, options.stubLength);
  const b = stem(target, edge.targetPosition, options.stubLength);
  const middle = { x: b.x, y: a.y };
  return result([source, a, middle, b, target], 'fallback');
}

function endpointStem(point, side, owner, other, boxes, options) {
  const [dx, dy] = directions[side] || directions.right;
  let amount = Math.min(options.stubLength, Math.max(1, distance(point, other) / 2));
  if (owner) amount = Math.max(amount, dx > 0 ? owner.right - point.x : dx < 0 ? point.x - owner.left :
    dy > 0 ? owner.bottom - point.y : point.y - owner.top);
  // End the stem before the next obstacle's clearance boundary.
  for (const box of boxes) {
    if (box.id === owner?.id) continue;
    const inSpan = dx ? point.y > box.top + EPSILON && point.y < box.bottom - EPSILON :
      point.x > box.left + EPSILON && point.x < box.right - EPSILON;
    const gap = dx > 0 ? box.left - point.x : dx < 0 ? point.x - box.right :
      dy > 0 ? box.top - point.y : point.y - box.bottom;
    if (inSpan && gap >= 0) amount = Math.min(amount, gap);
  }
  return stem(point, side, amount);
}

function crosses(a, b, c, d) {
  const horizontal = Math.abs(a.y - b.y) < EPSILON;
  if (horizontal === (Math.abs(c.y - d.y) < EPSILON)) return 0;
  const x = horizontal ? c.x : a.x, y = horizontal ? a.y : c.y;
  const inside = (value, first, second, inclusive) => value > Math.min(first, second) + EPSILON &&
    value < Math.max(first, second) - EPSILON || inclusive && Math.abs(value - Math.max(first, second)) < EPSILON;
  // Half-open candidate segments count a crossing at a grid boundary once.
  // Joining an existing bend or endpoint is an overlap, not a crossing.
  return +(horizontal ? inside(x, a.x, b.x, true) && inside(y, c.y, d.y) :
    inside(y, a.y, b.y, true) && inside(x, c.x, d.x));
}

function crossingCount(points, routes, edge, budget) {
  let count = 0;
  const [source, target] = endpoints(edge);
  for (const route of routes) {
    if (route.id === edge.id) continue;
    const shared = [];
    for (const [origin, side] of [[source, edge.sourcePosition], [target, edge.targetPosition]]) {
      for (const [start, end] of [[route.points[0], route.points[1]], [route.points.at(-1), route.points.at(-2)]]) {
        if (start && end && same(origin, start) && directionOf(start, end) === Object.keys(directions).indexOf(side)) shared.push([start, end]);
      }
    }
    for (let i = 1; i < points.length; i++) for (let j = 1; j < route.points.length; j++) {
      if (--budget.work < 0) return Infinity;
      const a = points[i - 1], b = points[i], c = route.points[j - 1], d = route.points[j];
      // Shared ports and their initial stems are deliberate, not crossings.
      if ((same(a, source) || same(b, source)) && (same(c, source) || same(d, source)) ||
          (same(a, target) || same(b, target)) && (same(c, target) || same(d, target))) continue;
      if (crosses(a, b, c, d)) {
        const intersection = a.y === b.y ? { x: c.x, y: a.y } : { x: a.x, y: c.y };
        // A full route can join an existing line at its own bend, too. Search
        // steps contain only 2 points, so real crossings at grid boundaries
        // retain their half-open accounting until the complete path is known.
        const follows = (neighbor) => neighbor && !same(neighbor, intersection) &&
          Math.abs(a.y === b.y ? neighbor.x - intersection.x : neighbor.y - intersection.y) < EPSILON;
        if (same(a, intersection) && follows(points[i - 2]) || same(b, intersection) && follows(points[i + 1])) continue;
        if (!shared.some(([start, end]) => Math.abs(distance(start, intersection) + distance(intersection, end) - distance(start, end)) < EPSILON)) count++;
      }
    }
  }
  return count;
}

class Queue {
  values = [];
  push(entry) {
    let index = this.values.length;
    this.values.push(entry);
    while (index) {
      const parent = (index - 1) >> 1;
      if (this.values[parent].cost <= entry.cost) break;
      this.values[index] = this.values[parent]; index = parent;
    }
    this.values[index] = entry;
  }
  pop() {
    const first = this.values[0], last = this.values.pop();
    if (this.values.length) {
      let index = 0;
      while (index * 2 + 1 < this.values.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.values.length && this.values[child + 1].cost < this.values[child].cost) child++;
        if (this.values[child].cost >= last.cost) break;
        this.values[index] = this.values[child]; index = child;
      }
      this.values[index] = last;
    }
    return first;
  }
}

function search(edge, nodes, options, budget, routes = [], maximum = Infinity, boxes = rectangles(nodes, options.nodePadding, edge)) {
  const [source, target] = endpoints(edge);
  const a = endpointStem(source, edge.sourcePosition, boxes.find((box) => box.id === edge.source), target, boxes, options);
  const b = endpointStem(target, edge.targetPosition, boxes.find((box) => box.id === edge.target), source, boxes, options);
  if (same(a, source) || same(b, target) || !clear(source, a, boxes, budget, edge.source) ||
      !clear(b, target, boxes, budget, edge.target)) return null;
  const stemLength = distance(source, a) + distance(b, target);
  const sourceDirection = Object.keys(directions).indexOf(edge.sourcePosition || 'right');
  const targetDirection = (Object.keys(directions).indexOf(edge.targetPosition || 'left') + 2) % 4;
  // Most connections need no search. These candidates attain the Manhattan
  // lower bound between the stubs whenever one of the two elbows is clear.
  const elbows = [{ x: b.x, y: a.y }, { x: a.x, y: b.y }].map((corner) => {
    const middle = simplify([a, corner, b]);
    return { middle, points: simplify([source, ...middle, target]) };
  }).sort((first, second) => first.points.length - second.points.length);
  for (const { middle, points } of elbows) {
    const turns = points.slice(1).map((point, index) => directionOf(points[index], point));
    if (points.length < 2 || turns[0] !== sourceDirection || turns.at(-1) !== targetDirection ||
        turns.some((direction, index) => index && direction === (turns[index - 1] + 2) % 4) ||
        length(points) > maximum + EPSILON) continue;
    if (middle.slice(1).every((point, index) => clear(middle[index], point, boxes, budget)) &&
        (!routes.length || crossingCount(points, routes, edge, budget) === 0)) return result(points);
  }
  const xs = new Set([a.x, b.x]), ys = new Set([a.y, b.y]);
  // Use nearby obstacle boundaries, never a pixel grid. Every segment is still
  // checked against ALL obstacles, including ones omitted from this grid.
  const rank = (box) => Math.max(0, Math.min(a.x, b.x) - box.right, box.left - Math.max(a.x, b.x)) +
    Math.max(0, Math.min(a.y, b.y) - box.bottom, box.top - Math.max(a.y, b.y));
  const nearby = [...boxes].sort((x, y) => rank(x) - rank(y) || compareId(x, y)).slice(0, 32);
  for (const box of nearby) { xs.add(box.left); xs.add(box.right); ys.add(box.top); ys.add(box.bottom); }
  const margin = Math.max(options.stubLength, options.nodePadding, 1);
  xs.add(Math.min(a.x, b.x) - margin); xs.add(Math.max(a.x, b.x) + margin);
  ys.add(Math.min(a.y, b.y) - margin); ys.add(Math.max(a.y, b.y) + margin);
  for (const route of routes) for (const point of route.points) {
    if (point.x < Math.min(a.x, b.x) - maximum || point.x > Math.max(a.x, b.x) + maximum ||
        point.y < Math.min(a.y, b.y) - maximum || point.y > Math.max(a.y, b.y) + maximum) continue;
    xs.add(point.x - margin); xs.add(point.x + margin); ys.add(point.y - margin); ys.add(point.y + margin);
    if (xs.size * ys.size > options.maxGridPoints) return null;
  }
  const xx = [...xs].sort((x, y) => x - y), yy = [...ys].sort((x, y) => x - y), width = xx.length;
  if (width * yy.length > options.maxGridPoints) return null;
  const start = yy.indexOf(a.y) * width + xx.indexOf(a.x), finish = yy.indexOf(b.y) * width + xx.indexOf(b.x);
  const point = (index) => ({ x: xx[index % width], y: yy[Math.floor(index / width)] });
  const queue = new Queue(), best = new Map(), previous = new Map(), visibility = new Map();
  const initial = start * 4 + sourceDirection;
  best.set(initial, 0); queue.push({ key: initial, cost: 0, travelled: stemLength });
  while (queue.values.length && budget.work > 0) {
    const current = queue.pop(), index = Math.floor(current.key / 4), direction = current.key % 4;
    if (current.cost !== best.get(current.key)) continue;
    if (index === finish && direction !== (targetDirection + 2) % 4) {
      const points = [];
      for (let key = current.key; key !== undefined; key = previous.get(key)) points.push(point(Math.floor(key / 4)));
      return result([source, ...points.reverse(), target]);
    }
    const x = index % width, y = Math.floor(index / width);
    const adjacent = [x + 1 < width ? index + 1 : -1, y + 1 < yy.length ? index + width : -1,
      x > 0 ? index - 1 : -1, y > 0 ? index - width : -1];
    for (let nextDirection = 0; nextDirection < 4; nextDirection++) {
      const next = adjacent[nextDirection];
      if (next < 0 || nextDirection === (direction + 2) % 4) continue;
      const from = point(index), to = point(next), travelled = current.travelled + distance(from, to);
      if (travelled + distance(to, b) > maximum + EPSILON) continue;
      const segment = `${Math.min(index, next)}:${Math.max(index, next)}`;
      if (!visibility.has(segment)) visibility.set(segment, clear(from, to, boxes, budget));
      if (!visibility.get(segment)) continue;
      const crossings = routes.length ? crossingCount([from, to], routes, edge, budget) : 0;
      const cost = current.cost + distance(from, to) + (nextDirection === direction ? 0 : 0.001) +
        (next === finish && nextDirection !== targetDirection && nextDirection !== (targetDirection + 2) % 4 ? 0.001 : 0) +
        (crossings ? crossings * (maximum + 1) : 0);
      const key = next * 4 + nextDirection;
      if (cost >= (best.get(key) ?? Infinity)) continue;
      best.set(key, cost); previous.set(key, current.key); queue.push({ key, cost, travelled });
    }
  }
  return null;
}

function baseline(edge, nodes, options, budget) {
  if (budget.work <= 0 || ![edge.sourceX, edge.sourceY, edge.targetX, edge.targetY].every(Number.isFinite)) return fallback(edge, options);
  const routed = search(edge, nodes, options, budget) || (options.nodePadding && budget.work > 0
    ? search(edge, nodes, options, budget, [], Infinity, terminalRectangles(nodes, options.nodePadding, edge)) : null);
  if (routed) return routed;
  // Overlapping buffers can enclose a corridor even after terminal relaxation.
  // Prefer a checked body-avoiding last resort over an unchecked visible path;
  // its fallback status prevents crossing or overlap passes exploiting lost spacing.
  const tight = options.nodePadding && budget.work > 0
    ? search(edge, nodes, options, budget, [], Infinity, rectangles(nodes, 0)) : null;
  return tight ? { ...tight, status: 'fallback' } : fallback(edge, options);
}

function improve(edge, nodes, routes, original, options, budget) {
  if (original.status !== 'routed' || budget.work <= 0) return original;
  const count = crossingCount(original.points, routes, edge, budget);
  if (!count || !Number.isFinite(count)) return original;
  const maximum = original.length * options.maxLengthRatio;
  const padded = rectangles(nodes, options.nodePadding, edge);
  const boxes = clearRoute(original.points, padded, edge, budget) ? padded : terminalRectangles(nodes, options.nodePadding, edge);
  const candidate = search(edge, nodes, options, budget, routes, maximum, boxes);
  return candidate && candidate.length <= maximum + EPSILON && crossingCount(candidate.points, routes, edge, budget) < count ? candidate : original;
}

function sharedLength(points, routes, edge, budget) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], horizontal = Math.abs(a.y - b.y) < EPSILON;
    const axis = horizontal ? 'x' : 'y', across = horizontal ? 'y' : 'x', intervals = [];
    for (const route of routes) {
      if (route.id === edge.id) continue;
      for (let j = 1; j < route.points.length; j++) {
        if (--budget.work < 0) return -Infinity;
        const c = route.points[j - 1], d = route.points[j];
        if (directionOf(a, b) !== directionOf(c, d)) continue;
        if (Math.abs(c[across] - a[across]) >= EPSILON || Math.abs(d[across] - a[across]) >= EPSILON) continue;
        const start = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
        const end = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
        if (end > start + EPSILON) intervals.push([start, end]);
      }
    }
    // Count occupied line length once, even when several existing arrows share it.
    let covered = -Infinity;
    for (const [start, end] of intervals.sort((first, second) => first[0] - second[0])) {
      total += Math.max(0, end - Math.max(start, covered));
      covered = Math.max(covered, end);
    }
  }
  return total;
}

function alignSegments(edge, nodes, routes, original, options, budget) {
  if (original.status !== 'routed' || original.points.length < 4 || !routes.length || budget.work <= 0) return original;
  let current = original, shared = sharedLength(current.points, routes, edge, budget);
  let crossings = crossingCount(current.points, routes, edge, budget);
  const padded = rectangles(nodes, options.nodePadding, edge);
  const boxes = clearRoute(current.points, padded, edge, budget) ? padded : terminalRectangles(nodes, options.nodePadding, edge);
  // One bounded pass slides existing interior segments; it introduces no bends
  // and leaves all established routes untouched. Keep the baseline's full or
  // terminal-constrained clearance; sharing lines never relaxes it further.
  for (let i = 1; i < current.points.length - 2 && budget.work > 0; i++) {
    const a = current.points[i], b = current.points[i + 1], horizontal = Math.abs(a.y - b.y) < EPSILON;
    const axis = horizontal ? 'x' : 'y', across = horizontal ? 'y' : 'x', coordinates = new Set();
    for (const route of routes) {
      if (route.id === edge.id) continue;
      for (let j = 1; j < route.points.length; j++) {
        if (--budget.work < 0) return current;
        const c = route.points[j - 1], d = route.points[j];
        if (directionOf(a, b) === directionOf(c, d) && Math.abs(c[across] - d[across]) < EPSILON && Math.abs(c[across] - a[across]) > EPSILON &&
            Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) >
            Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) + EPSILON) coordinates.add(c[across]);
      }
    }
    let best = current, bestShared = shared, bestCrossings = crossings;
    for (const coordinate of [...coordinates].sort((x, y) => Math.abs(x - a[across]) - Math.abs(y - a[across]) || x - y)) {
      if (budget.work <= 0) break;
      const points = simplify(current.points.map((point, index) => index === i || index === i + 1 ? { ...point, [across]: coordinate } : point));
      const turns = points.slice(1).map((point, index) => directionOf(points[index], point));
      if (points.length < 2 || points.length > current.points.length || length(points) > current.length + EPSILON ||
          turns[0] !== Object.keys(directions).indexOf(edge.sourcePosition) ||
          turns.at(-1) !== (Object.keys(directions).indexOf(edge.targetPosition) + 2) % 4 ||
          turns.some((direction, index) => index && direction === (turns[index - 1] + 2) % 4) ||
          !clearRoute(points, boxes, edge, budget)) continue;
      const candidateShared = sharedLength(points, routes, edge, budget);
      if (candidateShared <= bestShared + EPSILON) continue;
      const candidateCrossings = crossingCount(points, routes, edge, budget);
      if (budget.work <= 0 || candidateCrossings > crossings) continue;
      best = result(points); bestShared = candidateShared; bestCrossings = candidateCrossings;
    }
    current = best; shared = bestShared; crossings = bestCrossings;
  }
  return current;
}

// Opposing traffic gets separate lanes; equal-direction runs still share a line.
// Only slide interior segments, keeping ports, authored routes and clearance intact.
function separateOpposing(edge, nodes, routes, original, options, budget) {
  if (original.status !== 'routed' || original.manualState === 'applied' || original.points.length < 4 || !routes.length || budget.work <= 0) return original;
  let current = original;
  const gap = 6, padded = rectangles(nodes, options.nodePadding, edge);
  const boxes = clearRoute(current.points, padded, edge, budget) ? padded : terminalRectangles(nodes, options.nodePadding, edge);
  for (let i = 1; i < current.points.length - 2 && budget.work > 0; i++) {
    const a = current.points[i], b = current.points[i + 1], horizontal = a.y === b.y;
    const axis = horizontal ? 'x' : 'y', across = horizontal ? 'y' : 'x';
    const direction = directionOf(a, b), offset = direction === 0 || direction === 1 ? -gap : gap;
    let coordinate = a[across];
    for (const route of routes) {
      if (route.id === edge.id) continue;
      for (let j = 1; j < route.points.length; j++) {
        if (--budget.work < 0) return current;
        const c = route.points[j - 1], d = route.points[j];
        if (directionOf(c, d) !== (direction + 2) % 4 ||
            Math.abs(c[across] - a[across]) >= gap - EPSILON ||
            Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) <=
              Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) + EPSILON) continue;
        coordinate = offset < 0 ? Math.min(coordinate, c[across] + offset) : Math.max(coordinate, c[across] + offset);
      }
    }
    if (Math.abs(coordinate - a[across]) < EPSILON) continue;
    const points = current.points.map((point, index) => index === i || index === i + 1 ? { ...point, [across]: coordinate } : point);
    // A short neighbouring leg must not reverse direction or collapse a port stem.
    if (points.some((point, index) => index && (same(points[index - 1], point) ||
        directionOf(points[index - 1], point) !== directionOf(current.points[index - 1], current.points[index]))) ||
        !clearRoute(points, boxes, edge, budget)) continue;
    const before = crossingCount(current.points, routes, edge, budget), after = crossingCount(points, routes, edge, budget);
    if (budget.work > 0 && after <= before) current = result(points);
  }
  return current;
}

function settings(options) {
  const config = { ...defaults, ...options };
  for (const name of Object.keys(defaults)) if (!Number.isFinite(config[name]) || config[name] < 0) config[name] = defaults[name];
  config.maxLengthRatio = Math.max(1, config.maxLengthRatio);
  return config;
}

export function routeEdges({ nodes, edges }, options = {}) {
  const config = settings(options), budget = { work: config.maxWork }, sorted = [...edges].sort(compareId);
  const obstacles = nodes.filter((node) => [node.x, node.y, node.width, node.height].every(Number.isFinite) && node.width > 0 && node.height > 0).sort(compareId);
  const output = new Map();
  for (const [index, edge] of sorted.entries()) {
    const manual = edge.manualRoute !== undefined ? resolveManualRoute(edge.manualRoute, edge, obstacles, config, budget) : null;
    output.set(edge.id, manual || (index < config.maxRoutedEdges ? baseline(edge, obstacles, config, budget) : fallback(edge, config)));
  }
  const shortest = new Map(output);
  for (const edge of sorted.slice(0, config.maxRoutedEdges)) {
    if (budget.work <= 0) break;
    if (output.get(edge.id).manualState === 'applied') continue;
    const routes = sorted.map((other) => ({ ...other, points: output.get(other.id).points }));
    const routed = improve(edge, obstacles, routes, output.get(edge.id), config, budget);
    output.set(edge.id, alignSegments(edge, obstacles, routes, routed, config, budget));
  }
  // Later edges can move out of an earlier edge's way. Drop the obsolete
  // crossing detour when its checked baseline now has no more crossings.
  // Reuse the initial searches rather than doing another layout/search pass.
  for (const edge of sorted.slice(0, config.maxRoutedEdges)) {
    if (budget.work <= 0) break;
    const candidate = shortest.get(edge.id), current = output.get(edge.id);
    if (candidate.status !== 'routed' || current.status !== 'routed' ||
        current.manualState === 'applied' || candidate.length >= current.length - EPSILON) continue;
    const routes = sorted.map(other => ({ ...other, points: output.get(other.id).points }));
    const before = crossingCount(current.points, routes, edge, budget), after = crossingCount(candidate.points, routes, edge, budget);
    if (budget.work > 0 && after <= before) output.set(edge.id, candidate);
  }
  for (const edge of sorted) if (edge.manualRoute !== undefined && !output.get(edge.id).manualState)
    output.set(edge.id, { ...output.get(edge.id), manualState: 'suspended' });
  for (const edge of sorted.slice(0, config.maxRoutedEdges)) {
    if (budget.work <= 0) break;
    const routes = sorted.map(other => ({ ...other, points: output.get(other.id).points }));
    const original = output.get(edge.id);
    output.set(edge.id, { ...original, ...separateOpposing(edge, obstacles, routes, original, config, budget) });
  }
  return output;
}

export function routeConnection(edge, nodes, existingRoutes = [], options = {}) {
  const config = settings(options), budget = { work: config.maxWork };
  const obstacles = nodes.filter((node) => [node.x, node.y, node.width, node.height].every(Number.isFinite) && node.width > 0 && node.height > 0).sort(compareId);
  const manual = edge.manualRoute !== undefined ? resolveManualRoute(edge.manualRoute, edge, obstacles, config, budget) : null;
  if (manual) return manual;
  const routes = existingRoutes.map((route) => ({ ...route, points: simplify(route.points) })).sort(compareId);
  const routed = improve(edge, obstacles, routes, baseline(edge, obstacles, config, budget), config, budget);
  const aligned = alignSegments(edge, obstacles, routes, routed, config, budget);
  const output = separateOpposing(edge, obstacles, routes, aligned, config, budget);
  return edge.manualRoute !== undefined ? { ...output, manualState: 'suspended' } : output;
}
