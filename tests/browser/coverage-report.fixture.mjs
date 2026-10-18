// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { parse } from 'flatted';
import { expect } from '@playwright/test';
import { createReportFixture } from '../gherkin/report-fixtures/index.mjs';

const mediaTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.zip': 'application/zip', '.gz': 'application/octet-stream', '.woff2': 'font/woff2' };
const testsIn = task => task.type === 'test' ? [task] : (task.tasks ?? []).flatMap(testsIn);
const numberIn = text => Number((text.match(/\d[\d,]*/) ?? ['NaN'])[0].replaceAll(',', ''));
const optionalFont = 'https://fonts.googleapis.com/css2?family=Readex+Pro:wght@300;400&display=swap';

async function recordBrowserEvidence(world) {
  const directory = resolve(world.artifactDirectory, 'recorded-evidence');
  await mkdir(directory, { recursive: true });
  const screenshotPath = resolve(directory, 'page.png');
  const tracePath = resolve(directory, 'trace.zip');
  const context = await world.browser.newContext({ viewport: { width: 640, height: 320 }, serviceWorkers: 'block' });
  const url = `${world.baseURL}/error-history-fixture.html`;
  try {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    await page.goto(url);
    await page.setContent('<!doctype html><title>Report evidence</title><button onclick="this.textContent=\'Recorded interaction\'">Record interaction</button>');
    await page.getByRole('button', { name: 'Record interaction', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Recorded interaction', exact: true })).toBeVisible();
    await page.screenshot({ path: screenshotPath });
    await context.tracing.stop({ path: tracePath });
  } finally { await context.close(); }
  return { screenshotPath, tracePath, url };
}

export async function openReport(world, relocated = false) {
  const recorded = await recordBrowserEvidence(world);
  const fixture = await createReportFixture(resolve(world.artifactDirectory, 'report-input'), {
    html: true, coverage: true, outline: true, attachments: { screenshotPath: recorded.screenshotPath, tracePath: recorded.tracePath },
  });
  const originalDirectory = resolve(fixture.reportDirectory);
  const results = fixture.results ?? JSON.parse(await readFile(fixture.jsonFile, 'utf8'));
  let directory = originalDirectory;
  if (relocated) {
    directory = resolve(world.artifactDirectory, 'relocated-report');
    await cp(originalDirectory, directory, { recursive: true });
    // The live server cannot fall back to the producer's assets or absolute paths.
    await rename(originalDirectory, `${originalDirectory}.unavailable-after-relocation`);
  }
  const state = world.report = { fixture, directory, results, recorded, requested: [], missing: [], external: [], errors: [] };
  state.metadata = parse(gunzipSync(await readFile(resolve(directory, 'ui/html.meta.json.gz'))).toString('utf8'));
  state.tests = state.metadata.files.flatMap(file => testsIn(file).map(test => ({ ...test, projectName: file.projectName })));
  state.server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let file = resolve(directory, `.${pathname}`);
      if (file !== directory && !file.startsWith(`${directory}${sep}`)) throw new Error('Outside report root');
      if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Type': mediaTypes[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(bytes);
    } catch {
      state.missing.push(request.url);
      response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Missing static report asset');
    }
  });
  await new Promise((done, reject) => { state.server.once('error', reject); state.server.listen(0, '127.0.0.1', done); });
  state.origin = `http://127.0.0.1:${state.server.address().port}`;
  state.context = await world.browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, serviceWorkers: 'block' });
  await state.context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await state.context.route('**/*', route => {
    const url = route.request().url();
    state.requested.push(url);
    if (url.startsWith(`${state.origin}/`) || /^(data|blob):/.test(url)) return route.continue();
    state.external.push(url);
    return route.abort('blockedbyclient');
  });
  state.context.on('page', page => page.on('pageerror', error => state.errors.push({ message: error.message, stack: error.stack })));
  state.page = await state.context.newPage();
  state.page.setDefaultTimeout(10_000);
  const response = await state.page.goto(`${state.origin}/index.html`);
  assert.equal(response.status(), 200);
  await expect.poll(async () => numberIn(await state.page.getByTestId('num-files').innerText())).toBe(state.metadata.files.length);
  return state;
}

async function findFile(directory, basename) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isFile() && entry.name === basename) return path;
    if (entry.isDirectory()) { const nested = await findFile(path, basename); if (nested) return nested; }
  }
}

async function coverageFrame(state) {
  const element = await state.page.locator('#vitest-ui-coverage').elementHandle();
  return element?.contentFrame();
}
async function frameAt(state, url) {
  await expect.poll(async () => (await coverageFrame(state))?.url()).toBe(url);
  await expect.poll(async () => (await coverageFrame(state))?.evaluate(() => document.readyState)).toBe('complete');
}

export async function browseCoverage(state) {
  const page = state.page;
  await page.getByRole('button', { name: 'Show coverage', exact: true }).click();
  const frame = page.frameLocator('#vitest-ui-coverage');
  await frame.getByText('All files', { exact: true }).first().waitFor();
  const source = await findFile(resolve(state.directory, 'coverage'), 'source-a.js.html');
  assert.ok(source, 'The coverage fixture retains a real source page');
  const sourceURL = new URL(relative(state.directory, source).split(sep).join('/'), `${state.origin}/`).href;
  const parentURL = new URL('./index.html', sourceURL).href;
  for (let hop = 0; hop < 10; hop++) {
    const current = (await coverageFrame(state)).url();
    if (current === parentURL) break;
    const links = await frame.locator('a[href]').evaluateAll(elements => elements.map(element => ({ text: element.textContent.trim(), url: element.href })));
    const next = links.filter(link => link.url !== current && link.url.endsWith('/index.html')
      && sourceURL.startsWith(link.url.slice(0, -'index.html'.length))).sort((a, b) => b.url.length - a.url.length)[0];
    assert.ok(next, `Coverage exposes a folder link towards ${sourceURL}`);
    await frame.locator('a[href]').evaluateAll((elements, url) => elements.find(element => element.href === url).click(), next.url);
    await frameAt(state, next.url);
  }
  await frameAt(state, parentURL);
  const links = frame.locator('.coverage-summary tbody td.file a');
  await expect(links.filter({ hasText: /^source-a\.js$/ })).toHaveCount(1);
  await expect(links.filter({ hasText: /^source_a\.js$/ })).toHaveCount(1);
  const order = await links.allTextContents();
  await frame.locator('th[data-col="file"]').click();
  await expect.poll(() => links.allTextContents()).toEqual([...order].reverse());
  await frame.locator('#fileSearch').fill('source_a.js');
  await expect(frame.locator('.coverage-summary tbody tr:visible')).toHaveCount(1);
  await expect(frame.locator('.coverage-summary tbody tr:visible td.file a')).toHaveText('source_a.js');
  await frame.locator('#fileSearch').fill('');
  await frame.getByRole('link', { name: 'source-a.js', exact: true }).click();
  await frameAt(state, sourceURL);
  await expect(frame.locator('pre.prettyprint')).toContainText('Ω');
  state.sourceURL = sourceURL;
  state.coverageDirectoryURL = parentURL;
}

export async function assertMeasuredScope(state) {
  const coverage = JSON.parse(await readFile(resolve(state.directory, 'coverage/coverage-final.json'), 'utf8'));
  const files = Object.entries(coverage);
  for (const basename of ['source-a.js', 'source_a.js']) assert.ok(files.some(([file]) => file.endsWith(`/${basename}`)), `${basename} remains a distinct measured file`);
  assert.ok(files.some(([, record]) => Object.values(record.s).some(hit => hit > 0)), 'Executed source retains real hits');
  assert.ok(files.some(([, record]) => Object.keys(record.s).length > 0 && Object.values(record.s).every(hit => hit === 0)), 'Unexecuted source is retained with zero hits');
}

async function sourceLine(page, name) {
  const link = page.locator(`a[href="#${name}"]`).first();
  await expect(link).toBeVisible();
  await expect.poll(() => page.evaluate(value => {
    const marker = document.getElementsByName(value)[0] ?? document.getElementById(value);
    const top = marker?.getBoundingClientRect().top;
    return top !== undefined && top >= -1 && top < innerHeight;
  }, name)).toBe(true);
}
export async function openDirectSource(state) {
  // Embedded coverage checks are complete; reuse its tab to bound browser process use.
  state.sourcePage = state.page;
  state.deepLink = `${state.sourceURL}#L40`;
  await state.sourcePage.goto(state.deepLink);
  await sourceLine(state.sourcePage, 'L40');
  await state.sourcePage.reload();
  await sourceLine(state.sourcePage, 'L40');
  await state.sourcePage.locator('h1 a[href="index.html"]').click();
  await expect(state.sourcePage.getByRole('link', { name: 'source_a.js', exact: true })).toBeVisible();
  await state.sourcePage.getByRole('link', { name: 'source_a.js', exact: true }).click();
  await expect(state.sourcePage.locator('h1')).toContainText('source_a.js');
  await state.sourcePage.goBack();
  await expect(state.sourcePage.getByRole('link', { name: 'source-a.js', exact: true })).toBeVisible();
  await state.sourcePage.goBack();
  await expect(state.sourcePage).toHaveURL(state.deepLink);
  await sourceLine(state.sourcePage, 'L40');
  await state.sourcePage.goForward();
  await expect(state.sourcePage.getByRole('link', { name: 'source_a.js', exact: true })).toBeVisible();
}
export async function assertSourceState(state) {
  await state.sourcePage.goto(state.deepLink);
  await sourceLine(state.sourcePage, 'L40');
  await expect(state.sourcePage.locator('pre.prettyprint')).toContainText('Ω');
}

export async function assertDashboard(state) {
  const count = state.results.numTotalTests;
  assert.ok(count > 0);
  assert.equal(state.results.numPassedTests, count);
  assert.equal(state.results.numFailedTests, 0);
  assert.equal(state.results.numPendingTests, 0);
  assert.equal(state.tests.length, count);
  assert.ok(state.tests.every(test => test.result?.state === 'pass'));
  await expect.poll(async () => numberIn(await state.page.getByTestId('pass-entry').innerText())).toBe(count);
  await expect.poll(async () => numberIn(await state.page.getByTestId('fail-entry').innerText())).toBe(0);
  const identities = state.tests.map(test => {
    const metadata = test.meta?.gherkin;
    assert.ok(metadata?.id && metadata.uri && Number.isInteger(metadata.line), 'Every authored case retains its feature identity');
    assert.ok(!metadata.uri.startsWith('/') && !metadata.uri.includes('\\'), 'Feature identities remain checkout-relative');
    return `${test.projectName ?? ''}:${metadata.id}`;
  });
  assert.equal(new Set(identities).size, identities.length, 'Examples are not collapsed into matching titles');
  const examples = state.tests.map(test => test.meta.gherkin).filter(metadata => metadata.exampleBlock >= 0);
  assert.equal(examples.length, 2, 'Both identically valued Examples rows appear in the report');
  assert.equal(new Set(examples.map(metadata => metadata.exampleLine)).size, 2);
}
export async function openBrowserEvidence(state) {
  const page = state.page;
  const dashboard = page.getByRole('button', { name: 'Show dashboard', exact: true });
  if (await dashboard.isVisible()) await dashboard.click();
  const test = state.tests.find(test => test.annotations?.some(note => note.attachment?.contentType === 'image/png')
    && test.annotations.some(note => note.attachment?.contentType === 'application/zip'));
  assert.ok(test, 'The report fixture contains a Gherkin case with screenshot and trace evidence');
  state.evidenceCase = test;
  const search = page.getByPlaceholder(/^Search/);
  await search.fill(test.name);
  const expand = page.getByTestId('expand-all');
  if (await expand.isVisible()) await expand.click();
  await page.getByText(test.name, { exact: true }).click();
  await page.getByText('Test Annotations', { exact: true }).waitFor();
}
export async function assertBrowserEvidence(state) {
  const test = state.evidenceCase;
  const pngNote = test.annotations.find(note => note.attachment?.contentType === 'image/png');
  const screenshot = state.page.getByRole('note').filter({ hasText: pngNote.message }).locator('img');
  await expect.poll(() => screenshot.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
  const image = Buffer.from(await screenshot.evaluate(async element => [...new Uint8Array(await (await fetch(element.src)).arrayBuffer())]));
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(image, await readFile(state.recorded.screenshotPath), 'The screenshot retains the actual browser capture');
  const zipNote = test.annotations.find(note => note.attachment?.contentType === 'application/zip');
  const pending = state.page.waitForEvent('download');
  await state.page.getByRole('note').filter({ hasText: zipNote.message }).getByRole('link', { name: 'Download', exact: true }).click();
  const download = await pending;
  assert.equal(await download.failure(), null, 'Trace download completes');
  const bytes = await readFile(await download.path());
  assert.deepEqual(bytes, await readFile(state.recorded.tracePath), 'The relocated download retains every original Playwright trace byte');
  const entries = traceEntries(bytes);
  const trace = entries.find(entry => entry.name.endsWith('.trace'));
  const network = entries.find(entry => entry.name.endsWith('.network'));
  assert.ok(trace && network, 'The attachment contains Playwright trace and network streams');
  const events = trace.bytes.toString('utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.ok(events.some(event => event.type === 'context-options'), 'The recording identifies its real browser context');
  assert.ok(events.some(event => event.type === 'before' && event.method === 'click'
    && event.params?.selector?.includes('Record interaction')), 'The recording retains the actual browser click');
  const requests = network.bytes.toString('utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.ok(requests.some(event => event.type === 'resource-snapshot'
    && event.snapshot?.request?.url === state.recorded.url && event.snapshot?.response?.status === 200), 'The recording retains its real HTTP request');
}
function traceEntries(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([80, 75, 5, 6]));
  assert.ok(end >= 0, 'The trace is a complete ZIP archive');
  let offset = bytes.readUInt32LE(end + 16);
  const count = bytes.readUInt16LE(end + 10);
  const entries = [];
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 20);
    const nameSize = bytes.readUInt16LE(offset + 28);
    const extraSize = bytes.readUInt16LE(offset + 30);
    const commentSize = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
    if (name.endsWith('.trace') || name.endsWith('.network')) {
      assert.equal(bytes.readUInt32LE(local), 0x04034b50);
      const data = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const compressed = bytes.subarray(data, data + size);
      assert.ok(method === 0 || method === 8, 'Playwright trace compression remains supported');
      entries.push({ name, bytes: method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 16 * 1024 * 1024 }) });
    }
    offset += 46 + nameSize + extraSize + commentSize;
  }
  return entries;
}
export function assertPackagedAssets(state) {
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.missing, []);
  assert.deepEqual(state.external.filter(url => url !== optionalFont), []);
  assert.ok(state.requested.some(url => url.endsWith('/ui/html.meta.json.gz')), 'The static report reads its packaged machine metadata');
  assert.ok(state.requested.some(url => url.includes('/ui/assets/')), 'The static report reads its packaged interface assets');
}
