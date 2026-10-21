// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { roundedSegments } from './rounding.js';

export const bendRadius = 4;

export function routePath(route, radius = 0, obstacles = []) {
  if (!route?.points?.length) return null;
  if (radius > 0) {
    const segments = roundedSegments(route, radius, obstacles);
    if (segments.length) return `M ${segments[0].from.x} ${segments[0].from.y} ${segments.map(segment => segment.command).join(' ')}`;
  }
  return route.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
}

export function routeMidpoint(route, radius = 0, obstacles = []) {
  if (radius > 0) {
    const segments = roundedSegments(route, radius, obstacles);
    let remaining = segments.reduce((sum, segment) => sum + segment.length, 0) / 2;
    for (const segment of segments) {
      if (remaining <= segment.length) {
        if (segment.center) {
          const angle = Math.atan2(segment.from.y - segment.center.y, segment.from.x - segment.center.x) +
            (segment.sweep ? 1 : -1) * remaining / segment.radius;
          return { x: segment.center.x + segment.radius * Math.cos(angle), y: segment.center.y + segment.radius * Math.sin(angle) };
        }
        return { x: segment.from.x + (segment.to.x - segment.from.x) * remaining / segment.length,
          y: segment.from.y + (segment.to.y - segment.from.y) * remaining / segment.length };
      }
      remaining -= segment.length;
    }
  }
  let remaining = route.length / 2;
  for (let index = 1; index < route.points.length; index++) {
    const a = route.points[index - 1];
    const b = route.points[index];
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (length && remaining <= length) {
      return { x: a.x + (b.x - a.x) * remaining / length, y: a.y + (b.y - a.y) * remaining / length };
    }
    remaining -= length;
  }
  return route.points[0];
}

export function matchesEndpoints(route, edge) {
  const first = route?.points[0];
  const last = route?.points.at(-1);
  return first?.x === edge.sourceX && first?.y === edge.sourceY && last?.x === edge.targetX && last?.y === edge.targetY;
}

// Acquiring or losing a target is still the same drag. Keep its last detour
// while the worker catches up, but never borrow a different drag or approach.
export function cachedPreview(cache, current, session) {
  return current && cache?.geometry && cache.session === session &&
    ['source', 'sourceX', 'sourceY', 'sourcePosition', 'targetPosition'].every(key => current[key] === cache.geometry[key])
    ? cache.route : null;
}

const same = (a, b) => a.x === b.x && a.y === b.y;
const direction = (a, b) => same(a, b) ? null : a.y === b.y ? (b.x > a.x ? 0 : 2) :
  a.x === b.x ? (b.y > a.y ? 1 : 3) : undefined;
const sides = { right: 0, bottom: 1, left: 2, top: 3 };

function valid(points, edge) {
  const turns = points.slice(1).map((point, index) => direction(points[index], point)).filter(value => value !== null);
  return turns.length && !turns.includes(undefined) && turns[0] === sides[edge.sourcePosition] &&
    turns.at(-1) === (sides[edge.targetPosition] + 2) % 4 &&
    !turns.some((value, index) => index && value === (turns[index - 1] + 2) % 4);
}

function projectTip(original, edge) {
  const points = original.map(point => ({ ...point }));
  const tip = points.at(-1), bend = points.at(-2), terminalDirection = direction(bend, tip);
  const axis = terminalDirection % 2 === 0 ? 'x' : 'y', across = axis === 'x' ? 'y' : 'x';
  const target = { x: edge.targetX, y: edge.targetY }, span = tip[axis] - bend[axis];
  if (points.length === 2) {
    tip.x = target.x; tip.y = target.y;
    if (valid(points, edge)) return points;
    // A formerly straight edge needs local elbows when one endpoint moves.
    const stub = Math.sign(span) * Math.min(Math.abs(span) / 2, 20);
    const start = { ...bend, [axis]: bend[axis] + stub }, end = { ...target, [axis]: target[axis] - stub };
    const outer = Math.min(start[across], end[across]) - Math.abs(stub);
    const candidates = [
      [bend, start, { ...start, [across]: end[across] }, end, target],
      [bend, start, { ...end, [across]: start[across] }, end, target],
      [bend, start, { ...start, [across]: outer }, { ...end, [across]: outer }, end, target],
    ];
    return candidates.find(candidate => valid(candidate, edge)) ?? null;
  }
  const previous = points.at(-3), perpendicularSpan = bend[across] - previous[across];
  bend[across] = target[across];
  // Retain the approach length if a snap jumps behind its final bend.
  if ((target[axis] - bend[axis]) * span <= 0) {
    if (points.length < 4) return null;
    const prefix = points.at(-4), prefixDirection = direction(prefix, previous);
    previous[axis] = bend[axis] = target[axis] - span;
    if (!same(prefix, previous) && direction(prefix, previous) !== prefixDirection) return null;
  }
  tip.x = target.x; tip.y = target.y;
  if (valid(points, edge)) return points;
  // Crossing a bend axis may collapse two opposite legs into a hairpin.
  // Shift their preceding run to either side, retaining the earlier detour.
  if (points.length >= 5 && same(previous, bend)) {
    const offset = Math.sign(perpendicularSpan) * Math.min(Math.abs(perpendicularSpan), 1);
    for (const shift of [-offset, offset]) {
      const candidate = points.map(point => ({ ...point }));
      candidate.at(-3)[across] += shift;
      candidate.at(-4)[across] += shift;
      if (valid(candidate, edge)) return candidate;
    }
  }
  return null;
}

// Display-only endpoint updates while the worker computes a checked route.
// Moving one node leaves the interior fixed; moving both equally translates it.
export function projectRoute(route, edge) {
  if (!edge || !route?.points?.length || ![edge.sourceX, edge.sourceY, edge.targetX, edge.targetY].every(Number.isFinite)) return null;
  let points = route.points.filter((point, index) => !index || !same(point, route.points[index - 1])).map(point => ({ ...point }));
  if (points.length < 2 || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y)) || !valid(points, edge)) return null;
  const first = points[0], last = points.at(-1);
  const dx = edge.sourceX - first.x, dy = edge.sourceY - first.y;
  if (dx === edge.targetX - last.x && dy === edge.targetY - last.y) {
    points = points.map(point => ({ x: point.x + dx, y: point.y + dy }));
  } else {
    if (dx || dy) {
      points = projectTip(points.reverse(), { sourcePosition: edge.targetPosition, targetPosition: edge.sourcePosition,
        targetX: edge.sourceX, targetY: edge.sourceY });
      if (!points) return null;
      points.reverse();
    }
    if (points.at(-1).x !== edge.targetX || points.at(-1).y !== edge.targetY) points = projectTip(points, edge);
    if (!points) return null;
  }
  points = points.filter((point, index) => !index || !same(point, points[index - 1]));
  return { points, length: points.slice(1).reduce((sum, point, index) => sum + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0),
    status: route.status ?? 'routed' };
}

export function previewRoute(route, edge) {
  if (!edge || !route?.points?.length || route.points[0].x !== edge.sourceX || route.points[0].y !== edge.sourceY) return null;
  return projectRoute(route, edge);
}

export function previewPath(route, edge, radius = 0, obstacles = []) {
  return routePath(previewRoute(route, edge), radius, obstacles);
}
