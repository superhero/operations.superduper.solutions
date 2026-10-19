// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
const completeLibrary = 'tests/browser/service-defaults.feature';

export const browserProjectNameForFeature = (identity, feature) =>
  `${identity}-${feature === completeLibrary ? 'service-library' : 'application'}`;

/** Keep the full provider library out of concurrent application-test workloads. */
export function browserProjects(features, identity, workers) {
  if (!features.includes(completeLibrary)) return undefined;
  const application = features.filter(file => file !== completeLibrary);
  return [
    { test: { name: browserProjectNameForFeature(identity, completeLibrary), include: [completeLibrary],
      maxWorkers: 1, fileParallelism: false, sequence: { groupOrder: 0 } } },
    ...(application.length ? [{ test: { name: browserProjectNameForFeature(identity, application[0]), include: application,
      maxWorkers: workers, sequence: { groupOrder: 1 } } }] : []),
  ];
}
