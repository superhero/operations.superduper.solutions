// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadStepsNative } from './native-steps.mjs';

const directory = resolve('tests/browser');
const context = process.env.OPERATIONS_CI_CONTEXT
  ? JSON.parse(await readFile(process.env.OPERATIONS_CI_CONTEXT, 'utf8')) : undefined;
const steps = context ? context.modules.filter(file => !['tests/gherkin/browser-abort-guard.mjs', 'tests/browser/support.mjs'].includes(file))
  : (await readdir(directory)).filter(name => name.endsWith('.steps.mjs')).sort().map(name => `tests/browser/${name}`);
if (context && steps.some(file => typeof file !== 'string' || !file.startsWith('tests/') || file.split('/').includes('..')))
  throw new Error('Invalid scoped browser module.');
await loadStepsNative([
  resolve('tests/gherkin/browser-abort-guard.mjs'),
  resolve(directory, 'support.mjs'),
  ...steps.map(name => resolve(name)),
]);
if (context) {
  const { collectBindings } = await import('./ci-discover.mjs');
  await collectBindings([context.feature], { scoped: true });
}
