// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { glob, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { generateMessages } from '@cucumber/gherkin';
import { profiles } from './profiles.mjs';
import { configurationFingerprint, installedToolchain } from './execution-fingerprint.mjs';

const root = resolve(import.meta.dirname, '../..');
const [profile, ...arguments_] = process.argv.slice(2);
if (!profiles[profile] && profile !== 'runner') throw new Error('Expected source, acceptance, automation, browser, components or runner.');
const forwarded = [];
const features = [];
let tags = process.env.OPERATIONS_TEST_TAGS ?? '';
let matrix = false;
let components = false;
let nameFiltered = false;
for (let index = 0; index < arguments_.length; index++) {
  const argument = arguments_[index];
  if (argument === '--matrix') matrix = true;
  else if (argument === '--with-components') components = true;
  else if (argument === '--tags') {
    if (!arguments_[index + 1]) throw new Error('--tags requires a tag expression.');
    tags = tags ? `(${tags}) and (${arguments_[++index]})` : arguments_[++index];
  } else if (argument.startsWith('--tags=')) tags = argument.slice(7);
  else if (argument === '--features') {
    if (!arguments_[index + 1]) throw new Error('--features requires comma-separated paths.');
    features.push(...arguments_[++index].split(',').filter(Boolean));
  } else if (argument === '--name' || argument === '-t' || argument === '--testNamePattern') {
    if (!arguments_[index + 1]) throw new Error(`${argument} requires a scenario pattern.`);
    forwarded.push('-t', arguments_[++index]); nameFiltered = true;
  } else if (argument.endsWith('.feature') && !argument.startsWith('-')) features.push(argument);
  else {
    if (/^(?:-t|--testNamePattern)(?:=|$)/.test(argument)) nameFiltered = true;
    forwarded.push(argument);
  }
}
if ((matrix || components) && profile !== 'browser') throw new Error('Browser matrix/component options require the browser profile.');
const engines = matrix ? ['chromium', 'firefox', 'webkit'] : [process.env.BROWSER_ENGINE ?? 'chromium'];
const filtered = Boolean(features.length || tags || nameFiltered || forwarded.some(arg => /^(?:--shard|--exclude|--testNamePattern)/.test(arg)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const configFingerprint = configurationFingerprint(root);
const dependencyVersions = installedToolchain(root);
await mkdir(resolve(root, 'tmp/test/blobs'), { recursive: true });
await mkdir(resolve(root, 'tmp/test/executions'), { recursive: true });
await mkdir(resolve(root, 'tmp/test/attachments'), { recursive: true });

async function discover(name) {
  const selectedFeatures = name === profile ? features : [];
  const patterns = selectedFeatures.length ? selectedFeatures.map(file => file.includes('/') ? file :
    name === 'browser' ? `tests/browser/${file}` : name === 'components' ? `tests/components/${file}` : file)
    : profiles[name].paths;
  const paths = new Set();
  for (const pattern of patterns) for await (const file of glob(pattern, { cwd: root })) paths.add(file.replaceAll('\\', '/'));
  if (!paths.size) throw new Error(`No ${name} features match the selected paths.`);
  const featurePaths = [...paths].sort();
  const expectedCaseIds = [];
  let id = 0;
  for (const uri of featurePaths) {
    const envelopes = generateMessages(await readFile(resolve(root, uri), 'utf8'), uri,
      'text/x.cucumber.gherkin+plain', { includeGherkinDocument: true, includePickles: true, newId: () => String(++id) });
    const parseError = envelopes.find(item => item.parseError)?.parseError;
    if (parseError) throw new Error(`Invalid Gherkin ${uri}: ${parseError.message}`);
    const locations = new Map();
    const document = envelopes.find(item => item.gherkinDocument)?.gherkinDocument;
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (value.id && value.location) locations.set(value.id, value.location.line);
      for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit); else visit(child);
    }
    visit(document);
    for (const { pickle } of envelopes.filter(item => item.pickle)) {
      const line = locations.get(pickle.astNodeIds.at(-1));
      if (!line) throw new Error(`Missing Gherkin source location: ${uri} ${pickle.name}`);
      expectedCaseIds.push(`${uri}:${line}`);
    }
  }
  return { featurePaths, expectedCaseIds: expectedCaseIds.sort() };
}

function runNode(script, args, environment) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env: environment, stdio: 'inherit' });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
      resolveExit(signal ? 1 : code ?? 1);
    });
  });
}

let preparedBrowserBundles;
async function browserBundles() {
  preparedBrowserBundles ??= (async () => {
    const bundles = resolve(root, 'tmp/test/browser/fixture-bundles.json');
    await mkdir(resolve(root, 'tmp/test/browser'), { recursive: true });
    const { buildFixtureBundles } = await import('../browser/fixture-bundles.mjs');
    await writeFile(bundles, JSON.stringify(await buildFixtureBundles()));
    return bundles;
  })();
  return preparedBrowserBundles;
}

async function execute(name, engine) {
  const project = name === 'browser' ? `browser-${engine}` : name;
  const { featurePaths, expectedCaseIds } = await discover(name);
  const resultPath = `tmp/test/vitest-${project}.json`;
  const blobPath = `tmp/test/blobs/${project}.json`;
  const proofPath = `tmp/test/executions/${project}.json`;
  await Promise.all([resultPath, blobPath, proofPath].map(file => rm(resolve(root, file), { force: true })));
  const environment = { ...process.env, OPERATIONS_TEST_PROFILE: name,
    OPERATIONS_TEST_TAGS: tags, BROWSER_ENGINE: engine,
    ...(name === profile && features.length ? { OPERATIONS_FEATURES: JSON.stringify(featurePaths) } : {}) };
  if (name === 'browser') {
    const runtime = resolve(root, 'tmp/test/browser/.runtime');
    await mkdir(runtime, { recursive: true });
    environment.TMPDIR = runtime;
    environment.OPERATIONS_WORLD_PARAMETERS = JSON.stringify({ fixtureBundlesFile: await browserBundles() });
  }
  const startedAt = new Date().toISOString();
  const exitCode = await runNode(resolve(root, 'node_modules/vitest/vitest.mjs'),
    ['run', '--config', name === 'runner' ? 'tests/gherkin/runner-regressions/vitest.config.mjs' : 'vitest.config.mjs', ...forwarded], environment);
  let resultHash, blobHash, complete = false;
  try {
    const [result, blob] = await Promise.all([readFile(resolve(root, resultPath)), readFile(resolve(root, blobPath))]);
    resultHash = hash(result); blobHash = hash(blob);
    const report = JSON.parse(result);
    const cases = report.testResults.flatMap(file => file.assertionResults);
    const identities = cases.map(item => `${relative(root, resolve(root, item.meta?.gherkin?.uri ?? '')).replaceAll('\\', '/')}:${item.meta?.gherkin?.exampleLine}`).sort();
    complete = exitCode === 0 && !filtered && cases.length > 0 && report.success === true
      && cases.every(item => item.status === 'passed') && JSON.stringify(identities) === JSON.stringify(expectedCaseIds);
  } catch { /* Preserve process failure and write incomplete evidence for diagnosis. */ }
  const proof = { profile: name, project, engine: ['browser', 'components'].includes(name) ? engine : null,
    head, featurePaths, expectedCaseIds, tagExpression: tags, nameFilters: forwarded,
    filtered, complete, exitCode, startedAt, finishedAt: new Date().toISOString(),
    resultPath, blobPath, resultHash, blobHash, configFingerprint,
    dependencyVersions,
    runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null };
  await writeFile(resolve(root, proofPath), `${JSON.stringify(proof, null, 2)}\n`);
  return exitCode;
}

let failed = false;
for (const engine of engines) if (await execute(profile, engine) !== 0) failed = true;
if (components && await execute('components', 'chromium') !== 0) failed = true;
process.exitCode = failed ? 1 : 0;
