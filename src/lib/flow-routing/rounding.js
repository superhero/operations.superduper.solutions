// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

const distance = (a, b) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
const direction = (a, b) => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });
const phase = (point, unit) => unit.x ? unit.x * point.x : unit.y * point.y;

// Shared drawing primitives keep solid paths, dashed pieces and labels on the
// same geometry. Tight corners stay sharp rather than cutting through a node.
export function roundedSegments(route, radius = 8, obstacles = []) {
  if (!Array.isArray(route?.points) || !Number.isFinite(radius) || radius < 0) return [];
  const points = [];
  for (const point of route.points) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
    const previous = points.at(-1);
    if (previous && point.x !== previous.x && point.y !== previous.y) return [];
    if (previous && !distance(previous, point)) continue;
    if (radius > 0 && points.length > 1) {
      const before = points.at(-2), incoming = direction(before, previous), outgoing = direction(previous, point);
      if (incoming.x === outgoing.x && incoming.y === outgoing.y) points.pop();
    }
    points.push({ x: point.x, y: point.y });
  }
  if (points.length < 2) return [];
  const segments = [];
  const line = (from, to) => {
    const length = distance(from, to);
    if (length) segments.push({ from, to, command: `L ${to.x} ${to.y}`, length, phase: phase(from, direction(from, to)) });
  };
  let from = points[0];
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1], corner = points[index], after = points[index + 1];
    const incoming = direction(before, corner), outgoing = direction(corner, after);
    const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
    const r = cross ? Math.min(radius, distance(before, corner) / 2, distance(corner, after) / 2) : 0;
    const entry = { x: corner.x - incoming.x * r, y: corner.y - incoming.y * r };
    const exit = { x: corner.x + outgoing.x * r, y: corner.y + outgoing.y * r };
    const blocked = r && obstacles.some(box => Math.min(entry.x, exit.x) < box.x + box.width &&
      Math.max(entry.x, exit.x) > box.x && Math.min(entry.y, exit.y) < box.y + box.height && Math.max(entry.y, exit.y) > box.y);
    if (!r || blocked) {
      line(from, corner);
      from = corner;
      continue;
    }
    line(from, entry);
    const sweep = cross > 0 ? 1 : 0;
    segments.push({ from: entry, to: exit, command: `A ${r} ${r} 0 0 ${sweep} ${exit.x} ${exit.y}`,
      length: Math.PI * r / 2, phase: phase(entry, incoming),
      center: { x: entry.x + outgoing.x * r, y: entry.y + outgoing.y * r }, radius: r, sweep });
    from = exit;
  }
  line(from, points.at(-1));
  return segments;
}
