// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Native ESM preserves functions Playwright serializes for page.evaluate().
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const compatibilityURL = new URL('./cucumber-compat.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    return specifier === '@cucumber/cucumber'
      ? { url: compatibilityURL, shortCircuit: true }
      : next(specifier, context);
  },
});

export const compatibility = await import(compatibilityURL);
const loads = new Map();
const configured = new Set();

export function configureOnce(key, callback) {
  if (configured.has(key)) return;
  configured.add(key);
  callback(compatibility);
}

export async function loadStepsNative(files, options = {}) {
  compatibility.configureCompatibility(options);
  for (const file of files) {
    const href = file instanceof URL ? file.href
      : file.startsWith('file:') ? file : pathToFileURL(resolve(file)).href;
    if (!loads.has(href)) loads.set(href, import(href));
    await loads.get(href);
  }
}
