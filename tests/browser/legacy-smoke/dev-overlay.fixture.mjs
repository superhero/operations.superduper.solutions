// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { createFixtureServer, ownedBrowser, openSettings } from './support.mjs';
import { expectThemeColors } from '../theme-colors.mjs';

// Assertions are advanced by the named steps in legacy-smoke.feature.
export async function* journey(world, variant) {

const artifactDirectory = world.artifactDirectory;
await mkdir(artifactDirectory, { recursive: true });
// Keep error fixtures inside an isolated Vite root, just like real app modules.
// Visulima's external /@fs stack resolver otherwise duplicates the source root.
const applicationRoot = resolve(artifactDirectory, 'app');
await rm(applicationRoot, { recursive: true, force: true });
await cp(resolve('src'), applicationRoot, { recursive: true });
const fixturePath = resolve(applicationRoot, 'tests/fixtures/dev-errors.ts');
await mkdir(resolve(applicationRoot, 'tests/fixtures'), { recursive: true });
await writeFile(fixturePath, (await readFile('tests/fixtures/dev-errors.ts', 'utf8'))
  .replace('../../src/lib/logger.ts', '$lib/logger.ts'));
const server = await createFixtureServer({
  configFile: resolve('vite.config.mjs'),
  configLoader: 'native',
  root: applicationRoot,
  resolve: { alias: { $lib: resolve(applicationRoot, 'lib') } },
  cacheDir: resolve(artifactDirectory, '.vite'),
  server: { host: '127.0.0.1', port: 0, strictPort: true, open: false },
});
let browser;
let page;
const diagnostics = [];
const samples = [];
const errorMessage = 'Test-only runtime error — saved workflows and settings are unchanged.';
const loggedErrorMessage = 'Test-only Pail error — saved workflows and settings are unchanged.';
const fixtureURL = '/tests/fixtures/dev-errors.ts';
const transportFailureMessage = 'Test overlay transport unavailable.';
const isFixtureError = message => [errorMessage, loggedErrorMessage].some(expected => message.includes(expected));
let succeeded = false;
let transportFailure;
let failureState;

function trackErrors(page) {
  page.on('pageerror', error => {
    if (!isFixtureError(error.message)) diagnostics.push({ type: 'pageerror', message: error.message });
  });
  page.on('console', message => {
    if (message.type() === 'error' && !isFixtureError(message.text()))
      diagnostics.push({ type: 'console-error', message: message.text() });
  });
}

async function injectTestError(page, method = 'throwRuntimeError') {
  await page.evaluate(async ({ fixtureURL, method }) => (await import(fixtureURL))[method](), { fixtureURL, method });
}

async function developerToolbarSetting(page) {
  await openSettings(page);
  const settings = page.getByRole('region', { name: 'Settings workspace', exact: true });
  const disclosure = settings.locator('summary[aria-label="Developer"]');
  if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click();
  return settings.getByRole('switch', { name: 'Developer toolbar', exact: true });
}

function inspectCodeColors(pre) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = color => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const root = getComputedStyle(document.documentElement);
  const palette = Array.from({ length: 6 }, (_, index) => rgba(root.getPropertyValue(`--tone-${index + 1}`).trim()));
  const background = rgba(getComputedStyle(pre).backgroundColor);
  const spans = [...pre.querySelectorAll('span')];
  const opaqueSpans = [];
  const tokens = [];
  for (const span of spans) {
    const style = getComputedStyle(span);
    if (rgba(style.backgroundColor)[3] !== 0)
      opaqueSpans.push({ text: span.textContent.slice(0, 80), background: style.backgroundColor });
    if (![...span.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue;
    tokens.push({ text: span.textContent.trim(), color: rgba(style.color), sourceStyle: span.getAttribute('style') });
  }
  const syntax = Object.fromEntries(Object.entries({ keyword: 'throw', function: 'setTimeout',
    string: '"Test-only runtime error', number: '600' }).map(([role, text]) =>
    [role, tokens.find(token => token.text.includes(text))]));
  const outsidePalette = tokens.filter(token => !palette.some(color => color.every((value, index) => value === token.color[index])));
  return { spanCount: spans.length, background, palette, opaqueSpans, outsidePalette, syntax };

}

try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address === 'object');
  const baseURL = `http://127.0.0.1:${address.port}`;
  browser = ownedBrowser(world);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', colorScheme: 'dark' });
  // The overlay has its own saved mode; exercise it even with a light app theme.
  await context.addInitScript(() => localStorage.setItem('__v-o__theme', 'dark'));
  const confineRequest = async route => {
    const url = route.request().url();
    if (url.startsWith(`${baseURL}/`) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    diagnostics.push({ type: 'unexpected-network', url });
    return route.abort();
  };
  await context.route('**/*', confineRequest);
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  trackErrors(page);
  await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60_000 });
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
  const overlay = page.getByRole('dialog', { name: 'Runtime Error Overlay', exact: true });
  await expect(overlay).toHaveCount(0);
  const toolbar = page.locator('dev-toolbar');
  const toolbarToggle = toolbar.getByRole('button', { name: 'Toggle devtools panel', exact: true });
  await expect(toolbar).toBeHidden();
  const developerToolbar = await developerToolbarSetting(page);
  await expect(developerToolbar).toHaveAttribute('aria-checked', 'false');
  await developerToolbar.click();
  await expect(developerToolbar).toHaveAttribute('aria-checked', 'true');
  await expect(toolbarToggle).toBeVisible();
  await expect(toolbarToggle).toBeInViewport();
  await toolbarToggle.click();
  const firstToolbarPanel = toolbar.getByRole('dialog', { name: 'DevTools panel', exact: true });
  await expect(firstToolbarPanel).toBeVisible();
  await firstToolbarPanel.getByRole('button', { name: 'Close DevTools panel', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { loadSettings } = await import('/lib/app-settings.ts');
    return (await loadSettings(['default', 'sunset', 'alpine'])).developerToolbar;
  })).toBe(true);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(toolbarToggle).toBeVisible();
  const restoredDeveloperToolbar = await developerToolbarSetting(page);
  await expect(restoredDeveloperToolbar).toHaveAttribute('aria-checked', 'true');
  await restoredDeveloperToolbar.click();
  await expect(restoredDeveloperToolbar).toHaveAttribute('aria-checked', 'false');
  await expect(toolbar).toBeHidden();
  await page.keyboard.press('Alt+Shift+D');
  await expect(toolbar).toBeHidden();
  await expect(toolbar).toHaveCSS('opacity', '0');
  await expect(toolbar).toHaveAttribute('inert', '');
  await toolbarToggle.evaluate(button => button.focus());
  await expect(toolbarToggle).not.toBeFocused();
  assert.equal(await toolbarToggle.evaluate(button => {
    const bounds = button.getBoundingClientRect();
    return document.elementFromPoint(bounds.x + bounds.width / 2, Math.min(innerHeight - 1, bounds.y + bounds.height / 2)) === button.getRootNode().host;
  }), false, 'The disabled toolbar must not receive pointer hits.');
  await restoredDeveloperToolbar.click();
  await expect(restoredDeveloperToolbar).toHaveAttribute('aria-checked', 'true');
  await expect(toolbarToggle).toBeVisible();
  await expect(toolbar.getByRole('button', { name: 'Preview error', exact: true })).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.__VISULIMA_DEVTOOLS__.getApps()
    .some(app => app.id === 'operations:error-preview')), false, 'The application must not register deliberate error demos.');
  await toolbarToggle.hover();
  await toolbar.locator('button[data-app-id="dev-toolbar:vite-config"]').click();
  const toolbarPanel = toolbar.getByRole('dialog', { name: 'DevTools panel', exact: true });
  await expect(toolbarPanel).toBeVisible();
  await expect(toolbarPanel).toContainText('Vite Config');
  await toolbarPanel.getByRole('button', { name: 'Close DevTools panel', exact: true }).click();
  await expect(toolbarPanel).toBeHidden();

yield "developer toolbar settings persist and disabled tools cannot receive pointer or keyboard input";
  // Exercise startup hydration from IndexedDB, independently of later live changes.
  await page.evaluate(async () => {
    const { saveSetting } = await import('/lib/app-settings.ts');
    await saveSetting('theme', 'dark');
    await saveSetting('palette', 'sunset');
  });
  await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60_000 });
  await expect(page.locator('#startup-status')).toHaveCount(0);
  await injectTestError(page);
  await expect(overlay).toBeVisible({ timeout: 20_000 });
  await expect(overlay).toContainText(errorMessage);
  await expect(overlay.locator('#operations-error-context')).toBeHidden();
  await expect(overlay.locator('#__v_o__filelink')).toContainText('tests/fixtures/dev-errors.ts');
  await expect(overlay.locator('.shiki').first()).toBeVisible();
  await expect(overlay.locator('.shiki').first()).toContainText('throw new Error');
  const stackPayload = await overlay.evaluate(element => {
    const payload = element.getRootNode().host.__v_oPayload;
    const error = payload.errors[0];
    return { rootPath: payload.rootPath, stack: error.originalStack || error.stack || payload.originalStack || payload.stack };
  });
  const stackLink = overlay.locator('.stack-link[data-file$="/tests/fixtures/dev-errors.ts"]').first();
  const stackLocation = await stackLink.evaluate(element => ({ file: element.dataset.file,
    line: element.dataset.line, column: element.dataset.column }));
  const stackRoot = stackPayload.rootPath.replace(/\/+$/, '');
  assert.equal(stackLocation.file, fixturePath, 'Editor links must retain the absolute fixture path.');
  assert.match(stackLocation.line, /^[1-9]\d*$/);
  assert.match(stackLocation.column, /^[1-9]\d*$/);
  const stackCoordinates = `:${stackLocation.line}:${stackLocation.column}`;
  assert.ok(stackPayload.stack.includes(`${stackLocation.file}${stackCoordinates}`),
    'Editor line and column must match the original absolute stack frame.');
  const displayedFile = stackLocation.file.startsWith(`${stackRoot}/`)
    ? `./${stackLocation.file.slice(stackRoot.length + 1)}` : stackLocation.file;
  await expect(stackLink).toHaveText(`${displayedFile}${stackCoordinates}`);
  assert.equal(await overlay.evaluate(element => {
    const payload = element.getRootNode().host.__v_oPayload;
    return payload.errors[0].originalStack || payload.errors[0].stack || payload.originalStack || payload.stack;
  }), stackPayload.stack, 'Relative display text must not rewrite the raw error stack.');
  await expect.poll(() => overlay.evaluate(element => !!element.closest('.dark'))).toBe(true);
  await expect(toolbarToggle).toBeVisible();
  await expect(page).toHaveURL(`${baseURL}/`);
  await expect(page.locator(':root')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator(':root')).toHaveAttribute('data-palette', 'sunset');
  await expectThemeColors(overlay, { backgroundColor: '--color-surface', color: '--color-foreground' });
  await expectThemeColors(overlay.locator('.shiki').first(), { backgroundColor: '--color-background' });
  await page.screenshot({ path: `${artifactDirectory}/saved-dark-sunset.png` });

yield "saved appearance and source-linked native errors initialize the development overlay";
  for (const palette of ['default', 'sunset']) for (const theme of ['light', 'dark']) {
    await page.evaluate(({ palette, theme }) => {
      document.documentElement.dataset.palette = palette;
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }, { palette, theme });
    await expectThemeColors(overlay, { backgroundColor: '--color-surface', color: '--color-foreground' });
    await expectThemeColors(overlay.locator('.shiki').first(), { backgroundColor: '--color-background' });
    for (const id of ['__v_o__heading', '__v_o__message'])
      await expectThemeColors(overlay.locator(`#${id}`), { color: '--color-foreground' });
    await expect(page.locator('#__v_o__balloon')).toBeHidden();
    await expect(page.locator('#v-o-theme-switch')).toBeHidden();
    await expectThemeColors(toolbarToggle.locator('..'), {
      backgroundColor: '--color-background', color: '--color-foreground',
    });
    const colors = await overlay.evaluate(element => {
      const root = getComputedStyle(document.documentElement);
      const style = getComputedStyle(element);
      return {
        actual: ['--ono-v-bg', '--ono-v-surface', '--ono-v-text'].map(name => style.getPropertyValue(name).trim()),
        expected: ['--color-background', '--color-surface', '--color-foreground'].map(name => root.getPropertyValue(name).trim()),
      };
    });
    assert.deepEqual(colors.actual, colors.expected, `Overlay roles must inherit the ${palette} ${theme} application colors.`);
    const codeColors = await overlay.locator('.shiki').first().evaluate(inspectCodeColors);
    samples.push({ palette, theme, colors: colors.actual, codeColors });
    assert.ok(codeColors.spanCount > 0, 'Code highlighting must contain real source tokens.');
    assert.equal(codeColors.background[3], 255, 'The code block must have a solid background.');
    assert.deepEqual(codeColors.opaqueSpans, [], `${palette} ${theme}: every code span must have a transparent background.`);
    assert.deepEqual(codeColors.outsidePalette, [], `${palette} ${theme}: syntax colors must come directly from the six active palette tones.`);
    for (const [role, tone] of Object.entries({ keyword: 4, function: 4, string: 5, number: 6 })) {
      assert.ok(codeColors.syntax[role], `Missing ${role} syntax sample.`);
      assert.deepEqual(codeColors.syntax[role].color, codeColors.palette[tone - 1],
        `${palette} ${theme}: ${role} must use active tone ${tone}.`);
    }
    assert.equal(new Set(Object.values(codeColors.syntax).map(token => JSON.stringify(token.color))).size, 3,
      'Keywords/functions, strings, and numbers must remain visibly distinct syntax categories.');
    await page.screenshot({ path: `${artifactDirectory}/${palette}-${theme}.png` });
  }
  assert.equal(new Set(samples.map(sample => JSON.stringify(sample.colors))).size, 4,
    'Changing the live theme or palette must change the already-open overlay colors.');

  await overlay.getByRole('button', { name: 'Close error overlay', exact: true }).click();
  await expect(overlay).toBeHidden();
  await expect(page.locator('#__v_o__balloon')).toBeHidden();
  await toolbarToggle.hover();
  await toolbar.getByRole('button', { name: /^1 error – click to show overlay$/ }).click();
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText(errorMessage);
  // Reopening through DevTools leaves its trigger focused. Exercise the
  // overlay's keyboard dismissal from a control owned by that dialog.
  const keyboardDismiss = overlay.getByRole('button', { name: 'Close error overlay', exact: true });
  await keyboardDismiss.focus();
  await expect(keyboardDismiss).toBeFocused();
  await keyboardDismiss.press('Escape');
  await expect(overlay).toBeHidden();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(toolbarToggle).toBeVisible();
  await expect(overlay).toHaveCount(0);
  await expect(page.locator(':root')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator(':root')).toHaveAttribute('data-palette', 'sunset');

yield "open development errors inherit live palette syntax colors and support dismissal and reopening";
  // Failed reporting must not recursively report Vite's own transport error.
  // Limit throws so this regression also terminates with the previous loop.
  const diagnosticsBeforeTransport = diagnostics.length;
  await page.evaluate(message => {
    const send = WebSocket.prototype.send;
    const consoleError = console.error;
    globalThis.overlayTransportFailure = { attempts: 0, events: [] };
    WebSocket.prototype.send = function (data) {
      let payload;
      try { payload = typeof data === 'string' ? JSON.parse(data) : null; } catch {}
      if (payload?.type === 'custom' && ['visulima:vite-overlay:error', 'vite:forward-console'].includes(payload.event)) {
        const state = globalThis.overlayTransportFailure;
        state.attempts += 1;
        state.events.push(payload.event);
        if (state.attempts <= 10) throw new Error(message);
        return;
      }
      return send.apply(this, arguments);
    };
    globalThis.restoreOverlayTransport = () => {
      WebSocket.prototype.send = send;
      return { ...globalThis.overlayTransportFailure, sameConsole: console.error === consoleError };
    };
  }, transportFailureMessage);
  try {
    const [failedReport] = await Promise.all([
      page.waitForEvent('console', { predicate: message =>
        message.type() === 'error' && message.text().includes(loggedErrorMessage) }),
      injectTestError(page, 'logTestError'),
    ]);
    assert.equal(await failedReport.args()[0].evaluate(error => error instanceof Error &&
      error.message === 'Test-only Pail error — saved workflows and settings are unchanged.'), true,
    'The original native error must remain in the console when overlay reporting fails.');
    await expect.poll(() => page.evaluate(() => globalThis.overlayTransportFailure.attempts)).toBeGreaterThan(0);
    await page.waitForTimeout(500);
  } finally {
    transportFailure = await page.evaluate(() => globalThis.restoreOverlayTransport());
  }
  assert.equal(transportFailure.attempts, 1, 'One failed error report must cause exactly one transport attempt.');
  assert.deepEqual(transportFailure.events, ['visulima:vite-overlay:error'], 'Vite must not forward console output a second time.');
  assert.equal(transportFailure.sameConsole, true, 'Reporting an error must not replace console.error.');
  const transportDiagnostics = diagnostics.slice(diagnosticsBeforeTransport);
  assert.equal(transportDiagnostics.length, 1, 'A transport failure must log once without a reporting storm.');
  assert.equal(transportDiagnostics[0].type, 'console-error');
  assert.ok(transportDiagnostics[0].message.includes('[vite]') &&
    transportDiagnostics[0].message.includes(transportFailureMessage), 'Only the injected transport error is expected.');
  diagnostics.splice(diagnosticsBeforeTransport, transportDiagnostics.length);
  await expect(overlay).toHaveCount(0);

yield "a failed development reporting transport makes one attempt without recursive logging";
  // A subsequent test-injected report must recover through the real Pail path.
  const [loggedError] = await Promise.all([
    page.waitForEvent('console', { predicate: message =>
      message.type() === 'error' && message.text().includes(loggedErrorMessage) }),
    injectTestError(page, 'logTestError'),
  ]);
  const nativeError = await loggedError.args()[0].evaluate(error => ({
    native: error instanceof Error, message: error.message, stack: error.stack,
  }));
  assert.equal(nativeError.native, true, 'Pail must preserve the native Error for the overlay.');
  assert.equal(nativeError.message, loggedErrorMessage);
  assert.match(nativeError.stack, /at (?:(?:Object|Module)\.)?logTestError .*\/tests\/fixtures\/dev-errors\.ts:/);
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('#__v_o__message')).toContainText(loggedErrorMessage);
  await expect(overlay.locator('#operations-error-context')).toBeHidden();
  await expect(overlay.locator('#__v_o__filelink')).toContainText('tests/fixtures/dev-errors.ts');
  await expect(overlay.locator('.shiki').first()).toContainText('logger.error(new Error');
  await overlay.locator('#__v_o__stacktrace > summary').click();
  await expect(overlay.locator('#__v_o__stacktrace')).toContainText('logTestError');
  await page.screenshot({ path: `${artifactDirectory}/pail-error.png` });
  await overlay.getByRole('button', { name: 'Close error overlay', exact: true }).click();
  await expect(overlay).toBeHidden();
  // Visulima deduplicates identical stacks for 500 ms; test a later recurrence.
  await page.waitForTimeout(550);
  await injectTestError(page, 'logTestError');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('#__v_o__message')).toContainText(loggedErrorMessage);
  await expect(page).toHaveURL(`${baseURL}/`);
  await expect(page.locator(':root')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator(':root')).toHaveAttribute('data-palette', 'sunset');
  await overlay.getByRole('button', { name: 'Close error overlay', exact: true }).click();
  await expect(overlay).toBeHidden();

yield "native Pail errors retain stack locations and later reports recover after transport failure";
  // Pause app code to inspect the critical loader, then release the pending
  // settings writer and inject a test error after the saved theme and app load.
  const blockedContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await blockedContext.route('**/*', confineRequest);
  let releaseAppModule;
  const appModuleGate = new Promise(resolve => { releaseAppModule = resolve; });
  await blockedContext.route(`${baseURL}/index.ts`, async route => {
    await appModuleGate;
    await route.continue();
  });
  await blockedContext.route(`${baseURL}/__storage-block-test`, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Temporary database blocker</title>',
  }));
  const databaseHolder = await blockedContext.newPage();
  await databaseHolder.goto(`${baseURL}/__storage-block-test`);
  await databaseHolder.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('v1/settings', 2);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      globalThis.heldDatabase = request.result;
      const transaction = request.result.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put('dark', 'theme');
      transaction.objectStore('settings').put('sunset', 'palette');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    };
  }));
  await databaseHolder.evaluate(() => {
    globalThis.holdSettingsWriter = true;
    const transaction = globalThis.heldDatabase.transaction('settings', 'readwrite');
    globalThis.settingsWriterDone = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
    const hold = () => {
      const request = transaction.objectStore('settings').get('theme');
      request.onsuccess = () => { if (globalThis.holdSettingsWriter) hold(); };
    };
    hold();
  });
  page = await blockedContext.newPage();
  trackErrors(page);
  await page.goto(baseURL, { waitUntil: 'commit' });
  const blockedOverlay = page.getByRole('dialog', { name: 'Runtime Error Overlay', exact: true });
  try {
    const startup = page.getByRole('status', { name: 'Loading Operations', exact: true });
    await expect(startup).toBeVisible();
    await expect(startup).toHaveAttribute('id', 'startup-status');
    await expect(startup.locator('#startup-progress')).toHaveText('1 of 13\nLoading application');
    await expect(page.locator('#app')).toHaveAttribute('inert', '');
    await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'true');
    await expect(startup.locator('[aria-hidden="true"]').first()).toBeVisible();
    const runningAnimations = () => startup.evaluate(element =>
      element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length);
    await expect.poll(runningAnimations).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(runningAnimations).toBe(0);
    await expect(startup).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(runningAnimations).toBeGreaterThan(0);
    await expect(blockedOverlay).toHaveCount(0);
    await page.screenshot({ path: `${artifactDirectory}/blocked-settings-loading.png` });
  } finally {
    releaseAppModule();
    await databaseHolder.evaluate(async () => {
      globalThis.holdSettingsWriter = false;
      await globalThis.settingsWriterDone;
      globalThis.heldDatabase.close();
    });
  }
  await expect(page.getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible();
  await expect(page.locator('#startup-status')).toHaveCount(0);
  await expect(page.locator(':root')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator(':root')).toHaveAttribute('data-palette', 'sunset');
  await expect(blockedOverlay).toHaveCount(0);
  await injectTestError(page);
  await expect(blockedOverlay).toBeVisible();
  await expect(blockedOverlay.locator('#__v_o__message')).toContainText(errorMessage);
  await expect(blockedOverlay.locator('.shiki').first()).toContainText('throw new Error');
  await expectThemeColors(blockedOverlay, { backgroundColor: '--color-surface', color: '--color-foreground' });
  await page.screenshot({ path: `${artifactDirectory}/released-settings-preview.png` });
yield "the critical loading screen remains animated and accessible before saved settings and error injection";
  assert.deepEqual(diagnostics, [], 'The isolated fixture errors must be the only browser errors.');
  succeeded = true;

} finally {
  if (!succeeded && page && !page.isClosed()) {
    failureState = await page.evaluate(() => {
      const toolbar = document.querySelector('dev-toolbar');
      const root = toolbar?.shadowRoot;
      const describe = element => {
        const style = getComputedStyle(element);
        const { x, y, width, height } = element.getBoundingClientRect();
        return { label: element.getAttribute('aria-label'), title: element.getAttribute('title'),
          appId: element.getAttribute('data-app-id'), text: element.textContent,
          display: style.display, visibility: style.visibility, opacity: style.opacity,
          bounds: { x, y, width, height } };
      };
      return { apps: window.__VISULIMA_DEVTOOLS__?.getApps().map(({ id, name }) => ({ id, name })),
        toolbar: toolbar && describe(toolbar), shadowText: root?.textContent,
        buttons: [...root?.querySelectorAll('button') ?? []].map(describe),
        themed: !!root?.querySelector('[data-operations-toolbar-theme]'),
        startup: document.querySelector('#startup-status')?.textContent ?? null,
        inert: document.querySelector('#app')?.inert, busy: document.querySelector('#app')?.getAttribute('aria-busy') };
    }).catch(error => ({ inspectionError: error.message }));
    await page.screenshot({ path: `${artifactDirectory}/failure.png`, fullPage: true }).catch(() => {});
  }
  await writeFile(`${artifactDirectory}/result.json`, `${JSON.stringify({ succeeded, samples, transportFailure, diagnostics, failureState }, null, 2)}\n`);
  await browser?.close();
  await server.close();
}

}
