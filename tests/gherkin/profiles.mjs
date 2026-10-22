// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readFileSync } from 'node:fs';

// Source inventory is data, independent of browser execution configuration.
const source = JSON.parse(readFileSync(new URL('../source-profile.json', import.meta.url), 'utf8'));

const acceptance = {
  import: [
    "src/build.test.mjs",
    "src/favicons.test.mjs"
  ],
  paths: [
    "src/build.feature",
    "src/favicons.feature"
  ]
};

const automation = {
  import: [
    ".github/tests/*.test.mjs"
  ],
  paths: [
    ".github/tests/*.feature"
  ]
};


const browser = {
  import: ['tests/browser/support.mjs', 'tests/browser/*.steps.mjs'],
  paths: ['tests/browser/*.feature'],
};
const components = {
  import: ['tests/components/*.steps.mjs'],
  paths: ['tests/components/*.feature'],
};
const runner = {
  import: ['tests/gherkin/runner-regressions/steps.mjs'],
  paths: ['tests/gherkin/runner-regressions/contracts.feature'],
};
export { source, acceptance, automation, browser, components, runner };
export const profiles = { source, acceptance, automation, browser, components, runner };
