// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { readJSON, writeJSON, verifyBrowserAggregate } from '../../tests/gherkin/ci-units.mjs';
import { verifyPlanInputs, same } from '../../tests/gherkin/ci-inputs.mjs';
import { verifyExecution, verifyCoverage, hashFile, readResults, caseSignature, requiredProfiles } from './test-results.mjs';

export function generateIncrementalReport({ root, directory, inputDirectory, mergeTimeout, relocateBlob }) {
  const aggregate = readJSON(join(inputDirectory, 'ci/browser-aggregate.json')), plan = aggregate.plan;
  verifyPlanInputs(plan, root);
  if (process.env.GITHUB_RUN_ID && Number(process.env.GITHUB_RUN_ID) !== plan.runId) throw new Error('Incremental plan belongs to a different workflow run.');
  if (plan.testedSha !== process.env.REPORT_COMMIT && process.env.REPORT_COMMIT) throw new Error('Incremental report target differs from planned inputs.');
  const units = verifyBrowserAggregate(plan, aggregate.units.map(unit => resolve(root, unit.directory)), { root });
  const profiles = requiredProfiles.filter(profile => profile !== 'browser');
  const verified = profiles.map(profile => verifyExecution(profile, relative(root, inputDirectory), { root, allowPreviousAttempt: true }));
  if (verified.some(suite => suite.head !== plan.testedSha || suite.configFingerprint !== plan.shared.configFingerprint
    || !same(suite.dependencyVersions, plan.shared.toolchain))) throw new Error('Profiles and feature units differ in revision, harness or toolchain.');
  verifyCoverage(join(inputDirectory, 'coverage/coverage-summary.json'));
  mkdirSync(directory, { recursive: true });
  const staging = mkdtempSync(join(root, 'tmp/test/.incremental-merge-'));
  const inputs = new Map();
  try {
    for (const suite of verified) {
      const file = join(inputDirectory, 'blobs', `${suite.project}.json`), proof = readJSON(join(inputDirectory, 'executions', `${suite.project}.json`));
      inputs.set(`${suite.project}.json`, { file, hash: hashFile(file) });
      writeFileSync(join(staging, `${suite.project}.json`), relocateBlob(readFileSync(file, 'utf8'), proof.featurePaths, root));
    }
    for (const item of units) {
      const name = `units/${item.unit.id}.json`, file = join(item.directory, 'blobs/browser-chromium.json');
      inputs.set(name, { file, hash: hashFile(file) });
      writeFileSync(join(staging, `unit-${item.unit.id}.json`), relocateBlob(readFileSync(file, 'utf8'), [item.unit.feature], root));
    }
    const result = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), '--configLoader', 'native', '--config', join(root, 'tests/gherkin/merge.config.mjs'),
      `--merge-reports=${staging}`], { cwd: root, env: { ...process.env, OPERATIONS_REPORT_DIRECTORY: directory },
      encoding: 'utf8', timeout: mergeTimeout, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 });
    process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
    if (result.error || result.status !== 0) throw new Error('Incremental native report merge failed or exceeded its deadline.');
    for (const { file, hash } of inputs.values()) if (hashFile(file) !== hash) throw new Error('Original report evidence changed during merge.');
    verifyCoverage(join(directory, 'coverage/coverage-summary.json'));
    const merged = readResults(join(directory, 'results.json'), { root });
    const signatures = [...verified.flatMap(suite => suite.caseSignatures), ...units.flatMap(item => item.cases.map(test => caseSignature(test, root)))].sort();
    if (!merged.report.success || !same(merged.cases.map(test => caseSignature(test, root)).sort(), signatures))
      throw new Error('Incremental report omits or changes required scenarios or steps.');
    const runId = Number(process.env.GITHUB_RUN_ID ?? plan.runId), runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? plan.runAttempt);
    const browser = { profile: 'browser', project: 'browser-chromium', evidenceKind: 'feature-units',
      head: plan.testedSha, runId, runAttempt, cases: units.reduce((sum, item) => sum + item.ids.length, 0),
      resultHash: hashFile(join(inputDirectory, 'vitest-browser-chromium.json')),
      configFingerprint: plan.shared.configFingerprint, dependencyVersions: plan.shared.toolchain,
      units: units.map(item => ({ id: item.unit.id, inputDigest: item.unit.inputDigest,
        receiptHash: hashFile(join(item.directory, 'receipt.json')), producer: item.receipt.producer })) };
    browser.freshCases = units.filter(item => item.receipt.producer.runId === runId && item.receipt.producer.runAttempt === runAttempt).reduce((sum, item) => sum + item.ids.length, 0);
    browser.reusedCases = browser.cases - browser.freshCases;
    for (const item of units) {
      const target = join(directory, 'evidence/browser', item.unit.id);
      for (const path of [...item.receipt.files.map(([path]) => path), 'receipt.json']) {
        mkdirSync(resolve(target, path, '..'), { recursive: true });
        cpSync(resolve(item.directory, path), resolve(target, path));
      }
    }
    writeJSON(join(directory, 'evidence/browser-plan.json'), plan);
    const provenance = { schemaVersion: 3, complete: true, diagnostic: false, warning: null,
      testedSha: plan.testedSha, runId, runAttempt, runUrl: process.env.REPORT_RUN_URL ?? null,
      suites: [...verified.map(({ caseSignatures, ...suite }) => suite), browser],
      evidencePlanHash: hashFile(join(directory, 'evidence/browser-plan.json')),
      inputHashes: Object.fromEntries([...inputs].map(([name, item]) => [name, item.hash])), mergeExitCode: 0, generatedAt: new Date().toISOString() };
    writeJSON(join(directory, 'provenance.json'), provenance);
    const index = join(directory, 'index.html');
    writeFileSync(index, readFileSync(index, 'utf8').replace(/<body([^>]*)>/i,
      `<body$1><aside role="status" style="padding:1rem">Browser cases: ${browser.freshCases} newly executed, ${browser.reusedCases} reused. Original producer evidence is retained.</aside>`));
    return provenance;
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
