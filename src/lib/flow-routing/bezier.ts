// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import type { EdgeDrawing } from './context.ts';
import type { EdgeEndpoints, NodeRect, Point, Route } from './types.js';
import type { WorkflowLineStyle } from '../workflow-line-style.ts';

type Cubic = [Point, Point, Point, Point];
type Anchor = Point & { direction: Point; corner?: Point };
const mix = (a: Point, b: Point, t = 0.5): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const at = ([a, b, c, d]: Cubic, t: number): Point => mix(mix(mix(a, b, t), mix(b, c, t), t), mix(mix(b, c, t), mix(c, d, t), t), t);
const unit = (a: Point, b: Point): Point => ({ x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) });
const sides = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
const towards = (a: Point, b: Point, direction: Point, strength: number, minimum = 0): Point => {
  const distance = (b.x - a.x) * direction.x + (b.y - a.y) * direction.y;
  const offset = Math.max(minimum, distance >= 0 ? distance / 2 : 6.25 * Math.sqrt(-distance)) * strength / 50;
  return { x: a.x + direction.x * offset, y: a.y + direction.y * offset };
};

function within(curve: Cubic, frame: { left: number; right: number; top: number; bottom: number }): boolean {
  const parameters = new Set([0, 1]);
  for (const axis of ['x', 'y'] as const) {
    const [p, q, r, s] = curve.map(point => point[axis]) as [number, number, number, number];
    const a = -p + 3*q - 3*r + s, b = 2*(p - 2*q + r), c = q - p, discriminant = b*b - 4*a*c;
    if (Math.abs(a) < 1e-9) { if (Math.abs(b) > 1e-9) parameters.add(-c / b); }
    else if (discriminant >= 0) { parameters.add((-b + Math.sqrt(discriminant)) / (2*a)); parameters.add((-b - Math.sqrt(discriminant)) / (2*a)); }
  }
  return [...parameters].filter(t => t >= 0 && t <= 1).every(t => {
    const p = at(curve, t);
    return p.x >= frame.left && p.x <= frame.right && p.y >= frame.top && p.y <= frame.bottom;
  });
}

export function cubicControls(edge: EdgeEndpoints, strength: number): Cubic {
  const a = { x: edge.sourceX, y: edge.sourceY }, b = { x: edge.targetX, y: edge.targetY };
  return [a, towards(a, b, sides[edge.sourcePosition], strength), towards(b, a, sides[edge.targetPosition], strength), b];
}

// A cubic lies inside the convex hull of its controls. Recursively separating
// their bounding boxes certifies clearance without trusting sampled points.
function clear(curve: Cubic, boxes: NodeRect[], budget: { work: number }, depth = 0): boolean {
  const left = Math.min(...curve.map(p => p.x)), right = Math.max(...curve.map(p => p.x));
  const top = Math.min(...curve.map(p => p.y)), bottom = Math.max(...curve.map(p => p.y));
  const near: NodeRect[] = [];
  for (const box of boxes) {
    if (--budget.work < 0) return false;
    if (left < box.x + box.width - 1e-7 && right > box.x + 1e-7 && top < box.y + box.height - 1e-7 && bottom > box.y + 1e-7) near.push(box);
  }
  if (!near.length) return true;
  if (depth >= 10 || near.some(box => curve.every(p => p.x > box.x && p.x < box.x + box.width && p.y > box.y && p.y < box.y + box.height))) return false;
  const [a, b, c, d] = curve, ab = mix(a, b), bc = mix(b, c), cd = mix(c, d), abc = mix(ab, bc), bcd = mix(bc, cd), middle = mix(abc, bcd);
  return clear([a, ab, abc, middle], near, budget, depth + 1) && clear([middle, bcd, cd, d], near, budget, depth + 1);
}

function terminalBoxes(boxes: NodeRect[], edge: EdgeEndpoints & { source?: string | undefined; target?: string | undefined }): NodeRect[] {
  return boxes.map(box => {
    let { x, y, width, height } = box;
    for (const [id, px, py, side] of [[edge.source, edge.sourceX, edge.sourceY, edge.sourcePosition], [edge.target, edge.targetX, edge.targetY, edge.targetPosition]] as const) {
      if (box.id !== id) continue;
      // Only the facing port buffer is open. Every node body and the other
      // three clearance faces remain protected, including on returning curves.
      if (side === 'right') width = Math.min(x + width, px) - x;
      if (side === 'bottom') height = Math.min(y + height, py) - y;
      if (side === 'left') { const end = x + width; x = Math.max(x, px); width = end - x; }
      if (side === 'top') { const end = y + height; y = Math.max(y, py); height = end - y; }
    }
    return { ...box, x, y, width, height };
  });
}

function drawing(curves: Cubic[]): EdgeDrawing {
  const first = curves[0]![0];
  const path = `M${first.x},${first.y} ${curves.map(([, b, c, d]) => `C${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}`).join(' ')}`;
  const samples = curves.flatMap((curve, index) => Array.from({ length: 17 }, (_, i) => ({ point: at(curve, i / 16), curve: index, t: i / 16 })));
  const lengths = samples.map((sample, i) => i ? Math.hypot(sample.point.x - samples[i - 1]!.point.x, sample.point.y - samples[i - 1]!.point.y) : 0);
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let midpoint = first;
  for (let i = 1; i < samples.length; i++) {
    if (remaining <= lengths[i]!) { midpoint = mix(samples[i - 1]!.point, samples[i]!.point, lengths[i] ? remaining / lengths[i]! : 0); break; }
    remaining -= lengths[i]!;
  }
  return { path, midpoint, locate(point) {
    // This runs only for visible controls. Refine the nearest cached sample
    // on its actual cubic, keeping controls on diagonal spans as well as loops.
    let best = samples[0]!, distance = Infinity;
    for (const sample of samples) {
      const value = (sample.point.x - point.x) ** 2 + (sample.point.y - point.y) ** 2;
      if (value < distance) { best = sample; distance = value; }
    }
    if (distance < 1e-12) return best.point;
    let low = Math.max(0, best.t - 1 / 16), high = Math.min(1, best.t + 1 / 16);
    const curve = curves[best.curve]!;
    const squared = (t: number) => { const p = at(curve, t); return (p.x - point.x) ** 2 + (p.y - point.y) ** 2; };
    for (let i = 0; i < 12; i++) { const a = low + (high - low) / 3, b = high - (high - low) / 3; if (squared(a) < squared(b)) high = b; else low = a; }
    return at(curve, (low + high) / 2);
  } };
}

/** Fit real diagonal cubics to an already checked route; this never searches for a route. */
export function bezierDrawing(route: Route, edge: EdgeEndpoints & { source?: string | undefined; target?: string | undefined }, strength: number, obstacles: NodeRect[], authored = false, style: WorkflowLineStyle = "filleted"): EdgeDrawing {
  // Filleted retains the existing full-distance handles. Bézier and Clutter use
  // half-distance handles; Clutter also blends routed anchor directions, keeping
  // its distinctive mix of bowed spans and sharp certified-backbone fallbacks.
  if (style === "bezier" || style === "clutter") strength /= 2;
  const points = route.points, budget = { work: 8192 }, boxes = terminalBoxes(obstacles, edge);
  const frame = { left: Math.min(...points.map(p => p.x)) - 64, right: Math.max(...points.map(p => p.x)) + 64,
    top: Math.min(...points.map(p => p.y)) - 64, bottom: Math.max(...points.map(p => p.y)) + 64 };
  const direct = cubicControls(edge, strength);
  if (!authored && clear(direct, boxes, budget)) return drawing([direct]);
  const anchors: Anchor[] = [{ ...points[0]!, direction: sides[edge.sourcePosition] }, ...points.slice(1).map((point, i) => ({ ...mix(points[i]!, point), direction: unit(points[i]!, point), corner: point })),
    { ...points.at(-1)!, direction: { x: -sides[edge.targetPosition].x, y: -sides[edge.targetPosition].y } }];
  if (style === "clutter") for (let i = 1; i < anchors.length - 1; i++) {
    const previous = anchors[i - 1]!, next = anchors[i + 1]!;
    const dx = next.x - previous.x, dy = next.y - previous.y, distance = Math.hypot(dx, dy);
    if (distance) anchors[i]!.direction = { x: dx / distance, y: dy / distance };
  }
  const curves: Cubic[] = [];
  for (let i = 0; i < anchors.length - 1;) {
    const a = anchors[i]!;
    let accepted = false;
    // Authored routes retain every steering point. Automatic paths can replace
    // a staircase with a diagonal span, with bounded clearance work per edge.
    for (let j = authored ? i + 1 : Math.min(anchors.length - 1, i + 8); j > i && !accepted; j--) {
      const b = anchors[j]!;
      const minimum = a.direction.x*b.direction.x + a.direction.y*b.direction.y === 0 ? Math.min(32, Math.hypot(b.x-a.x, b.y-a.y) / 2) : 0;
      for (const [fromScale, toScale] of [[1, 1], [1, 1.5], [1.5, 1], [1, 2], [2, 1], [0.5, 0.5]] as const) {
        const curve: Cubic = [a, towards(a, b, a.direction, strength * fromScale, minimum), towards(b, a, { x: -b.direction.x, y: -b.direction.y }, strength * toScale, minimum), b];
        if (within(curve, frame) && clear(curve, boxes, budget)) { curves.push(curve); i = j; accepted = true; break; }
      }
    }
    if (!accepted) {
      // A constrained corner or exhausted drawing budget retains the certified
      // backbone locally, instead of letting a smooth fit cut through a node.
      const b = anchors[i + 1]!, corner = a.corner ?? a;
      if (a.x !== corner.x || a.y !== corner.y) curves.push([a, a, corner, corner]);
      if (corner.x !== b.x || corner.y !== b.y) curves.push([corner, corner, b, b]);
      i++;
    }
  }
  // Coincident endpoints can collapse every checked backbone span to a point.
  if (!curves.length) curves.push([points[0]!, points[0]!, points[0]!, points[0]!]);
  return drawing(curves);
}
