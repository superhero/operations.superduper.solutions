// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { After, AfterAll, Before, BeforeAll, Status, World, setDefaultTimeout, setWorldConstructor } from '@cucumber/cucumber';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

setDefaultTimeout(30_000);
let browser;
let server;
let baseURL;

class BrowserWorld extends World {}
setWorldConstructor(BrowserWorld);

BeforeAll(async function () {
  const bundle = await readFile('dist/index.html');
  server = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(bundle);
    } else if (request.url === '/favicon.ico') {
      response.writeHead(204);
      response.end();
    } else {
      response.writeHead(404);
      response.end('This test server serves only the standalone application at /.');
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  baseURL = `http://127.0.0.1:${server.address().port}`;
  try {
    // Exercise native scrollbars as users see them; Chromium's headless default hides them.
    browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
  } catch (error) {
    server.close();
    throw new Error(`Cannot start Chromium with ${process.env.BROWSER_TEST_IMAGE ?? 'an unspecified image'}. Run npm run test:browser to use the matching Docker image.`, { cause: error });
  }
});

Before(async function ({ pickle }) {
  this.browser = browser;
  this.baseURL = baseURL;
  this.diagnostics = [];
  const slug = pickle.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 90);
  this.artifactDirectory = resolve('tmp/test/browser', `${slug}-${randomUUID().slice(0, 8)}`);
  this.context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light',
    reducedMotion: 'reduce', deviceScaleFactor: 1,
    serviceWorkers: 'block', acceptDownloads: true,
  });
  await this.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await this.context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(`${baseURL}/`) || url.startsWith('data:') || url.startsWith('blob:')) {
      await route.continue();
    } else {
      this.diagnostics.push({ type: 'unexpected-network-request', url, method: route.request().method() });
      await route.abort('blockedbyclient');
    }
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
  await this.page.goto(baseURL, { waitUntil: 'load' });
});

After(async function ({ pickle, result }) {
  const errors = (this.diagnostics ?? []).filter(item => item.type !== 'console-warning');
  const failed = result?.status !== Status.PASSED || errors.length > 0;
  try {
    if (failed) {
      await mkdir(this.artifactDirectory, { recursive: true });
      const diagnostics = {
        scenario: pickle.name, result: { status: result?.status, message: result?.message }, diagnostics: this.diagnostics,
        image: process.env.BROWSER_TEST_IMAGE,
        node: process.version, chromium: browser?.version(), url: this.page?.url(),
      };
      await writeFile(`${this.artifactDirectory}/diagnostics.json`, `${JSON.stringify(diagnostics, null, 2)}\n`);
      await this.attach(JSON.stringify(diagnostics, null, 2), 'application/json');
      if (this.page && !this.page.isClosed()) {
        const screenshot = await this.page.screenshot({ path: `${this.artifactDirectory}/screenshot.png`, fullPage: true, timeout: 5_000 });
        await this.attach(screenshot, 'image/png');
      }
      console.error(`Browser diagnostics for "${pickle.name}": ${this.artifactDirectory}`);
    }
  } finally {
    try {
      await this.context?.tracing.stop(failed ? { path: `${this.artifactDirectory}/trace.zip` } : {});
    } finally {
      await this.context?.close();
    }
  }
  if (errors.length > 0)
    throw new Error(`Browser errors in "${pickle.name}": ${JSON.stringify(errors)}. Diagnostics: ${this.artifactDirectory}`);
});

AfterAll(async function () {
  try {
    await browser?.close();
  } finally {
    if (server?.listening) await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  }
});
