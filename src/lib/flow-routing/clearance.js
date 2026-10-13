// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

// Shared obstacle faces and terminal owner exemptions for automatic and manual routes.
export const EPSILON = 1e-7;

export function rectangles(nodes, padding) {
  return nodes.map((node) => ({ id: node.id, left: node.x - padding, top: node.y - padding,
    right: node.x + node.width + padding, bottom: node.y + node.height + padding }));
}

// A tight terminal may need less clearance on the faces forming its corridor.
// Keep every other face padded instead of making the whole scene hug node bodies.
export function terminalRectangles(nodes, padding, edge) {
  const bodies = rectangles(nodes, 0), boxes = rectangles(nodes, padding);
  const axes = [['left', 'right', 'top', 'bottom', 'x'], ['top', 'bottom', 'left', 'right', 'y']];
  for (const id of [edge.source, edge.target]) {
    const owner = bodies.findIndex(box => box.id === id);
    if (owner < 0) continue;
    for (let index = 0; index < bodies.length; index++) {
      if (index === owner) continue;
      for (const [low, high, acrossLow, acrossHigh] of axes) {
        const a = bodies[owner], b = bodies[index];
        if (Math.min(a[acrossHigh], b[acrossHigh]) <= Math.max(a[acrossLow], b[acrossLow])) continue;
        const [first, second] = a[high] <= b[low] ? [owner, index] : [index, owner];
        if (bodies[first][high] > bodies[second][low]) continue;
        const middle = (bodies[first][high] + bodies[second][low]) / 2;
        boxes[first][high] = Math.min(boxes[first][high], middle);
        boxes[second][low] = Math.max(boxes[second][low], middle);
      }
    }
  }
  for (const [point, owner] of [[{ x: edge.sourceX, y: edge.sourceY }, edge.source],
    [{ x: edge.targetX, y: edge.targetY }, edge.target]]) {
    for (let index = 0; index < boxes.length; index++) {
      const box = boxes[index], body = bodies[index];
      if (body.id === owner || point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) continue;
      // Handles and free-pointer tips can themselves lie inside another node's
      // preferred buffer. Reserve half the available terminal gap on that face.
      for (const [low, high, , , axis] of axes) {
        if (point[axis] <= body[low]) box[low] = Math.max(box[low], (point[axis] + body[low]) / 2);
        else if (point[axis] >= body[high]) box[high] = Math.min(box[high], (point[axis] + body[high]) / 2);
      }
    }
  }
  return boxes;
}

export function intersects(a, b, box) {
  if (Math.abs(a.x - b.x) < EPSILON) return a.x > box.left + EPSILON && a.x < box.right - EPSILON &&
    Math.max(a.y, b.y) > box.top + EPSILON && Math.min(a.y, b.y) < box.bottom - EPSILON;
  return a.y > box.top + EPSILON && a.y < box.bottom - EPSILON &&
    Math.max(a.x, b.x) > box.left + EPSILON && Math.min(a.x, b.x) < box.right - EPSILON;
}

export function clearRoute(points, boxes, edge, budget) {
  for (let i = 1; i < points.length; i++) for (const box of boxes) {
    if (--budget.work < 0) return false;
    if (i === 1 && box.id === edge.source || i === points.length - 1 && box.id === edge.target) continue;
    if (intersects(points[i - 1], points[i], box)) return false;
  }
  return true;
}
