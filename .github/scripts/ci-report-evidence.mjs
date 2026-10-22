// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Built-in-only verification for complete, previously certified publication.
// Fresh certification additionally parses authored Gherkin and native blobs.
import { readFileSync, lstatSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(JSON.stringify(value));
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hex = value => /^[a-f0-9]{64}$/.test(value ?? '');
const sha = value => /^[a-f0-9]{40}$/.test(value ?? '');
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const workflows = new Set(['.github/workflows/ci-release.yml', '.github/workflows/ci-main.yml', '.github/workflows/ci-support.yml', '.github/workflows/test-develop.yml']);
function regular(root, path) {
  if (typeof path !== 'string' || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid published evidence path.');
  let current = root;
  for (const part of path.split('/')) { current = resolve(current, part); if (lstatSync(current).isSymbolicLink()) throw new Error('Published evidence cannot traverse a symlink.'); }
  if (!lstatSync(current).isFile()) throw new Error('Published evidence must be a regular file.');
  return current;
}

export function verifyPublishedBrowserEvidence(directory, provenance, { testedSha, runId, runAttempt }) {
  const planPath = regular(directory, 'evidence/browser-plan.json'), plan = read(planPath);
  if (plan.schemaVersion !== 1 || plan.policy !== 'operations-ci-units-v1' || plan.testedSha !== testedSha
    || provenance.evidencePlanHash !== hash(readFileSync(planPath)) || plan.sharedDigest !== digest(plan.shared)
    || !hex(plan.sharedDigest) || !Array.isArray(plan.units) || !plan.units.length) throw new Error('Invalid published browser plan.');
  const browser = provenance.suites.find(suite => suite.profile === 'browser');
  if (browser?.evidenceKind !== 'feature-units' || browser.head !== testedSha || String(browser.runId) !== String(runId)
    || String(browser.runAttempt) !== String(runAttempt) || !Array.isArray(browser.units) || browser.units.length !== plan.units.length
    || browser.configFingerprint !== plan.shared.configFingerprint || !same(browser.dependencyVersions, plan.shared.toolchain))
    throw new Error('Invalid browser aggregate provenance.');
  const ids = [], units = new Set();
  for (const unit of plan.units) {
    if (unit.id !== hash(unit.feature).slice(0, 24) || units.has(unit.id) || !Array.isArray(unit.expectedCaseIds) || !unit.expectedCaseIds.length
      || unit.sharedDigest !== plan.sharedDigest || unit.inputDigest !== digest({ sharedDigest: unit.sharedDigest,
        feature: [[unit.feature, unit.featureDigest]], inputs: unit.inputs, bindings: unit.bindings, project: unit.project, capture: unit.capture }))
      throw new Error('Invalid browser unit key or identity.');
    units.add(unit.id); ids.push(...unit.expectedCaseIds);
    const record = browser.units.find(item => item.id === unit.id);
    const prefix = `evidence/browser/${unit.id}/`, file = regular(directory, `${prefix}receipt.json`), receipt = read(file);
    if (!record || record.receiptHash !== hash(readFileSync(file)) || receipt.schemaVersion !== 1 || receipt.policy !== plan.policy
      || receipt.kind !== 'browser-feature' || receipt.id !== unit.id || receipt.feature !== unit.feature || receipt.project !== unit.project
      || receipt.inputDigest !== unit.inputDigest || receipt.complete !== true || receipt.exitCode !== 0
      || !same(receipt.expectedCaseIds, unit.expectedCaseIds) || !same(record.producer, receipt.producer)
      || receipt.producer.repository !== plan.repository || receipt.producer.pullRequest !== plan.pullRequest
      || !sha(receipt.producer.testedSha) || !sha(receipt.producer.sourceSha) || !workflows.has(receipt.producer.workflow)
      || !positive(receipt.producer.runId) || !positive(receipt.producer.runAttempt) || !Array.isArray(receipt.files)
      || (unit.cacheable === false && receipt.producer.runId !== plan.runId)
      || !Number.isFinite(Date.parse(receipt.finishedAt)) || Date.parse(receipt.finishedAt) > Date.now() + 60_000
      || Date.now() - Date.parse(receipt.finishedAt) > 7 * 24 * 60 * 60 * 1000)
      throw new Error('Published receipt or producer does not match its unit.');
    for (const [path, expected] of receipt.files) if (!hex(expected) || hash(readFileSync(regular(directory, `${prefix}${path}`))) !== expected)
      throw new Error('Published unit file differs from its original receipt.');
    const proof = read(regular(directory, `${prefix}executions/browser-chromium.json`));
    const lifecycle = read(regular(directory, `${prefix}worker-lifecycle.json`));
    if (proof.head !== receipt.producer.testedSha || Number(proof.runId) !== receipt.producer.runId || Number(proof.runAttempt) !== receipt.producer.runAttempt
      || lifecycle.complete !== true || !Number.isFinite(Date.parse(lifecycle.finishedAt)) || Date.parse(lifecycle.finishedAt) > Date.parse(proof.finishedAt)
      || proof.exitCode !== 0 || proof.filtered !== true || proof.complete !== false || proof.tagExpression !== '' || !same(proof.nameFilters, [])
      || receipt.startedAt !== proof.startedAt || receipt.finishedAt !== proof.finishedAt
      || hash(readFileSync(regular(directory, `${prefix}vitest-browser-chromium.json`))) !== receipt.resultHash
      || hash(readFileSync(regular(directory, `${prefix}blobs/browser-chromium.json`))) !== receipt.blobHash
      || provenance.inputHashes[`units/${unit.id}.json`] !== receipt.blobHash)
      throw new Error('Published unit provenance or native blob differs.');
  }
  if (new Set(ids).size !== ids.length || digest(ids.sort()) !== plan.inventoryDigest || ids.length !== browser.cases
    || new Set(browser.units.map(unit => unit.id)).size !== browser.units.length)
    throw new Error('Published browser inventory is incomplete or duplicated.');
  return browser;
}
