// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { After, AfterAll, Before, BeforeAll, Status, World, setDefaultTimeout, setWorldConstructor } from '@cucumber/cucumber';
import { chromium, firefox, webkit } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createExampleEndpoint } from './example-endpoint.fixture.mjs';
import { pail } from '@visulima/pail';
import { createVaultEndpoint } from './vault-endpoint.fixture.mjs';
import { toolbarButtonNames } from '../../src/lib/toolbar-settings.ts';
import { enterBrowserFeature, releaseDevelopmentResources } from './development-resources.fixture.mjs';
import { exampleCatalogState } from "./catalog-state.fixture.mjs";
import { appSettingsDatabaseName } from '../../src/lib/storage-names.ts';
import { browserAbortCapture, finishBrowserContext } from '../gherkin/browser-abort-guard.mjs';

setDefaultTimeout(30_000);
let browser;
let server;
let baseURL;

// These scenarios exercise standalone fixtures, not application startup.
// Keep UI and startup scenarios on the built application by default.
const fixturePages = new Map([
  ['@error-history-storage', '/error-history-fixture.html'],
  ['@error-history-recorder', '/error-history-fixture.html'],
  // Coverage steps prepare their own HTTP/file report before navigating.
  ['@coverage-report', 'about:blank'],
  ['@legacy-smoke', 'about:blank'],
  ['@browser-abort-diagnostics', 'about:blank'],
  ['@vault-browser-storage', '/vault-fixture.html'],
  ['@vault-browser-network', '/vault-fixture.html'],
  ['@vault-browser-policy', '/vault-fixture.html'],
  ['@vault-browser-kdf', '/vault-kdf-fixture.html'],
  ['@schema-lifecycle', '/vault-fixture.html'],
]);

class BrowserWorld extends World {}
setWorldConstructor(BrowserWorld);

BeforeAll(async function () {
  const bundle = await readFile('dist/index.html');
  const iconTypes = {
    "favicon.svg": "image/svg+xml", "favicon.ico": "image/x-icon", "favicon.png": "image/png",
    "favicon.bmp": "image/bmp", "favicon.gif": "image/gif", "favicon.jpg": "image/jpeg",
    "favicon.ppm": "image/x-portable-pixmap", "favicon.tiff": "image/tiff", "apple-touch-icon.png": "image/png",
  };
  const icons = new Map(await Promise.all(Object.entries(iconTypes).map(async ([filename, type]) =>
    [`/${filename}`, { type, bytes: await readFile(`dist/${filename}`) }])));
  if (typeof this.parameters.fixtureBundlesFile !== 'string')
    throw new Error('Start browser scenarios with npm run test:browser or node tests/browser/run.mjs.');
  const { repositoryFixture, errorHistoryFixture, vaultFixture, policyFixture, kdfFixture, schemaFixture } =
    JSON.parse(await readFile(this.parameters.fixtureBundlesFile, 'utf8'));
  const vaultEndpoint = createVaultEndpoint();
  server = createServer((request, response) => {
    if (vaultEndpoint(request, response)) return;
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8',
        'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' });
      response.end(bundle);
    } else if (request.url === '/workflow-repository-fixture.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(repositoryFixture);
    } else if (request.url === '/error-history-storage-fixture.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(errorHistoryFixture);
    } else if (request.url === '/error-history-fixture.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Error history persistence fixture</title>');
    } else if (request.url === '/vault-storage-fixture.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(vaultFixture);
    } else if (request.url === '/vault-policy-fixture.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(policyFixture);
    } else if (request.url === '/schema-lifecycle-fixture.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(schemaFixture);
    } else if (request.url === '/vault-kdf-fixture.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(kdfFixture);
    } else if (request.url === '/vault-kdf-fixture.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self'" });
      response.end('<!doctype html><title>Vault KDF worker qualification</title>');
    } else if (request.url === '/vault-fixture.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Vault persistence and execution fixture</title>');
    } else if (icons.has(request.url)) {
      const icon = icons.get(request.url);
      response.writeHead(200, { 'content-type': icon.type });
      response.end(icon.bytes);
    } else {
      response.writeHead(404);
      response.end('This test server serves only the standalone application, its favicon files and test fixtures.');
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  baseURL = `http://127.0.0.1:${server.address().port}`;
  try {
    const name = process.env.BROWSER_ENGINE ?? 'chromium';
    const engine = { chromium, firefox, webkit }[name];
    if (!engine) throw new Error(`Unsupported BROWSER_ENGINE: ${name}`);
    // Exercise native scrollbars as users see them; Chromium's headless default hides them.
    browser = await engine.launch(name === 'chromium' ? { ignoreDefaultArgs: ['--hide-scrollbars'] } : {});
  } catch (error) {
    server.close();
    throw new Error(`Cannot start ${process.env.BROWSER_ENGINE ?? 'chromium'} with ${process.env.BROWSER_TEST_IMAGE ?? 'an unspecified image'}. Run npm run test:browser to use the matching Docker image.`, { cause: error });
  }
});

Before(async function ({ pickle }) {
  const uri = this.info.gherkin.uri;
  await enterBrowserFeature(uri);
  this.browser = browser;
  this.baseURL = baseURL;
  this.diagnostics = [];
  // Capture the running browser, including successful runs and parallel workers.
  await this.attach(JSON.stringify({ name: browser.browserType().name(), version: browser.version(),
    fixtureBundlesFile: this.parameters.fixtureBundlesFile, processId: process.pid, workerId: process.env.VITEST_POOL_ID ?? '0' }),
    'application/vnd.operations.browser+json');
  const slug = pickle.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 90);
  this.artifactDirectory = resolve('tmp/test/browser', `${slug}-${randomUUID().slice(0, 8)}`);
  // Interaction scenarios explicitly save visible controls; untagged scenarios
  // exercise the application's real fresh-profile defaults.
  const toolbarControls = pickle.tags.some(tag => tag.name === '@toolbar-controls');
  const indexedDB = [];
  if (toolbarControls) indexedDB.push({ name: appSettingsDatabaseName, version: 1, stores: [{ name: 'settings', autoIncrement: false,
    indexes: [], records: [{ key: 'toolbarButtons', value: Object.fromEntries(toolbarButtonNames.map(key => [key, true])) }] }] });
  // Most scenarios explicitly isolate the two example catalogs. Dedicated service
  // scenarios exercise the complete production defaults, including their migration.
  const completeServices = pickle.tags.some(tag => tag.name === '@service-defaults');
  const storageState = completeServices
    ? { cookies: [], origins: [{ origin: baseURL, localStorage: [], indexedDB }] }
    : exampleCatalogState(baseURL, indexedDB);
  this.context = await browser.newContext({ storageState,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light',
    reducedMotion: 'reduce', deviceScaleFactor: 1,
    serviceWorkers: 'block', acceptDownloads: true,
  });
  if (pickle.tags.some(tag => tag.name === '@immediate-page-memory')) {
    // Storage inspection exercises real IndexedDB/Git/Storage APIs, not the
    // browser's GC schedule. The untagged native scenario keeps that boundary.
    await this.context.addInitScript(() => {
      Object.defineProperty(performance, 'measureUserAgentSpecificMemory', {
        configurable: true,
        value: async () => ({ bytes: 4096, breakdown: [{ bytes: 4096, types: ['JavaScript'] }] }),
      });
    });
  }
  // Explicit profiling runs avoid Playwright's DOM snapshots. Ordinary tests
  // retain their complete failure traces; routing/network isolation is unchanged.
  const minimalProfile = process.env.SCHEMA_PROFILE_LOW_OVERHEAD === '1'
    && pickle.tags.some(tag => tag.name === '@schema-profile');
  await this.context.tracing.start({ screenshots: !minimalProfile, snapshots: !minimalProfile, sources: !minimalProfile });
  await this.context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(`${baseURL}/`) || url.startsWith('data:') || url.startsWith('blob:')) {
      await route.continue();
    } else {
      this.diagnostics.push({ type: 'unexpected-network-request', url, method: route.request().method() });
      await route.abort('blockedbyclient');
    }
  });
  // Fulfilled HTTP requests keep integration tests isolated while exercising the actual fetch path.
  this.exampleRequests = [];
  const exampleEndpoint = createExampleEndpoint();
  await this.context.route('https://example.com/**', async route => {
    this.exampleRequests.push({ method: route.request().method(), url: route.request().url(), body: route.request().postData() });
    await exampleEndpoint(route);
  });
  this.page = await this.context.newPage();
  this.page.setDefaultTimeout(10_000);
  this.page.setDefaultNavigationTimeout(10_000);
  this.page.on('pageerror', error => this.diagnostics.push({ type: 'pageerror', message: error.message, stack: error.stack }));
  this.page.on('console', message => {
    if (['error', 'warning'].includes(message.type()))
      this.diagnostics.push({ type: `console-${message.type()}`, message: message.text(), location: message.location() });
  });
  this.page.on('response', response => {
    if (response.status() >= 400)
      this.diagnostics.push({ type: 'http-error', url: response.url(), status: response.status() });
  });
  const fixturePage = pickle.tags.map(tag => fixturePages.get(tag.name)).find(Boolean);
  await this.page.goto(fixturePage ? new URL(fixturePage, baseURL).href : baseURL, { waitUntil: 'load' });
  if (fixturePage) return;
  // Module loading precedes the worker-backed startup; filling an inert input
  // does not enter text even though Playwright sees its rendered textarea.
  await this.page.waitForFunction(() => {
    const app = document.getElementById('app');
    return app?.hasChildNodes() && !app.hasAttribute('inert');
  }, undefined, completeServices ? { timeout: 90_000 } : {});
  if (!pickle.tags.some(tag => tag.name === '@startup-modules')) {
    // Real startup has completed, including canvas restoration. These scenarios
    // exercise the ready app, not the loader's delayed presentation. Finish only
    // its animation; keep the real removal callback and gutter cleanup intact.
    await this.page.locator('#startup-status').evaluateAll(loaders => {
      for (const loader of loaders) for (const animation of loader.getAnimations()) animation.finish();
    });
  }
  await this.page.locator('#startup-status').waitFor({ state: 'detached' });
});

After(async function ({ pickle, result }) {
  const aborted = await browserAbortCapture(this, this.context);
  const errors = (this.diagnostics ?? []).filter(item => item.type !== 'console-warning');
  const failed = result?.status !== Status.PASSED || errors.length > 0;
  try {
    if (failed) {
      await mkdir(this.artifactDirectory, { recursive: true });
      const diagnostics = {
        scenario: pickle.name, result: { status: result?.status, message: result?.message }, diagnostics: this.diagnostics,
        image: process.env.BROWSER_TEST_IMAGE,
        node: process.version, browser: browser ? { name: browser.browserType().name(), version: browser.version() } : undefined, url: this.page?.url(),
      };
      await writeFile(`${this.artifactDirectory}/diagnostics.json`, `${JSON.stringify(diagnostics, null, 2)}\n`);
      await this.attach(JSON.stringify(diagnostics, null, 2), 'application/json');
      if (aborted?.screenshotSaved) {
        await this.attach(await readFile(aborted.screenshotPath), 'image/png');
      } else if (!aborted?.closed && this.page && !this.page.isClosed()) {
        const screenshot = await this.page.screenshot({ path: `${this.artifactDirectory}/screenshot.png`, fullPage: true, timeout: 5_000 });
        await this.attach(screenshot, 'image/png');
      }
      pail.force.error(`Browser diagnostics for "${pickle.name}": ${this.artifactDirectory}`);
    }
  } finally {
    await finishBrowserContext(this, this.context, failed ? { path: `${this.artifactDirectory}/trace.zip` } : {});
  }
  if (errors.length > 0)
    throw new Error(`Browser errors in "${pickle.name}": ${JSON.stringify(errors)}. Diagnostics: ${this.artifactDirectory}`);
});

AfterAll(async function () {
  try {
    try { await releaseDevelopmentResources(); }
    finally { await browser?.close(); }
  } finally {
    if (server?.listening) await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  }
});
