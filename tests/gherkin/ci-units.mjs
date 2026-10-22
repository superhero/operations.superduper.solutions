// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { readFileSync, writeFileSync, mkdirSync, existsSync, lstatSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expectedCases, readResults, readBlobResults, caseSignature, hashFile } from '../../.github/scripts/test-results.mjs';
import { configurationFingerprint, installedToolchain } from './execution-fingerprint.mjs';
import { digest, same, sorted, sha256, commitSha, positive, filesBelow, policyVersion, validatePlan } from './ci-inputs.mjs';

export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const trustedWorkflows = new Set(['.github/workflows/ci-release.yml', '.github/workflows/ci-main.yml',
  '.github/workflows/ci-support.yml', '.github/workflows/test-develop.yml']);
export const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
export function writeJSON(path, value) { mkdirSync(resolve(path, '..'), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
export const unitDirectory = (unit, root = process.cwd()) => resolve(root, 'tmp/test/units', unit.id);

export function unitFiles(directory) {
  return filesBelow('.', directory).filter(path => path !== './receipt.json' && !/^\.\/(?:\.vite|browser\/\.runtime)\//.test(path))
    .map(path => path.slice(2)).sort().map(path => [path, hashFile(resolve(directory, path))]);
}

export function verifyUnitResults(directory, unit, { root = process.cwd(), toolchain, configFingerprint } = {}) {
  const resultFile = resolve(directory, 'vitest-browser-chromium.json');
  const blobFile = resolve(directory, 'blobs/browser-chromium.json');
  const proof = readJSON(resolve(directory, 'executions/browser-chromium.json'));
  const lifecycle = readJSON(resolve(directory, 'worker-lifecycle.json'));
  const { report, cases, ids } = readResults(resultFile, { root });
  const blob = readBlobResults(blobFile, unit.project, root, [unit.feature]);
  const inventory = expectedCases('browser', root);
  const expected = inventory.ids.filter(id => id.startsWith(`${unit.feature}:`)).sort();
  if (!same(expected, unit.expectedCaseIds) || !same([...ids].sort(), expected)
    || !same(cases.map(item => caseSignature(item, root)).sort(), blob.cases.map(item => caseSignature(item, root)).sort())
    || lifecycle.complete !== true || !Number.isFinite(Date.parse(lifecycle.finishedAt))
    || Date.parse(lifecycle.finishedAt) > Date.parse(proof.finishedAt)
    || report.success !== true || report.numFailedTestSuites !== 0 || proof.exitCode !== 0 || proof.filtered !== true || proof.complete !== false
    || proof.tagExpression !== '' || !same(proof.nameFilters, [])
    || proof.profile !== 'browser' || proof.project !== 'browser-chromium'
    || !same(proof.featurePaths, [unit.feature]) || !same(proof.expectedCaseIds, expected)
    || proof.resultHash !== hashFile(resultFile) || proof.blobHash !== hashFile(blobFile)
    || (configFingerprint && proof.configFingerprint !== configFingerprint)
    || (toolchain && !same(proof.dependencyVersions, toolchain))) throw new Error(`Incomplete unit evidence: ${unit.feature}`);
  for (const item of cases) {
    const id = `${unit.feature}:${item.meta.gherkin.exampleLine ?? item.meta.gherkin.line}`;
    if (item.status !== 'passed' || !same(item.meta.gherkin.steps.map(step => [step.text, step.line]), inventory.steps.get(id))
      || item.meta.gherkin.steps.some(step => step.status !== 'passed')) throw new Error(`Unit omits authored steps: ${id}`);
  }
  return { proof, cases, ids, resultHash: proof.resultHash, blobHash: proof.blobHash };
}

export function sealUnit(plan, unit, directory, { root = process.cwd(), environment = process.env } = {}) {
  validatePlan(plan);
  if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== plan.testedSha
    || configurationFingerprint(root) !== plan.shared.configFingerprint
    || !same(installedToolchain(root), plan.shared.toolchain)) throw new Error('Unit source or toolchain differs from plan.');
  const evidence = verifyUnitResults(directory, unit, { root, ...plan.shared });
  const { proof } = evidence;
  const runId = Number(environment.GITHUB_RUN_ID ?? plan.runId), runAttempt = Number(environment.GITHUB_RUN_ATTEMPT ?? plan.runAttempt);
  if (!positive(runId) || !positive(runAttempt) || runId !== plan.runId || Number(proof.runId) !== runId || Number(proof.runAttempt) !== runAttempt
    || proof.head !== plan.testedSha || !trustedWorkflows.has(environment.CI_WORKFLOW_FILE)) throw new Error('Unit producer differs from executing workflow.');
  const receipt = { schemaVersion: 1, policy: policyVersion, kind: 'browser-feature', id: unit.id, inputDigest: unit.inputDigest,
    feature: unit.feature, expectedCaseIds: unit.expectedCaseIds, project: unit.project, complete: true, exitCode: 0,
    startedAt: proof.startedAt, finishedAt: proof.finishedAt,
    producer: { repository: plan.repository, pullRequest: plan.pullRequest, sourceSha: plan.sourceSha,
      testedSha: plan.testedSha, runId, runAttempt, workflow: environment.CI_WORKFLOW_FILE },
    resultHash: evidence.resultHash, blobHash: evidence.blobHash, files: unitFiles(directory) };
  writeJSON(resolve(directory, 'receipt.json'), receipt);
  return receipt;
}

export function verifyReceipt(plan, unit, directory, { root = process.cwd(), now = Date.now(), allowCurrentRun = false } = {}) {
  const receiptFile = resolve(directory, 'receipt.json');
  if (!existsSync(receiptFile) || !lstatSync(receiptFile).isFile()) throw new Error('Missing regular unit receipt.');
  const receipt = readJSON(receiptFile), producer = receipt.producer;
  const finish = Date.parse(receipt.finishedAt), start = Date.parse(receipt.startedAt);
  if (receipt.schemaVersion !== 1 || receipt.policy !== policyVersion || receipt.kind !== 'browser-feature'
    || receipt.complete !== true || receipt.exitCode !== 0 || receipt.id !== unit.id || receipt.feature !== unit.feature
    || receipt.inputDigest !== unit.inputDigest || receipt.project !== unit.project || !same(receipt.expectedCaseIds, unit.expectedCaseIds)
    || !sha256(receipt.resultHash) || !sha256(receipt.blobHash) || !Array.isArray(receipt.files) || !receipt.files.length
    || !Number.isFinite(start) || !Number.isFinite(finish) || finish < start || finish > now + 60_000 || now - finish > MAX_AGE_MS
    || producer?.repository !== plan.repository || !commitSha(producer.testedSha) || !commitSha(producer.sourceSha)
    || !positive(producer.runId) || !positive(producer.runAttempt) || !trustedWorkflows.has(producer.workflow)
    || (unit.cacheable === false && producer.runId !== plan.runId)
    || (producer.pullRequest !== plan.pullRequest || (!plan.pullRequest && !(allowCurrentRun && producer.runId === plan.runId))))
    throw new Error(`Ineligible unit receipt: ${unit.feature}`);
  if (!same(unitFiles(directory), receipt.files)) throw new Error(`Unit artifacts differ from receipt: ${unit.feature}`);
  const evidence = verifyUnitResults(directory, unit, { root, ...plan.shared });
  if (evidence.proof.head !== producer.testedSha || Number(evidence.proof.runId) !== producer.runId
    || Number(evidence.proof.runAttempt) !== producer.runAttempt || evidence.resultHash !== receipt.resultHash || evidence.blobHash !== receipt.blobHash)
    throw new Error('Receipt and original execution provenance disagree.');
  if (receipt.startedAt !== evidence.proof.startedAt || receipt.finishedAt !== evidence.proof.finishedAt)
    throw new Error('Receipt cannot renew the original execution time.');
  return { receipt, ...evidence };
}

export function verifyBrowserAggregate(plan, directories, options = {}) {
  validatePlan(plan);
  if (directories.length !== plan.units.length || new Set(directories).size !== directories.length) throw new Error('Browser aggregate has missing or duplicate units.');
  const byId = new Map();
  for (const directory of directories) {
    const candidate = readJSON(resolve(directory, 'receipt.json'));
    const unit = plan.units.find(item => item.id === candidate.id);
    if (!unit || byId.has(unit.id)) throw new Error('Unexpected or duplicate browser unit.');
    byId.set(unit.id, { directory, unit, ...verifyReceipt(plan, unit, directory, { ...options, allowCurrentRun: true }) });
  }
  const ids = [...byId.values()].flatMap(item => item.ids).sort();
  const expected = expectedCases('browser', options.root).ids.sort();
  if (!same(ids, expected) || digest(ids) !== plan.inventoryDigest) throw new Error('Browser aggregate does not cover the current inventory.');
  return [...byId.values()];
}
