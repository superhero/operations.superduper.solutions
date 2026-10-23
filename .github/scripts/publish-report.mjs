// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inventory, validateManifestProvenance, validateReportEvidence } from './validation-artifacts.mjs';

const media = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8',
  gz: 'application/gzip', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', zip: 'application/zip', pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', webm: 'video/webm', mp4: 'video/mp4',
  wasm: 'application/wasm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp' };
export function verifyReportInventory(directory, manifest, expectedProvenance) {
  if (!expectedProvenance) throw new Error('Trusted validation provenance is required before publication.');
  validateManifestProvenance(manifest, expectedProvenance);
  const actual = inventory(directory);
  const expected = manifest.files?.['test-report'];
  if (!expected || JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(expected).sort())
    || Object.entries(actual).some(([path, digest]) => expected[path] !== digest))
    throw new Error('Report publication files differ from the original validation manifest.');
  validateReportEvidence(directory, manifest);
  return actual;
}
export function publicationPlan(directory, prefix, manifest, expectedProvenance) {
  if (!/^reports\/[a-f0-9]{40}-[1-9][0-9]*-[1-9][0-9]*$/.test(prefix))
    throw new Error('Report publication requires an immutable commit/run/attempt prefix.');
  const files = Object.keys(verifyReportInventory(directory, manifest, expectedProvenance));
  for (const required of ['index.html', 'ui/html.meta.json.gz', 'provenance.json', 'coverage/index.html'])
    if (!files.includes(required)) throw new Error(`Missing report publication input: ${required}`);
  return files.sort((a, b) => Number(a === 'index.html') - Number(b === 'index.html') || a.localeCompare(b))
    .map(path => ({ file: join(directory, path), key: `${prefix}/${path}`,
      type: media[path.split('.').at(-1).toLowerCase()] ?? 'application/octet-stream' }));
}
function runPublication(command, args, options) {
  return new Promise((resolveExit, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(command, args, { ...options, detached: grouped });
    const stop = signal => {
      try { if (grouped) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (error.code !== 'ESRCH') child.kill(signal); }
    };
    const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    const cleanup = () => {
      process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
    };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (status, signal) => { cleanup(); resolveExit({ status, signal }); });
  });
}
export async function publishReport(directory, prefix, { manifest, expectedProvenance, run = runPublication,
  guard = () => {}, note = () => {}, clock = () => performance.now(),
  pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms)) } = {}) {
  // Validate the entire file set before creating any external publication request.
  publicationPlan(directory, prefix, manifest, expectedProvenance);
  const temporary = mkdtempSync(join(tmpdir(), 'operations-report-publication-'));
  const publish = async (file, key, type) => {
    const result = await run('bash', ['.github/scripts/publish-status.sh', file, key, type], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Report publication failed at ${key}.`);
  };
  try {
    // Upload a verified snapshot. The downloaded tree is never rewritten, and
    // changes to it after this copy cannot change bytes during publication.
    const snapshot = join(temporary, 'report');
    cpSync(directory, snapshot, { recursive: true, dereference: false });
    const plan = publicationPlan(snapshot, prefix, manifest, expectedProvenance);
    // Pace starts below the R2 REST limit of 1,200 requests per five minutes.
    // https://developers.cloudflare.com/r2/platform/limits/#cloudflare-rest-api
    let starts = Promise.resolve(), lastStarted, failure;
    const upload = async (file, key, type) => {
      const turn = starts.then(async () => {
        if (failure) return {};
        const delay = lastStarted === undefined ? 0 : Math.max(0, 350 - (clock() - lastStarted));
        if (delay) await pause(delay);
        if (failure) return {};
        lastStarted = clock();
        return { operation: publish(file, key, type) };
      });
      starts = turn.then(() => {}, () => {});
      const { operation } = await turn;
      if (!operation) return false;
      await operation;
      return true;
    };
    const assets = plan.filter(item => item.key !== `${prefix}/index.html`);
    let next = 0, completed = 0;
    const worker = async () => {
      while (!failure && next < assets.length) {
        const item = assets[next++];
        try {
          if (await upload(item.file, item.key, item.type)) {
            completed++;
            if (completed % 100 === 0 || completed === assets.length)
              note(`Report assets uploaded: ${completed}/${assets.length}.`);
          }
        }
        catch (error) { failure ??= error; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, assets.length) }, worker));
    if (failure) throw failure;
    const entry = plan.find(item => item.key === `${prefix}/index.html`);
    await upload(entry.file, entry.key, entry.type);
    for (const badge of ['test-scenarios', 'test-coverage']) {
      for (const format of ['json', 'svg']) {
        const key = `badges/${badge}.${format}`;
        const item = plan.find(item => item.key === `${prefix}/${key}`);
        if (!item) throw new Error(`Missing validated publication badge: ${key}`);
        guard();
        await upload(item.file, key, item.type);
      }
    }
    // Publish stable pointers only after every immutable report asset exists.
    for (const [name, target] of [['test-coverage.html', `${prefix}/coverage/index.html`],
      ['test-report.html', `${prefix}/index.html`]]) {
      const file = join(temporary, name);
      const url = `/${target}`;
      writeFileSync(file, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${url}"><title>Test report</title><a href="${url}">Open test report</a>\n`);
      guard();
      await upload(file, name, 'text/html; charset=utf-8');
    }
    return plan;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [directory, prefix, manifestFile, ...extra] = process.argv.slice(2);
    if (!directory || !prefix || !manifestFile || extra.length) throw new Error('Usage: publish-report.mjs <report-directory> <reports/commit-run-attempt> <manifest-file>.');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const expectedProvenance = { repository: process.env.REPOSITORY,
      runId: Number(process.env.VALIDATION_RUN_ID), runAttempt: Number(process.env.VALIDATION_RUN_ATTEMPT),
      sourceSha: process.env.VALIDATION_SOURCE_SHA, testedSha: process.env.VALIDATION_TESTED_SHA };
    const guard = () => {
      if (!process.env.REPOSITORY || !process.env.MERGE_SHA) throw new Error('Current release identity is required before replacing report pointers.');
      const result = spawnSync('bash', ['.github/scripts/validate-current-release.sh', process.env.REPOSITORY, process.env.MERGE_SHA], { stdio: 'inherit' });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error('A newer release prevents replacing the report pointer.');
    };
    await publishReport(directory, prefix, { manifest, expectedProvenance, guard, note: message => console.log(message) });
  } catch (error) { console.error(`::error::${error.message}`); process.exitCode = 1; }
}
