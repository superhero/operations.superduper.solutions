// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.

import { cachedPreview, projectRoute } from './path.js';

/** Carry the displayed snap projection into its committed edge while routing is pending. */
export function releasedPreview(cache, lastPreview, session, edge) {
  const cached = cachedPreview(cache, lastPreview, session);
  if (!cached || !lastPreview.target) return null;
  const forward = lastPreview.source === edge.source && lastPreview.target === edge.target;
  const reverse = !forward && lastPreview.source === edge.target && lastPreview.target === edge.source;
  if (!forward && !reverse) return null;
  const committed = reverse ? {
    sourceX: lastPreview.targetX, sourceY: lastPreview.targetY, sourcePosition: lastPreview.targetPosition,
    targetX: lastPreview.sourceX, targetY: lastPreview.sourceY, targetPosition: lastPreview.sourcePosition,
  } : lastPreview;
  if (['sourceX', 'sourceY', 'targetX', 'targetY', 'sourcePosition', 'targetPosition']
    .some(key => committed[key] !== edge[key])) return null;
  const projected = projectRoute(cached, lastPreview);
  if (!projected) return null;
  return reverse ? { ...projected, points: [...projected.points].reverse() } : projected;
}
