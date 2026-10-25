// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
const completeLibrary = new Set([
  'tests/browser/capability-diagnostics.feature',
  'tests/browser/service-defaults.feature',
  'tests/browser/catalog-hierarchy.feature',
  'tests/browser/docker-native.feature',
  'tests/browser/native-agent.feature',
  'tests/browser/native-runtime.feature',
  'tests/browser/schema-history.feature',
  'tests/browser/operation-versions.feature',
]);

export const browserProjectNameForFeature = (identity, feature) =>
  `${identity}-${completeLibrary.has(feature) ? 'service-library' : 'application'}`;

/** Keep the full provider library out of concurrent application-test workloads. */
export function browserProjects(features, identity, workers) {
  const library = features.filter(file => completeLibrary.has(file));
  if (!library.length) return undefined;
  const application = features.filter(file => !completeLibrary.has(file));
  return [
    { test: { name: browserProjectNameForFeature(identity, library[0]), include: library,
      maxWorkers: 1, fileParallelism: false, sequence: { groupOrder: 0 } } },
    ...(application.length ? [{ test: { name: browserProjectNameForFeature(identity, application[0]), include: application,
      maxWorkers: workers, sequence: { groupOrder: 1 } } }] : []),
  ];
}
