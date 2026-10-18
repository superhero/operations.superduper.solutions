// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { Before, After } from './cucumber-compat.mjs';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Capture is best effort, but closing the owned contexts remains mandatory.
// Keep the capture phase shorter than the runner's pending-work drain window.
export function installBrowserAbortGuard(world, { captureBudget = 750 } = {}) {
  const signal = world.signal;
  if (!signal) throw new Error('The Gherkin runner must expose World.signal');
  if (!Number.isSafeInteger(captureBudget) || captureBudget < 1)
    throw new TypeError('Browser abort capture budget must be positive milliseconds');
  const budget = Math.min(captureBudget, 750, Math.max(1, Math.floor((world.config?.stepAbortGrace ?? 2000) / 2)));
  world.browserAbortCaptures = new Map();
  const closeCurrentContexts = () => {
    if (world.browserAbortWork) return;
    const targets = [
      { context: world.context, page: world.page, trace: 'trace.zip', screenshot: 'screenshot.png' },
      { context: world.startup?.context, page: world.startup?.page, trace: 'startup-trace.zip', screenshot: 'startup.png' },
    ].filter(target => target.context && typeof target.context.close === 'function');
    const unique = [...new Map(targets.map(target => [target.context, target])).values()];
    const records = unique.map(target => {
      const record = { ...target, closed: false, traceSaved: false, screenshotSaved: false, issues: [] };
      world.browserAbortCaptures.set(target.context, record);
      return record;
    });
    const work = (async () => {
      let timer, expired = false;
      const capture = async record => {
        if (!world.artifactDirectory) { record.issues.push('No artifact directory was available.'); return; }
        await mkdir(world.artifactDirectory, { recursive: true });
        if (expired) return;
        record.tracePath = resolve(world.artifactDirectory, record.trace);
        record.screenshotPath = resolve(world.artifactDirectory, record.screenshot);
        const save = async (kind, callback) => {
          try { await callback(); if (!expired) record[`${kind}Saved`] = true; }
          catch (error) { if (!expired) record.issues.push(`${kind}: ${error.message}`); }
        };
        await Promise.all([
          save('trace', () => record.context.tracing.stop({ path: record.tracePath })),
          ...(record.page && !record.page.isClosed() ? [save('screenshot', () => record.page.screenshot({
            path: record.screenshotPath, fullPage: true, timeout: budget,
          }))] : []),
        ]);
      };
      try {
        await Promise.race([
          Promise.all(records.map(record => capture(record).catch(error => {
            if (!expired) record.issues.push(error.message);
          }))),
          new Promise(done => { timer = setTimeout(() => {
            expired = true;
            for (const record of records) if (!record.traceSaved || record.page && !record.screenshotSaved)
              record.issues.push(`Abort diagnostics exceeded ${budget}ms; closing the context.`);
            done();
          }, budget); }),
        ]);
      } finally {
        expired = true;
        clearTimeout(timer);
        await Promise.all(records.map(async record => {
          try { await record.context.close(); record.closed = true; }
          catch (error) { record.closeError = error; }
        }));
      }
    })();
    world.browserAbortWork = work;
    const pending = world._quickpicklePendingWork ??= new Set();
    pending.add(work);
    work.then(() => pending.delete(work), () => pending.delete(work));
    work.catch(() => {});
  };
  world.browserAbortCleanup = () => signal.removeEventListener('abort', closeCurrentContexts);
  signal.addEventListener('abort', closeCurrentContexts, { once: true });
  if (signal.aborted) closeCurrentContexts();
}

export async function browserAbortCapture(world, context) {
  await world.browserAbortWork;
  return world.browserAbortCaptures?.get(context);
}

export async function finishBrowserContext(world, context, traceOptions = {}) {
  const aborted = await browserAbortCapture(world, context);
  if (aborted?.closed) return;
  try { await context?.tracing.stop(traceOptions); }
  finally { await context?.close(); }
}

// Loaded natively once per worker, before the original application support.
Before({ name: 'Browser abort ownership' }, function () {
  installBrowserAbortGuard(this);
});
After({ name: 'Browser abort listener cleanup' }, async function () {
  this.browserAbortCleanup?.();
  await this.browserAbortWork;
  if (this.artifactDirectory && this._quickpickleContext) {
    const captures = [...(this.browserAbortCaptures?.values() ?? [])];
    const issues = captures.flatMap(record => record.issues.map(message => ({ trace: record.trace, message })));
    if (issues.length) await this.attach(JSON.stringify({ abortDiagnostics: issues }), 'application/json');
    for (const [filename, label] of [['trace.zip', 'Browser trace'], ['startup-trace.zip', 'Development trace']]) {
      const path = resolve(this.artifactDirectory, filename);
      const aborted = captures.find(record => record.trace === filename);
      if (existsSync(path) && (!aborted || aborted.traceSaved)) {
        await this._quickpickleContext.annotate(label, { path, contentType: 'application/zip' });
      }
    }
  }
  const closeErrors = [...(this.browserAbortCaptures?.values() ?? [])].flatMap(record => record.closeError ?? []);
  if (closeErrors.length) throw new AggregateError(closeErrors, 'Browser abort context cleanup failed');
});
