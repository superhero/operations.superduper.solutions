// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { expectedCases } from '../../.github/scripts/test-results.mjs';
import { configurationFingerprint, installedToolchain } from './execution-fingerprint.mjs';
import { browserProjectNameForFeature } from './browser-projects.mjs';
import { captureForTags } from '../browser/capture-policy.fixture.mjs';

export const policyVersion = 'operations-ci-units-v1';
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
export const sorted = values => [...new Set(values)].sort();
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const sha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const commitSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;

export function filesBelow(directory, root = process.cwd()) {
  const files = [];
  if (!existsSync(resolve(root, directory))) return files;
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (['node_modules', '.git', '.vite', '.runtime'].includes(entry.name)) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`CI input/output may not be a symlink: ${path}`);
    if (entry.isDirectory()) files.push(...filesBelow(path, root));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`CI input/output must be a regular file: ${path}`);
  }
  return files;
}
export function hashFiles(paths, root = process.cwd()) {
  return sorted(paths).map(path => {
    if (path.startsWith('/') || path.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Noncanonical CI input path.');
    const info = lstatSync(resolve(root, path));
    if (!info.isFile()) throw new Error(`CI input must be a regular file: ${path}`);
    return [path, digest(readFileSync(resolve(root, path))), info.mode & 0o111 ? '100755' : '100644'];
  });
}
export function trackedFiles(root = process.cwd()) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean);
}
export function sourceFingerprint(root = process.cwd()) {
  return digest(hashFiles(trackedFiles(root).filter(path => path !== 'CHANGELOG.md'), root));
}

// Literal imports and repository file references are explicit dependencies.
// Unbounded dynamic test imports conservatively include every browser module.
export function dependencyClosure(roots, root = process.cwd()) {
  const paths = new Set(), pending = [...roots];
  const add = path => { if (!paths.has(path)) pending.push(path); };
  while (pending.length) {
    const path = pending.pop();
    if (paths.has(path)) continue;
    paths.add(path);
    if (!/\.[cm]?[jt]s$/.test(path) || path.startsWith('src/') || path.startsWith('tests/gherkin/')) continue;
    const source = ts.createSourceFile(path, readFileSync(resolve(root, path), 'utf8'), ts.ScriptTarget.Latest, true);
    let unknownImport = false;
    function literal(value) {
      if (!value || !ts.isStringLiteralLike(value)) return;
      const name = value.text;
      if (!name.includes('/') || /[\0\r\n]/.test(name)) return;
      const candidates = name.startsWith('.') ? [resolve(root, dirname(path), name)] : [resolve(root, name)];
      for (const candidate of candidates) {
        const local = relative(root, candidate).replaceAll('\\', '/');
        if (!local.startsWith('../') && !local.startsWith('node_modules/') && existsSync(candidate) && lstatSync(candidate).isFile()) add(local);
      }
    }
    function visit(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) literal(node.moduleSpecifier);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        let parent = node.parent, browserEvaluation = false;
        while (parent) {
          if (ts.isCallExpression(parent) && /\.(?:evaluate|evaluateAll|addInitScript|waitForFunction)$/.test(parent.expression.getText(source))) browserEvaluation = true;
          parent = parent.parent;
        }
        if (ts.isStringLiteralLike(argument)) literal(argument);
        else if (!browserEvaluation && ts.isTemplateExpression(argument) && argument.head.text.startsWith('./') && argument.head.text.endsWith('/')) {
          const directory = relative(root, resolve(root, dirname(path), argument.head.text)).replaceAll('\\', '/');
          if (directory.startsWith('../')) throw new Error('Dynamic fixture escapes repository.');
          for (const file of filesBelow(directory, root)) add(file);
        } else if (!browserEvaluation) unknownImport = true;
      }
      // readFile(new URL(...)), file fixtures and browser-served references.
      if (ts.isStringLiteralLike(node)) literal(node);
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (unknownImport) {
      for (const file of filesBelow('tests/browser', root)) if (/\.[cm]?[jt]s$/.test(file)) add(file);
    }
  }
  return sorted(paths);
}

export function globalRegistrationModules(root = process.cwd()) {
  const registration = /^(Given|When|Then|defineStep|Before|After|BeforeAll|AfterAll|BeforeStep|AfterStep|setDefaultTimeout|setWorldConstructor|defineParameterType)$/;
  return filesBelow('tests/browser', root).filter(path => path.endsWith('.steps.mjs')).filter(path => {
    const file = ts.createSourceFile(path, readFileSync(resolve(root, path), 'utf8'), ts.ScriptTarget.Latest, true);
    function inert(value) {
      if (!value) return true;
      if (ts.isObjectLiteralExpression(value)) return value.properties.every(property => !(property.name && ts.isComputedPropertyName(property.name))
        && (ts.isPropertyAssignment(property) ? inert(property.initializer) : ts.isShorthandPropertyAssignment(property) || ts.isMethodDeclaration(property)));
      if (ts.isArrayLiteralExpression(value)) return value.elements.every(inert);
      if ([ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.FunctionExpression, ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NumericLiteral,
        ts.SyntaxKind.RegularExpressionLiteral, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword,
        ts.SyntaxKind.NullKeyword, ts.SyntaxKind.Identifier].includes(value.kind)) return true;
      // Only existing immutable lookups with inert, non-callback arguments are
      // known safe. Unknown nested calls/spreads/loops remain global inputs.
      return ts.isCallExpression(value) && /^(?:catalogForOperation|[A-Za-z_$][\w$]*\.slice)$/.test(value.expression.getText(file))
        && value.arguments.every(argument => inert(argument) && !ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument));
    }
    function safe(node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isFunctionDeclaration(node)) return true;
      if (ts.isVariableStatement(node)) return node.declarationList.declarations.every(declaration => inert(declaration.initializer));
      if (ts.isExpressionStatement(node)) return ts.isCallExpression(node.expression) && registration.test(node.expression.expression.getText(file));
      if (ts.isBlock(node)) return node.statements.every(safe);
      return false;
    }
    return file.statements.some(node => !safe(node));
  });
}

export function createPlan({ bindings, image, imageReference = `mcr.microsoft.com/playwright@${image}`, capture = 'full', repository, pullRequest = 0, sourceSha, testedSha,
  runId, runAttempt, timings = {}, root = process.cwd() }) {
  if (!commitSha(sourceSha) || !commitSha(testedSha) || !positive(runId) || !positive(runAttempt)
    || !/^[\w.-]+\/[\w.-]+$/.test(repository) || !['full', 'minimal'].includes(capture)
    || !/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Invalid CI plan identity.');
  const inventory = expectedCases('browser', root);
  if (!same(bindings.map(item => item.feature).sort(), inventory.features)) throw new Error('Binding and feature inventories differ.');
  const tracked = trackedFiles(root);
  const shared = sorted([
    ...tracked.filter(path => path.startsWith('src/') && !/\.(?:feature|test\.mjs)$/.test(path)),
    ...tracked.filter(path => /^(?:build\/|tests\/fixtures\/|\.github\/workflows\/|\.github\/actions\/ci-browser\/)/.test(path)),
    ...filesBelow('tests/gherkin', root),
    ...['package.json', 'package-lock.json', '.node-version', 'vite.config.mjs', 'coverage.config.json', 'vitest.config.mjs'],
    ...filesBelow('.github/scripts', root).filter(path => /(?:ci-|test-results|validation-artifacts|generate-test-report)/.test(path)),
  ]);
  const common = { policy: policyVersion, files: hashFiles(shared, root),
    bundle: hashFiles(filesBelow('dist', root), root), fixtures: hashFiles(['tmp/test/browser/fixture-bundles.json'], root),
    toolchain: installedToolchain(root), configFingerprint: configurationFingerprint(root), image, imageReference,
    runtime: { nodeHeapMiB: 512, cpu: 2, memoryGiB: 5, pids: 512, timezone: 'UTC', locale: 'en-US', capture } };
  const sharedDigest = digest(common);
  const globalModules = globalRegistrationModules(root);
  const units = bindings.map(binding => {
    const inputs = dependencyClosure([...binding.roots, ...globalModules], root);
    const entry = { id: digest(binding.feature).slice(0, 24), profile: 'browser', feature: binding.feature,
      project: browserProjectNameForFeature('browser-chromium', binding.feature),
      expectedCaseIds: inventory.ids.filter(id => id.startsWith(`${binding.feature}:`)).sort(),
      bindings: binding.cases, cacheable: !binding.cases.some(test => test.tags.includes('@ci-fresh')), modules: sorted([...binding.roots, ...globalModules]), inputs: hashFiles(inputs, root),
      sharedDigest, capture: captureForTags(binding.cases.flatMap(test => test.tags), capture), featureDigest: digest(readFileSync(resolve(root, binding.feature))), duration: timings[binding.feature]?.duration ?? 60_000,
      previousFailure: timings[binding.feature]?.failed === true };
    entry.inputDigest = digest({ sharedDigest, feature: [[binding.feature, entry.featureDigest]], inputs: entry.inputs,
      bindings: entry.bindings, project: entry.project, capture: entry.capture });
    return entry;
  });
  const loads = [0, 0, 0];
  const batches = [{ id: 'library', workers: 1, units: [] }, ...[0, 1, 2].map(index => ({ id: `application-${index + 1}`, workers: 2, units: [] }))];
  const ordered = [...units].sort((a, b) => Number(b.previousFailure) - Number(a.previousFailure) || b.duration - a.duration || a.feature.localeCompare(b.feature));
  for (const unit of ordered) {
    if (unit.project.endsWith('-service-library')) batches[0].units.push(unit.id);
    else { const index = loads.indexOf(Math.min(...loads)); batches[index + 1].units.push(unit.id); loads[index] += unit.duration; }
  }
  return { schemaVersion: 1, policy: policyVersion, repository, pullRequest: Number(pullRequest), sourceSha, testedSha,
    runId: Number(runId), runAttempt: Number(runAttempt), createdAt: new Date().toISOString(),
    sourceFingerprint: sourceFingerprint(root), shared: common, sharedDigest,
    inventoryDigest: digest(inventory.ids.sort()), units, batches };
}

export function validatePlan(plan) {
  if (plan?.schemaVersion !== 1 || plan.policy !== policyVersion || !sha256(plan.sharedDigest)
    || digest(plan.shared) !== plan.sharedDigest || !commitSha(plan.testedSha) || !commitSha(plan.sourceSha)
    || !positive(plan.runId) || !positive(plan.runAttempt) || !Array.isArray(plan.units) || !plan.units.length
    || !Array.isArray(plan.batches) || plan.batches.length !== 4) throw new Error('Invalid CI unit plan.');
  const ids = plan.units.map(unit => unit.id);
  const reused = plan.reusedUnits?.map(unit => unit.id) ?? [];
  const assigned = [...plan.batches.flatMap(batch => batch.units), ...reused];
  const cases = plan.units.flatMap(unit => unit.expectedCaseIds ?? []).sort();
  if (ids.length !== new Set(ids).size || assigned.length !== new Set(assigned).size || !same([...ids].sort(), [...assigned].sort())
    || cases.length !== new Set(cases).size || digest(cases) !== plan.inventoryDigest
    || plan.units.some(unit => unit.id !== digest(unit.feature).slice(0, 24) || !sha256(unit.inputDigest)
      || unit.cacheable !== !unit.bindings.some(test => test.tags.includes('@ci-fresh'))
      || !sha256(unit.featureDigest) || unit.inputDigest !== digest({ sharedDigest: unit.sharedDigest, feature: [[unit.feature, unit.featureDigest]], inputs: unit.inputs, bindings: unit.bindings, project: unit.project, capture: unit.capture })
      || !unit.expectedCaseIds?.length || unit.sharedDigest !== plan.sharedDigest
      || unit.profile !== 'browser' || !unit.feature.startsWith('tests/browser/') || !unit.feature.endsWith('.feature')))
    throw new Error('Incomplete or duplicated CI unit plan.');
  return plan;
}

export function verifyPlanInputs(plan, root = process.cwd()) {
  validatePlan(plan);
  if (sourceFingerprint(root) !== plan.sourceFingerprint
    || configurationFingerprint(root) !== plan.shared.configFingerprint
    || !same(hashFiles(plan.shared.files.map(([path]) => path), root), plan.shared.files)
    || !same(hashFiles(filesBelow('dist', root), root), plan.shared.bundle)
    || !same(hashFiles(plan.shared.fixtures.map(([path]) => path), root), plan.shared.fixtures))
    throw new Error('Prepared CI inputs differ from the current source, build or fixtures.');
  return plan;
}
