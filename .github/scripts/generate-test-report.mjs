// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, stringify } from 'flatted';
import { hashFile, requiredProfiles, readResults, caseSignature, verifyCoverage, verifyExecution } from './test-results.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const identity = profile => profile === 'browser' ? 'browser-chromium' : profile;

// Blobs contain absolute paths, including file references in annotations and
// coverage maps. Relocate copies after validating the original execution proof;
// never rewrite the test evidence that was hashed by its producing job.
export function relocateBlob(serialized, featurePaths, destination = repository) {
  const blob = parse(serialized);
  if (!Array.isArray(blob) || blob[0] !== '5.0.5' || !Array.isArray(blob[1]) || blob[1].length === 0 || !Array.isArray(blob[2]))
    throw new Error('Unsupported, empty or malformed Vitest blob.');
  const roots = new Set();
  for (const file of blob[1]) {
    const feature = featurePaths.find(path => file.filepath?.replaceAll('\\', '/').endsWith(`/${path}`));
    if (!feature) throw new Error('Blob feature is absent from its execution manifest.');
    roots.add(file.filepath.replaceAll('\\', '/').slice(0, -feature.length - 1));
  }
  if (roots.size !== 1) throw new Error('A suite blob has ambiguous original roots.');
  const [origin] = roots;
  const seen = new Set();
  const relocate = value => typeof value === 'string' && value.startsWith(`${origin}/`)
    ? `${destination.replaceAll('\\', '/')}${value.slice(origin.length)}` : value;
  function visit(object) {
    if (!object || typeof object !== 'object' || seen.has(object)) return;
    seen.add(object);
    for (const [key, value] of Object.entries(object)) {
      const next = relocate(key);
      const replacement = relocate(value);
      if (next !== key) delete object[key];
      object[next] = replacement;
      visit(replacement);
    }
  }
  visit(blob);
  return stringify(blob);
}

export function generateReport(output = 'tmp/test/report', inputs = 'tmp/test/blobs', options = {}) {
  const root = options.root ?? repository;
  const directory = resolve(root, output);
  const blobs = resolve(root, inputs);
  const diagnostic = options.diagnostic ?? Boolean(process.env.REPORT_WARNING || process.env.REPORT_DIAGNOSTIC === '1');
  if (directory === root || !relative(root, directory).startsWith(`tmp/`) || directory === blobs || blobs.startsWith(`${directory}/`))
    throw new Error('Report output must be a dedicated directory below tmp, separate from its input blobs.');
  for (let ancestor = directory; ancestor !== root; ancestor = dirname(ancestor))
    if (existsSync(ancestor) && lstatSync(ancestor).isSymbolicLink()) throw new Error('Report output must not traverse symlinks.');
  rmSync(directory, { recursive: true, force: true });
  let staging;
  try {
    const names = readdirSync(blobs).filter(name => name.endsWith('.json')).sort();
    if (!names.length) throw new Error(`No suite blobs in ${blobs}.`);
    const inputDirectory = dirname(blobs);
    let verified = [];
    if (!diagnostic) {
      const expected = requiredProfiles.map(profile => `${identity(profile)}.json`).sort();
      if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Required suite blob set is incomplete or contains unexpected results.');
      verified = requiredProfiles.map(profile => verifyExecution(profile, relative(root, inputDirectory), { root }));
      if (new Set(verified.map(suite => suite.configFingerprint)).size !== 1 ||
        new Set(verified.map(suite => JSON.stringify(Object.entries(suite.dependencyVersions).sort()))).size !== 1)
        throw new Error('Suite configuration or installed toolchains differ.');
      verifyCoverage(join(inputDirectory, 'coverage/coverage-summary.json'));
    }
    mkdirSync(directory, { recursive: true });
    mkdirSync(join(root, 'tmp/test'), { recursive: true });
    staging = mkdtempSync(join(root, 'tmp/test/.merge-'));
    const hashes = Object.fromEntries(names.map(name => [name, hashFile(join(blobs, name))]));
    for (const name of names) {
      const proof = JSON.parse(readFileSync(join(inputDirectory, 'executions', name), 'utf8'));
      if (!Array.isArray(proof.featurePaths) || !proof.featurePaths.length) throw new Error(`Missing feature manifest for ${name}.`);
      writeFileSync(join(staging, name), relocateBlob(readFileSync(join(blobs, name), 'utf8'), proof.featurePaths, root));
    }
    const result = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'),
      '--config', join(root, 'tests/gherkin/merge.config.mjs'), `--merge-reports=${staging}`],
    { cwd: root, env: { ...process.env, OPERATIONS_REPORT_DIRECTORY: directory }, encoding: 'utf8', timeout: 120000,
      maxBuffer: 16 * 1024 * 1024 });
    if (result.error) throw result.error;
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    if (!existsSync(join(directory, 'index.html')) || !existsSync(join(directory, 'results.json')))
      throw new Error('Vitest did not produce a complete report entry and machine results.');
    for (const name of names) if (hashFile(join(blobs, name)) !== hashes[name]) throw new Error('Original suite evidence changed while merging.');
    if (!diagnostic && result.status !== 0) throw new Error(`Merged tests or coverage failed (exit ${result.status}).`);
    if (!diagnostic) {
      verifyCoverage(join(directory, 'coverage/coverage-summary.json'));
      const merged = readResults(join(directory, 'results.json'), { root });
      const expected = verified.flatMap(suite => suite.caseSignatures).sort();
      const actual = merged.cases.map(item => caseSignature(item, root)).sort();
      if (!merged.report.success || JSON.stringify(expected) !== JSON.stringify(actual))
        throw new Error('Merged report does not contain exactly the verified scenarios and steps.');
    }
    const provenance = { schemaVersion: 2, complete: !diagnostic, diagnostic,
      warning: diagnostic ? process.env.REPORT_WARNING || 'Diagnostic results do not certify complete successful validation.' : null,
      testedSha: process.env.REPORT_COMMIT ?? verified[0]?.head ?? null,
      runUrl: process.env.REPORT_RUN_URL ?? null,
      suites: verified.map(({ caseSignatures, ...suite }) => suite), inputHashes: hashes,
      mergeExitCode: result.status, generatedAt: new Date().toISOString() };
    writeFileSync(join(directory, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
    if (diagnostic) {
      const index = join(directory, 'index.html');
      const html = readFileSync(index, 'utf8');
      writeFileSync(index, html.replace(/<body([^>]*)>/i,
        `<body$1><aside role="alert" style="padding:1rem;background:#553b00;color:white">${escape(provenance.warning)}</aside>`));
    }
    return provenance;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(`Cannot generate test report '${directory}' from '${blobs}': ${error.message}`, { cause: error });
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [output, inputs, ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error('Usage: generate-test-report.mjs [output-directory] [blob-directory].');
    generateReport(output, inputs);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
