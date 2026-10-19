// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseBlob } from 'flatted';
import { generateMessages } from '@cucumber/gherkin';
import { IdGenerator, SourceMediaType } from '@cucumber/messages';
import { profiles } from '../../tests/gherkin/profiles.mjs';
import { browserProjects, browserProjectNameForFeature } from '../../tests/gherkin/browser-projects.mjs';
import { configurationFingerprint, installedToolchain } from '../../tests/gherkin/execution-fingerprint.mjs';

export const requiredProfiles = ['source', 'acceptance', 'automation', 'browser', 'components', 'runner'];
export const hashFile = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const ordinary = value => value && typeof value === 'object' && !Array.isArray(value);

export function relativeFeature(uri, root = process.cwd()) {
  if (typeof uri !== 'string' || !uri || /[\0\r\n]/.test(uri)) throw new Error('Missing canonical feature URI.');
  const path = uri.startsWith('file:') ? fileURLToPath(uri) : uri;
  const portable = path.replaceAll('\\', '/');
  if (!isAbsolute(path) && portable.split('/').some(part => ['', '.', '..'].includes(part)))
    throw new Error('Relative feature identity must be canonical, without dot segments.');
  const normalized = (isAbsolute(path) ? relative(root, path) : portable).replaceAll('\\', '/');
  if (normalized.startsWith('../') || normalized.startsWith('/') || !normalized.endsWith('.feature'))
    throw new Error('Feature identity must stay within the repository.');
  return normalized;
}

export function caseId(meta, root) {
  if (!ordinary(meta) || !Number.isSafeInteger(meta.line) || meta.line < 1)
    throw new Error('A reported case has no canonical Gherkin location.');
  const line = meta.exampleLine ?? meta.line;
  if (!Number.isSafeInteger(line) || line < 1) throw new Error('Invalid example location.');
  return `${relativeFeature(meta.uri, root)}:${line}`;
}

export function readResults(file, { root = process.cwd() } = {}) {
  try {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  if (!ordinary(report) || !Array.isArray(report.testResults) || report.testResults.length === 0)
    throw new Error(`Invalid Vitest report: ${file}.`);
  const cases = report.testResults.flatMap(module => {
    if (!ordinary(module) || !Array.isArray(module.assertionResults)) throw new Error(`Invalid Vitest report module: ${file}.`);
    return module.assertionResults;
  });
  if (!cases.length || cases.some(item => !ordinary(item) || typeof item.title !== 'string' ||
    !['passed', 'failed', 'pending', 'skipped', 'todo', 'disabled'].includes(item.status)))
    throw new Error(`Invalid Vitest report outcomes: ${file}.`);
  if (cases.some(item => !Array.isArray(item.meta?.gherkin?.steps) || !item.meta.gherkin.steps.length ||
    item.meta.gherkin.steps.some(step => !ordinary(step) || typeof step.text !== 'string' || !step.text ||
      !Number.isSafeInteger(step.line) || step.line < 1 ||
      (step.status === undefined ? item.status === 'passed' : !['passed', 'failed', 'pending', 'skipped'].includes(step.status))) ||
    (item.status === 'passed' && item.meta.gherkin.steps.some(step => step.status !== 'passed'))))
    throw new Error(`Invalid Vitest report steps: ${file}.`);
  const ids = cases.map(item => caseId(item.meta?.gherkin, root));
  if (new Set(ids).size !== ids.length) throw new Error(`Invalid Vitest report: duplicate canonical case identities: ${file}.`);
  if (report.numTotalTests !== cases.length || report.numPassedTests !== cases.filter(item => item.status === 'passed').length ||
    report.numFailedTests !== cases.filter(item => item.status === 'failed').length ||
    report.numPendingTests !== cases.filter(item => !['passed', 'failed', 'todo'].includes(item.status)).length ||
    report.numTodoTests !== cases.filter(item => item.status === 'todo').length)
    throw new Error(`Invalid Vitest report: result totals disagree with individual cases: ${file}.`);
  return { report, cases, ids };
  } catch (error) {
    throw new Error(`Invalid Vitest report '${file}': ${error instanceof SyntaxError ? 'Malformed JSON.' : error.message}`, { cause: error });
  }
}

export function caseSignature(item, root = process.cwd()) {
  const meta = item.meta.gherkin;
  return JSON.stringify([caseId(meta, root), item.title, item.status,
    meta.line, meta.exampleLine, meta.exampleBlock, meta.exampleRow,
    [...(meta.tags ?? [])].sort(), meta.steps.map(step => [step.text, step.line, step.status])]);
}

export function readBlobResults(file, project, root = process.cwd(), features = []) {
  const blob = parseBlob(readFileSync(file, 'utf8'));
  if (!Array.isArray(blob) || blob[0] !== '5.0.5' || !Array.isArray(blob[1]) || !blob[1].length ||
    !Array.isArray(blob[2]) || blob[2].length)
    throw new Error('Invalid or unsuccessful Vitest blob.');
  const actualProject = project === 'components' ? 'components (chromium)' : project;
  const phasedBrowser = /^browser-(?:chromium|firefox|webkit)$/.test(actualProject)
    && browserProjects(features, actualProject, 1) !== undefined;
  const cases = [];
  const visited = new Set();
  function visit(task, feature) {
    if (!ordinary(task) || visited.has(task)) throw new Error('Invalid or repeated blob task.');
    visited.add(task);
    if (task.type === 'test') {
      if (task.result?.state !== 'pass' || task.result?.errors?.length)
        throw new Error('Blob contains an unsuccessful scenario.');
      if (relativeFeature(task.meta?.gherkin?.uri, root) !== feature)
        throw new Error('Blob feature path differs from its scenario metadata.');
      cases.push({ title: task.name, status: 'passed', meta: task.meta });
    } else {
      if (!Array.isArray(task.tasks) || task.result?.state !== 'pass' || task.result?.errors?.length)
        throw new Error('Blob contains an unsuccessful suite.');
      task.tasks.forEach(child => visit(child, feature));
    }
  }
  for (const fileTask of blob[1]) {
    const path = fileTask.filepath?.replaceAll('\\', '/');
    const matches = features.filter(feature => path === feature || path?.endsWith(`/${feature}`));
    if (matches.length !== 1) throw new Error('Blob contains an unrecognized feature path.');
    const expectedProject = phasedBrowser ? browserProjectNameForFeature(actualProject, matches[0]) : actualProject;
    if (fileTask.projectName !== expectedProject)
      throw new Error('Blob project differs from its declared execution.');
    visit(fileTask, matches[0]);
  }
  const ids = cases.map(item => caseId(item.meta?.gherkin, root));
  if (!cases.length || ids.length !== new Set(ids).size) throw new Error('Empty or duplicate blob scenarios.');
  return { cases, ids };
}

export function expectedCases(profile, root = process.cwd()) {
  const definition = profiles[profile] ?? (profile === 'runner' ? { paths: ['tests/gherkin/runner-regressions/contracts.feature'] } : undefined);
  if (!definition) throw new Error(`Unknown reporting profile: ${profile}.`);
  const features = [...new Set(definition.paths.flatMap(pattern => [...globSync(pattern, { cwd: root })]))].sort();
  if (!features.length) throw new Error(`Profile contains no feature files: ${profile}.`);
  const ids = [];
  const steps = new Map();
  for (const uri of features) {
    const envelopes = generateMessages(readFileSync(resolve(root, uri), 'utf8'), uri,
      SourceMediaType.TEXT_X_CUCUMBER_GHERKIN_PLAIN, {
        newId: IdGenerator.incrementing(), includeGherkinDocument: true, includePickles: true, includeSource: false,
      });
    const error = envelopes.find(item => item.parseError)?.parseError;
    if (error) throw new Error(`Invalid feature ${uri}: ${error.message}`);
    const locations = new Map();
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (value.id && value.location?.line) locations.set(value.id, value.location.line);
      for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(visit); else visit(child);
    }
    envelopes.filter(item => item.gherkinDocument).forEach(item => visit(item.gherkinDocument));
    for (const { pickle } of envelopes.filter(item => item.pickle)) {
      const line = locations.get(pickle.astNodeIds.at(-1));
      if (!Number.isSafeInteger(line)) throw new Error(`Missing parsed case location: ${uri}.`);
      const id = `${uri.replaceAll('\\', '/')}:${line}`;
      ids.push(id);
      const authored = pickle.steps.map(step => {
        const stepLine = locations.get(step.astNodeIds[0]);
        if (!Number.isSafeInteger(stepLine)) throw new Error(`Missing parsed step location: ${uri}.`);
        return [step.text, stepLine];
      });
      steps.set(id, authored);
    }
  }
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error(`Empty or ambiguous profile: ${profile}.`);
  return { features, ids, steps };
}

export function verifyExecution(profile, directory = 'tmp/test', { root = process.cwd() } = {}) {
  const identity = profile === 'browser' ? 'browser-chromium' : profile;
  const result = resolve(root, directory, `vitest-${identity}.json`);
  const proof = JSON.parse(readFileSync(resolve(root, directory, 'executions', `${identity}.json`), 'utf8'));
  const blob = resolve(root, directory, 'blobs', `${identity}.json`);
  const { report, cases, ids } = readResults(result, { root });
  const expected = expectedCases(profile, root);
  for (const item of cases) {
    const authored = expected.steps.get(caseId(item.meta.gherkin, root));
    const recorded = item.meta.gherkin.steps.map(step => [step.text, step.line]);
    if (!authored || JSON.stringify(authored) !== JSON.stringify(recorded))
      throw new Error(`Reported steps differ from the authored Gherkin: ${profile}.`);
  }
  const blobResults = readBlobResults(blob, identity, root, expected.features);
  if (!same(cases.map(item => caseSignature(item, root)), blobResults.cases.map(item => caseSignature(item, root))))
    throw new Error(`Blob and machine results disagree: ${profile}.`);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 30000 }).trim();
  if (proof.profile !== profile || proof.project !== identity || proof.head !== head ||
    proof.filtered !== false || proof.complete !== true || proof.exitCode !== 0 ||
    !same(proof.featurePaths ?? [], expected.features) || !same(ids, expected.ids) ||
    !same(proof.expectedCaseIds ?? [], expected.ids) ||
    proof.resultHash !== hashFile(result) || proof.blobHash !== hashFile(blob) ||
    !Number.isFinite(Date.parse(proof.startedAt)) || !Number.isFinite(Date.parse(proof.finishedAt)) ||
    Date.parse(proof.finishedAt) < Date.parse(proof.startedAt) ||
    proof.configFingerprint !== configurationFingerprint(root) ||
    JSON.stringify(Object.entries(proof.dependencyVersions ?? {}).sort()) !==
      JSON.stringify(Object.entries(installedToolchain(root)).sort()))
    throw new Error(`Incomplete, stale, filtered or mismatched execution: ${profile}.`);
  if (process.env.GITHUB_RUN_ID && (String(proof.runId) !== process.env.GITHUB_RUN_ID ||
    String(proof.runAttempt) !== process.env.GITHUB_RUN_ATTEMPT))
    throw new Error(`Results belong to a different CI run or attempt: ${profile}.`);
  if (!report.success || report.numFailedTestSuites !== 0 || cases.some(item => item.status !== 'passed' ||
    !item.meta.gherkin.steps?.length || item.meta.gherkin.steps.some(step => step.status !== 'passed')))
    throw new Error(`Not every declared scenario and step passed: ${profile}.`);
  return { profile, project: identity, cases: cases.length, resultHash: proof.resultHash,
    blobHash: proof.blobHash, head, runId: proof.runId, runAttempt: proof.runAttempt,
    caseSignatures: cases.map(item => caseSignature(item, root)).sort(),
    configFingerprint: proof.configFingerprint, dependencyVersions: proof.dependencyVersions };
}

export function verifyCoverage(file = 'tmp/test/coverage/coverage-summary.json') {
  const summary = JSON.parse(readFileSync(file, 'utf8')).total;
  for (const metric of ['statements', 'branches', 'functions', 'lines']) {
    const value = summary?.[metric];
    if (!ordinary(value) || !Number.isSafeInteger(value.total) || value.total < 1 ||
      value.covered !== value.total || value.pct !== 100 || value.skipped !== 0)
      throw new Error(`Coverage must be 100% for ${metric}: ${file}.`);
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'coverage') {
      const summary = verifyCoverage(args[0]);
      console.log(JSON.stringify(summary));
    } else if (command === 'verify') {
      const selected = args.length ? args : requiredProfiles;
      console.log(JSON.stringify(selected.map(profile => verifyExecution(profile)), null, 2));
    } else throw new Error('Usage: test-results.mjs coverage [summary] | verify [profiles...].');
  } catch (error) {
    console.error(`::error::Test evidence validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
