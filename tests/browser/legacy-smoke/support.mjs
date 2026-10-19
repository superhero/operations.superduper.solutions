// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { registerDevelopmentCleanup } from '../development-resources.fixture.mjs';

const servers = new Map();

// Main-app and storage-module journeys share one development graph per worker.
// Overlay source-link checks use their isolated root so original stack paths stay meaningful.
export async function createFixtureServer(options) {
  const root = options.root && resolve(options.root) !== resolve('src') ? resolve(options.root) : resolve('src');
  let entry = servers.get(root);
  if (!entry) {
    entry = { plugins: [], server: null };
    servers.set(root, entry);
    entry.ready = (async () => {
      const define = { 'process.env.NODE_ENV': '"development"' };
      const previous = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'development';
        entry.server = await createServer({
          configFile: resolve('vite.config.mjs'), configLoader: 'native', root,
          mode: 'development', define,
          resolve: options.resolve,
          optimizeDeps: { include: ['@isomorphic-git/lightning-fs', 'isomorphic-git', 'buffer', 'idb', 'yaml'],
            rolldownOptions: { transform: { define } } },
          cacheDir: resolve('tmp/test/browser', `legacy-vite-${randomUUID()}`),
          logLevel: 'error',
          server: { host: '127.0.0.1', port: 0, strictPort: false, open: false },
          plugins: [{ name: 'legacy-gherkin-fixtures',
            async resolveId(id) {
              for (const plugin of entry.plugins) {
                const result = await plugin.resolveId?.(id);
                if (result != null) return result;
              }
            },
            async load(id) {
              for (const plugin of entry.plugins) {
                const result = await plugin.load?.(id);
                if (result != null) return result;
              }
            },
          }],
        });
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
      await entry.server.listen();
    })();
  }
  for (const plugin of options.plugins ?? []) if (!entry.plugins.some(value => value.name === plugin.name)) entry.plugins.push(plugin);
  await entry.ready;
  return new Proxy(entry.server, { get(server, property) {
    if (property === 'listen') return async () => {};
    if (property === 'close') return async () => {
      // The copied overlay root is used by one journey; release its module graph
      // immediately rather than keeping a second application compiled all run.
      if (root === resolve('src') || servers.get(root) !== entry) return;
      servers.delete(root);
      await server.close();
    };
    const value = Reflect.get(server, property);
    return typeof value === 'function' ? value.bind(server) : value;
  } });
}

export async function closeFixtureServers() {
  const entries = [...servers.values()]; servers.clear();
  const results = await Promise.allSettled(entries.map(async entry => {
    try { await entry.ready; } finally { await entry.server?.close(); }
  }));
  const errors = results.filter(value => value.status === 'rejected').map(value => value.reason);
  if (errors.length) throw new AggregateError(errors, 'Development fixture server cleanup failed');
}

registerDevelopmentCleanup(closeFixtureServers);

export function ownedBrowser(world) {
  const contexts = world.legacyContexts ??= new Set();
  const traces = world.legacyTraces ??= [];
  return {
    async newContext(options = {}) {
      const context = await world.browser.newContext({ serviceWorkers: 'block', ...options });
      contexts.add(context);
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const close = context.close.bind(context);
      let closing;
      context.close = () => closing ??= (async () => {
        await mkdir(world.artifactDirectory, { recursive: true });
        const path = resolve(world.artifactDirectory, `legacy-trace-${traces.length}.zip`);
        traces.push(path);
        try { await context.tracing.stop({ path }); }
        finally { try { await close(); } finally { contexts.delete(context); } }
      })();
      return context;
    },
    async close() {
      const results = await Promise.allSettled([...contexts].map(context => context.close()));
      const errors = results.filter(value => value.status === 'rejected').map(value => value.reason);
      if (errors.length) throw new AggregateError(errors, 'Development fixture context cleanup failed');
    },
  };
}

export async function waitForApplicationReady(page) {
  // Network idle does not include the worker-backed application startup.
  // Keep cold module loading separate from each journey's UI assertions.
  await page.waitForFunction(() => {
    const app = document.getElementById('app');
    return app?.hasChildNodes() && !app.hasAttribute('inert') && !app.hasAttribute('aria-busy');
  }, undefined, { timeout: 60_000 });
}

export async function openSettings(page) {
  const button = page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
}
export async function closeSettings(page) {
  const button = page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true });
  if (await button.getAttribute('aria-pressed') === 'true') await button.click();
}
