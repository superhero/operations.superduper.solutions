// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadStepsNative } from './native-steps.mjs';

const directory = resolve('tests/browser');
const steps = (await readdir(directory)).filter(name => name.endsWith('.steps.mjs')).sort();
await loadStepsNative([
  resolve('tests/gherkin/browser-abort-guard.mjs'),
  resolve(directory, 'support.mjs'),
  ...steps.map(name => resolve(directory, name)),
]);
