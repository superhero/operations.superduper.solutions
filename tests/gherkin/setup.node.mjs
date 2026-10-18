// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { profiles } from './profiles.mjs';

const profile = profiles[process.env.OPERATIONS_TEST_PROFILE];
if (!profile) throw new Error('Select a known test profile using tests/gherkin/run.mjs.');
// Vite owns Node application imports and their coverage source maps. These
// declarations remain Gherkin registrations, not additional Vitest test cases.
const modules = import.meta.glob(['/src/**/*.test.mjs', '/.github/tests/*.test.mjs']);
for (const pattern of profile.import) {
  const match = pattern.includes('*')
    ? Object.keys(modules).filter(name => name.startsWith(`/${pattern.slice(0, pattern.indexOf('*'))}`)).sort()
    : [`/${pattern}`];
  if (!match.length) throw new Error(`No step definitions match ${pattern}`);
  for (const name of match) {
    if (!modules[name]) throw new Error(`Missing step definition module ${name}`);
    await modules[name]();
  }
}
