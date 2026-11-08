// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { buildAdditionFixture, saveAdditionFixture, loadAdditionFixture } from './fixture-build.mjs';
import { auditOperations, selectOperations } from './audit.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
process.chdir(root);
const directory = resolve(root, 'tmp/test/catalog-additions');
const args = process.argv.slice(2);
const options = { resume: false, catalogs: [], operations: [], limit: undefined };
let prepareFixture = false, preparedFixture = false;
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--prepare-fixture') prepareFixture = true;
  else if (args[index] === '--prepared-fixture') preparedFixture = true;
  else if (args[index] === '--resume') options.resume = true;
  else if (args[index] === '--catalog' && args[index + 1]) options.catalogs.push(...args[++index].split(','));
  else if (args[index] === '--operation' && args[index + 1]) options.operations.push(args[++index]);
  else if (args[index] === '--limit' && /^[1-9]\d*$/.test(args[index + 1] ?? '')) options.limit = Number(args[++index]);
  else throw new Error(`Unknown or incomplete argument: ${args[index]}`);
}
await mkdir(directory, { recursive: true });
async function fingerprint() {
  const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
    'src', 'build', 'package.json', 'package-lock.json', 'tests/catalog-additions'], { encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
  const hash = createHash('sha256');
  for (const name of files) hash.update(name).update(await readFile(resolve(root, name)));
  return hash.digest('hex');
}
const sourceFingerprint = await fingerprint();
const fixtureFile = resolve(directory, 'prepared-fixture.json');
if (prepareFixture) {
  assert.ok(!preparedFixture && !options.resume && !options.catalogs.length && !options.operations.length && !options.limit, 'Prepare the fixture without an audit selection.');
  await saveAdditionFixture(fixtureFile, sourceFingerprint, await buildAdditionFixture(root));
  assert.equal(await fingerprint(), sourceFingerprint, 'Source changed during fixture preparation.');
  console.log('Prepared catalog fixture: ' + sourceFingerprint); process.exit(0);
}
const metadataFile = resolve(directory, 'run.json'), resultsFile = resolve(directory, 'results.ndjson');
let metadata = { version: 1, sourceFingerprint, options, startedAt: new Date().toISOString(), completed: false,
  boundary: 'Production hydration, graph/layout/validation, workflow save/readback/delete in isolated Chromium. No DOM menu/render or API execution.' };
let results = [];
if (options.resume) {
  const previous = JSON.parse(await readFile(metadataFile, 'utf8'));
  assert.equal(previous.sourceFingerprint, sourceFingerprint, 'Cannot resume results from different source bytes.');
  assert.deepEqual(previous.options.catalogs, options.catalogs, 'Resume must use the same catalog selection.');
  assert.deepEqual(previous.options.operations ?? [], options.operations, 'Resume must use the same operation selection.');
  assert.equal(previous.options.limit, options.limit, 'Resume must use the same limit.');
  results = (await readFile(resultsFile, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  metadata = { ...previous, completed: false, resumedAt: new Date().toISOString(), options };
} else await writeFile(resultsFile, '');
await writeFile(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
let browser, context, page, server;
const infrastructureErrors = [];
let allOperations = [], selected = [];
const csv = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';

async function reports() {
  const failures = results.filter(result => !result.ok), providers = new Map();
  for (const row of results) {
    const provider = providers.get(row.catalog) ?? { id: row.catalog, name: row.catalogName, passed: 0, failed: 0 };
    provider[row.ok ? 'passed' : 'failed']++; providers.set(row.catalog, provider);
  }
  const summary = { ...metadata, totalInventory: allOperations.length, selected: selected.length, attempted: results.length,
    passed: results.length - failures.length, failed: failures.length, unattempted: selected.length - results.length,
    cleanupResets: results.filter(result => result.cleanup?.contextReset).length,
    maximumPersistedWorkflows: Math.max(0, ...results.map(result => result.persistedWorkflows ?? 0)),
    everyAttemptCleaned: results.every(result => result.cleanup?.remainingWorkflows === 0),
    infrastructureErrors, providers: [...providers.values()] };
  await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const fields = ['catalogName', 'id', 'name', 'method', 'path', 'stage', 'reason', 'workflowId'];
  await writeFile(resolve(directory, 'failures.csv'), [fields.map(csv).join(','), ...failures.map(row => fields.map(field => csv(row[field])).join(','))].join('\n') + '\n');
  const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = ['# Catalog operation addition audit', '',
    `${summary.attempted}/${summary.selected} attempted; ${summary.passed} passed; ${summary.failed} failed; ${summary.unattempted} unattempted.`, '',
    `Complete: ${summary.completed}. Source fingerprint: ${sourceFingerprint}.`, '', metadata.boundary, '',
    'Each attempt uses a unique workflow ID. The previous graph and saved workflow are removed before the next attempt.', '',
    '| Catalog | Passed | Failed |', '| --- | ---: | ---: |',
    ...summary.providers.map(provider => `| ${escape(provider.name)} | ${provider.passed} | ${provider.failed} |`), '',
    '## Failed operations', '', '| Catalog | Operation ID | Name | Stage | Reason |', '| --- | --- | --- | --- | --- |',
    ...failures.map(row => `| ${[row.catalogName, row.id, row.name, row.stage, row.reason].map(escape).join(' | ')} |`), '',
    ...infrastructureErrors.map(error => `Infrastructure: ${escape(error)}`)];
  await writeFile(resolve(directory, 'report.md'), lines.join('\n') + '\n');
  return summary;
}

async function openContext(baseURL) {
  context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(baseURL + '/') || url.startsWith('data:') || url.startsWith('blob:')) await route.continue();
    else { infrastructureErrors.push(`Unexpected external request: ${route.request().method()} ${url}`); await route.abort('blockedbyclient'); }
  });
  page = await context.newPage();
  page.on('pageerror', error => infrastructureErrors.push(`Page: ${error.message}`));
  await page.goto(baseURL);
  await page.waitForFunction(() => !!window.catalogAdditionAudit, undefined, { timeout: 120_000 });
  return page.evaluate(() => window.catalogAdditionAudit.initialize());
}

try {
  console.log(preparedFixture ? 'Loading verified prepared browser fixture.' : 'Building test-only browser integration fixture.');
  const files = preparedFixture ? await loadAdditionFixture(fixtureFile, sourceFingerprint) : await buildAdditionFixture(root);
  server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); response.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Isolated catalog addition audit</title><script type="module">window.catalogAdditionAudit = await import("/fixture.js");</script>');
    } else if (files.has(pathname)) {
      response.setHeader('Content-Type', pathname.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'); response.end(files.get(pathname));
    } else { response.statusCode = 404; response.end(); }
  });
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  allOperations = await openContext(baseURL);
  assert.equal(new Set(allOperations.map(operation => operation.id)).size, allOperations.length, 'Inventory must contain unique operation identities.');
  selected = selectOperations(allOperations, options);
  const inventoryHash = createHash('sha256').update(JSON.stringify(selected)).digest('hex');
  if (metadata.inventoryHash) assert.equal(metadata.inventoryHash, inventoryHash, 'Resume inventory changed.');
  metadata.inventoryHash = inventoryHash;
  await writeFile(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
  await writeFile(resolve(directory, 'inventory.json'), JSON.stringify(selected) + '\n');
  const completed = new Set(results.map(result => result.id));
  const selectedIds = new Set(selected.map(operation => operation.id));
  assert.equal(completed.size, results.length, 'Resume has duplicate results.');
  assert.ok(results.every(result => selectedIds.has(result.id) && result.cleanup?.remainingWorkflows === 0), 'Resume contains invalid or unclean outcomes.');
  console.log(`Auditing ${selected.length} operations (${allOperations.length} total); ${results.length} already recorded.`);
  let poisoned = false;
  async function bounded(call, label) {
    let timer;
    try { return await Promise.race([call(), new Promise((_, reject) => {
      timer = setTimeout(() => { poisoned = true; reject(new Error(`Operation ${label} exceeded 30 seconds.`)); }, 30_000);
    })]); } finally { clearTimeout(timer); }
  }
  const adapter = {
    add(id, workflowId) {
      return bounded(() => page.evaluate(({ id, workflowId }) => window.catalogAdditionAudit.add(id, workflowId), { id, workflowId }), 'addition');
    },
    remove(workflowId) {
      if (poisoned) throw new Error('Timed-out context must be discarded before continuing.');
      return bounded(() => page.evaluate(id => window.catalogAdditionAudit.remove(id), workflowId), 'cleanup');
    },
    async reset() {
      await context.close();
      const inventory = await openContext(baseURL);
      assert.deepEqual(inventory, allOperations, 'Context reset must preserve the complete inventory.');
      poisoned = false;
    },
  };
  await auditOperations(selected.filter(operation => !completed.has(operation.id)), adapter, async result => {
    results.push(result); await appendFile(resultsFile, JSON.stringify(result) + '\n');
    if (results.length % 250 === 0 || results.length === selected.length) {
      const summary = await reports();
      console.log(JSON.stringify({ attempted: summary.attempted, total: selected.length, passed: summary.passed, failed: summary.failed, catalog: result.catalog }));
    }
  });
  assert.equal(await fingerprint(), sourceFingerprint, 'Source bytes changed during the audit; results are not one coherent revision.');
  assert.equal(new Set(results.map(result => result.workflowId)).size, results.length, 'Workflow identities must be unique across the complete sweep.');
  assert.equal((await page.evaluate(() => window.catalogAdditionAudit.remove('final-cleanup'))).remainingWorkflows, 0);
  metadata.completed = results.length === selected.length;
} catch (error) {
  infrastructureErrors.push(error.stack ?? String(error)); console.error(error.message); process.exitCode = 1;
} finally {
  await browser?.close(); server?.closeAllConnections();
  if (server?.listening) await new Promise(resolveClosed => server.close(resolveClosed));
  metadata.finishedAt = new Date().toISOString();
  await writeFile(metadataFile, JSON.stringify(metadata, null, 2) + '\n');
  const summary = await reports();
  if (!summary.completed || summary.failed || infrastructureErrors.length) process.exitCode = 1;
  console.log(JSON.stringify({ completed: summary.completed, attempted: summary.attempted, passed: summary.passed, failed: summary.failed,
    unattempted: summary.unattempted, report: resolve(directory, 'report.md') }));
}
