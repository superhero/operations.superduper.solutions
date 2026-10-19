// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
const cleanups = new Set();
let activeFeature;

export function registerDevelopmentCleanup(cleanup) {
  cleanups.add(cleanup);
  return () => cleanups.delete(cleanup);
}

export async function releaseDevelopmentResources() {
  const results = await Promise.allSettled([...cleanups].map(cleanup => Promise.resolve().then(cleanup)));
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (failures.length) throw new AggregateError(failures, 'Development resource cleanup failed');
}

/** Retain compiled graphs within a feature, without carrying them into later ones. */
export async function enterBrowserFeature(uri) {
  if (typeof uri !== 'string' || !uri) throw new Error('Browser scenarios need a feature URI.');
  if (uri === activeFeature) return false;
  if (activeFeature !== undefined) await releaseDevelopmentResources();
  activeFeature = uri;
  return true;
}
