// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Before, After } from './cucumber-compat.mjs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Loaded natively once per worker, before the original application support.
Before({ name: 'Browser abort ownership' }, function () {
  const signal = this.signal;
  if (!signal) throw new Error('The Gherkin runner must expose World.signal');
  const closeCurrentContexts = () => {
    const contexts = new Set([this.context, this.startup?.context].filter(
      (context) => context && typeof context.close === 'function'));
    for (const context of contexts) void context.close().catch(() => {});
  };
  this.browserAbortCleanup = () => signal.removeEventListener('abort', closeCurrentContexts);
  signal.addEventListener('abort', closeCurrentContexts, { once: true });
  if (signal.aborted) closeCurrentContexts();
});
After({ name: 'Browser abort listener cleanup' }, async function () {
  this.browserAbortCleanup?.();
  if (this.artifactDirectory && this._quickpickleContext) {
    for (const [filename, label] of [['trace.zip', 'Browser trace'], ['startup-trace.zip', 'Development trace']]) {
      const path = resolve(this.artifactDirectory, filename);
      if (existsSync(path)) {
        await this._quickpickleContext.annotate(label, { path, contentType: 'application/zip' });
      }
    }
  }

});
