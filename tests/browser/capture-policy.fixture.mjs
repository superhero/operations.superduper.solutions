// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
const fullTraceTags = new Set(['@full-trace', '@browser-abort-diagnostics', '@coverage-report', '@schema-profile']);

export function captureForTags(tags, requested = 'full') {
  return requested !== 'minimal' || tags.some(tag => fullTraceTags.has(tag)) ? 'full' : 'minimal';
}

export function tracingOptions(tags, environment = process.env) {
  const profiling = environment.SCHEMA_PROFILE_LOW_OVERHEAD === '1' && tags.includes('@schema-profile');
  const full = !profiling && captureForTags(tags, environment.OPERATIONS_CI_CAPTURE) === 'full';
  return { screenshots: full, snapshots: full, sources: full };
}
