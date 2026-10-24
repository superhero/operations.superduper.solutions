// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validatePlan, filesBelow, digest, same } from '../../tests/gherkin/ci-inputs.mjs';
import { readJSON, writeJSON, unitDirectory, verifyReceipt } from '../../tests/gherkin/ci-units.mjs';
import { artifactOperation, discoverUnitArtifacts, githubRead, publishUnit, restoreUnit, restoreFailureDiagnostic } from './ci-unit-cache.mjs';
import { browserResources } from './ci-browser-resources.mjs';

export async function command(program, args, { cwd = process.cwd(), quiet = false, timeoutMs = 60_000, env = process.env } = {}) {
  return new Promise((resolveDone, reject) => {
    const child = spawn(program, args, { cwd, env, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let output = '';
    if (quiet) { child.stdout.on('data', data => { if (output.length < 64_000) output += data; }); child.stderr.resume(); }
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.once('error', () => { clearTimeout(timer); reject(new Error(`Cannot start ${program}.`)); });
    child.once('close', code => { clearTimeout(timer); resolveDone({ code: timedOut ? 124 : code ?? 1, output: output.trim() }); });
  });
}

export async function unchangedSourceInputs(plan, head, { api = githubRead } = {}) {
  if (head === plan.sourceSha) return true;
  async function entries(sha) {
    const commit = await api(`repos/${plan.repository}/git/commits/${sha}`);
    if (!/^[a-f0-9]{40}$/.test(commit.tree?.sha ?? '')) throw new Error('Invalid source tree.');
    const tree = await api(`repos/${plan.repository}/git/trees/${commit.tree.sha}`);
    if (tree.truncated !== false || !Array.isArray(tree.tree)) throw new Error('Incomplete source tree.');
    if (tree.tree.some(entry => entry.path === 'CHANGELOG.md' && (entry.mode !== '100644' || entry.type !== 'blob'))) return undefined;
    return tree.tree.filter(entry => entry.path !== 'CHANGELOG.md').map(({ mode, type, path, sha }) => [path, mode, type, sha]).sort();
  }
  const [before, after] = await Promise.all([entries(plan.sourceSha), entries(head)]);
  return before !== undefined && after !== undefined && same(before, after);
}

export function orderedMisses(units, artifacts) {
  const latest = new Map();
  for (const artifact of artifacts) if (!latest.has(artifact.unitId)) latest.set(artifact.unitId, artifact.kind);
  return [...units].sort((a, b) => Number(latest.get(b.id) === 'failure' || b.previousFailure)
    - Number(latest.get(a.id) === 'failure' || a.previousFailure) || b.duration - a.duration || a.feature.localeCompare(b.feature));
}

export async function runBatch({ root = process.cwd(), batchId, node, api = githubRead,
  run = command, operation = artifactOperation, environment = process.env, capacity, signal, note = console.log } = {}) {
  const started = Date.now(), plan = validatePlan(readJSON(resolve(root, 'tmp/test/ci/plan.json')));
  const batch = plan.batches.find(item => item.id === batchId);
  if (!batch || !['library', 'application-1', 'application-2', 'application-3'].includes(batchId)) throw new Error('Unknown browser batch.');
  if (execFileSync(node, ['--version'], { encoding: 'utf8' }).trim() !== plan.shared.toolchain.node) throw new Error('CI batch must use the pinned project Node.');
  const ownName = `operations-ci-${plan.runId}-${environment.GITHUB_RUN_ATTEMPT}-${batchId}-${randomUUID().slice(0, 8)}`;
  const summary = { schemaVersion: 1, batch: batchId, testedSha: plan.testedSha, startedAt: new Date().toISOString(),
    fresh: 0, reused: 0, failed: 0, unfinished: 0, units: [], lookupMilliseconds: 0 };
  let container = false, launchAttempted = false, stale = false, stopping = signal?.aborted === true, checking, timer, forceTimer;
  const active = new Set();
  const deadline = Date.now() + 120_000;
  const artifacts = await discoverUnitArtifacts(plan, { api, deadline, currentOnly: true, note });
  const misses = [];
  for (const unit of plan.units.filter(item => batch.units.includes(item.id))) {
    const hit = await restoreUnit(plan, unit, artifacts, { root, deadline, operation, note });
    if (hit) { summary.reused++; summary.units.push({ id: unit.id, feature: unit.feature, ...hit }); }
    else misses.push(unit);
  }
  summary.lookupMilliseconds = Date.now() - started;
  const queue = orderedMisses(misses, artifacts);
  async function stopOwnedWork() {
    if (!container) return;
    const signal = `const fs=require('node:fs');for(const id of ${JSON.stringify([...active])}){try{const pid=Number(fs.readFileSync('/tmp/ci-unit-'+id+'.pid','utf8'));if(pid>1)process.kill(pid,'SIGTERM')}catch{}}`;
    await run('docker', ['exec', ownName, 'node', '-e', signal], { cwd: root, quiet: true, timeoutMs: 5000 });
    forceTimer ??= setTimeout(() => { void run('docker', ['kill', ownName], { cwd: root, quiet: true, timeoutMs: 10_000 }); }, 15_000);
  }
  function checkHead() {
    if (!plan.pullRequest || stale) return Promise.resolve();
    if (checking) return checking;
    checking = (async () => { try {
      const pr = await api(`repos/${plan.repository}/pulls/${plan.pullRequest}`);
      if (pr.number !== plan.pullRequest || pr.head?.repo?.full_name !== plan.repository || pr.state !== 'open' || pr.draft !== false || pr.merged === true
        || !await unchangedSourceInputs(plan, pr.head.sha, { api })) {
        stale = true; note('Prepared PR inputs are obsolete; stopping validation and retaining published units.');
        await stopOwnedWork();
      }
    } catch { stale = true; note('Cannot confirm current PR inputs; validation cannot certify integration.'); await stopOwnedWork(); }
    finally { checking = undefined; } })();
    return checking;
  }
  async function failedEvidence(unit) {
    try {
      const directory = unitDirectory(unit, root);
      const files = filesBelow('.', directory).map(file => resolve(directory, file));
      if (!files.length) return;
      const name = `ci-failure-v1-pr${plan.pullRequest}-${unit.id}-${unit.inputDigest}-r${plan.runId}-a${environment.GITHUB_RUN_ATTEMPT}`;
      await operation({ command: 'upload', name, files, directory }, { root, timeoutMs: 60_000 });
    }
    catch { note(`Failure diagnostics could not be published for ${unit.feature}.`); }
  }
  async function work() {
    while (queue.length && !stale && !stopping) {
      const unit = queue.shift(), unitStarted = Date.now(); active.add(unit.id);
      let outcome;
      try {
        const result = await run('docker', ['exec', ownName, 'node', 'tests/gherkin/ci.mjs', 'unit', unit.id],
          { cwd: root, timeoutMs: 40 * 60_000 });
        if (result.code === 124) { stopping = true; await stopOwnedWork(); }
        if (result.code !== 0) throw new Error('Feature process failed.');
        const published = await publishUnit(plan, unit, { root, operation, environment });
        summary.fresh++;
        outcome = { id: unit.id, feature: unit.feature, ...published, duration: Date.now() - unitStarted };
        note(`Completed and published ${unit.feature}: ${unit.expectedCaseIds.length} cases.`);
      } catch {
        summary.failed++;
        outcome = { id: unit.id, feature: unit.feature, failed: true, duration: Date.now() - unitStarted };
        await failedEvidence(unit);
      } finally { active.delete(unit.id); }
      summary.units.push(outcome);
    }
  }
  const cancel = () => { stopping = true; void stopOwnedWork().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    await checkHead();
    if (queue.length && !stale && !stopping) {
      if (!/^mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}$/.test(plan.shared.imageReference)) throw new Error('Missing immutable browser image reference.');
      note(`Preparing the pinned browser image for ${queue.length} outstanding features.`);
      const pull = await run('docker', ['pull', plan.shared.imageReference], { cwd: root, quiet: true, timeoutMs: 300_000 });
      const inspected = await run('docker', ['image', 'inspect', plan.shared.imageReference, '--format', '{{.Id}}'], { cwd: root, quiet: true });
      if (pull.code !== 0 || inspected.code !== 0 || inspected.output !== plan.shared.image) throw new Error('Browser image differs from the prepared runtime.');
      await checkHead();
      if (stale || stopping) throw new Error('Browser validation inputs became obsolete or execution was cancelled.');
      const uid = execFileSync('id', ['-u'], { encoding: 'utf8' }).trim(), gid = execFileSync('id', ['-g'], { encoding: 'utf8' }).trim();
      mkdirSync(resolve(root, 'tmp/test'), { recursive: true });
      const resources = browserResources({ ...capacity, ci: true });
      summary.resourceBudget = resources;
      launchAttempted = true;
      const result = await run('docker', ['run', '--detach', '--init', '--name', ownName,
        '--label', `operations.ci.run=${plan.runId}`, '--network=none', '--read-only', '--shm-size=1g',
        `--cpus=${resources.cpus}`, `--memory=${resources.memoryBytes}`, `--memory-swap=${resources.memoryBytes}`,
        `--pids-limit=${resources.pids}`, '--cap-drop=ALL', '--security-opt=no-new-privileges',
        '--user', `${uid}:${gid}`, '--env', 'HOME=/tmp', '--env', 'XDG_DATA_HOME=/tmp/data', '--env', 'CI=true',
        '--env', 'GITHUB_ACTIONS=true', '--env', `GITHUB_RUN_ID=${plan.runId}`, '--env', `GITHUB_RUN_ATTEMPT=${environment.GITHUB_RUN_ATTEMPT}`,
        '--env', `CI_WORKFLOW_FILE=${environment.CI_WORKFLOW_FILE}`, '--env', 'NODE_OPTIONS=--max-old-space-size=512',
        '--env', `BROWSER_TEST_IMAGE=${plan.shared.image}`, '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m',
        '--mount', `type=bind,source=${root},target=/workspace,readonly`,
        '--mount', `type=bind,source=${root}/tmp/test,target=/workspace/tmp/test`,
        '--mount', `type=bind,source=${node},target=/usr/local/bin/node,readonly`, '--workdir', '/workspace',
        plan.shared.image, 'node', '-e', 'setInterval(() => {}, 60000)'], { cwd: root, quiet: true, timeoutMs: 60_000 });
      if (result.code !== 0) throw new Error('Cannot start the bounded browser batch.');
      container = true;
      if (stopping) await stopOwnedWork();
      timer = setInterval(() => { void checkHead(); }, 30_000);
      await Promise.all(Array.from({ length: batch.workers }, work));
      await checkHead();
    }
  } finally {
    clearInterval(timer);
    if (checking) await checking;
    clearTimeout(forceTimer);
    signal?.removeEventListener('abort', cancel);
    if (launchAttempted) {
      const counters = await run('docker', ['exec', ownName, 'node', '-e',
        "const fs=require('node:fs');for(const name of ['memory.max','memory.peak','memory.events','cpu.stat'])try{console.log(name+':'+fs.readFileSync('/sys/fs/cgroup/'+name,'utf8'))}catch{}"],
      { cwd: root, quiet: true, timeoutMs: 5000 });
      summary.resourceCounters = counters.output;
      await run('docker', ['rm', '-f', ownName], { cwd: root, quiet: true, timeoutMs: 15_000 });
    }
    summary.unfinished = queue.length; summary.obsolete = stale; summary.finishedAt = new Date().toISOString();
    summary.wallMilliseconds = Date.now() - started;
    writeJSON(resolve(root, `tmp/test/ci/batch-${batchId}.json`), summary);
    if (environment.GITHUB_STEP_SUMMARY) appendFileSync(environment.GITHUB_STEP_SUMMARY,
      `\n### Browser ${batchId}\n\nFresh: ${summary.fresh}; reused: ${summary.reused}; failed: ${summary.failed}; unfinished: ${summary.unfinished}.\n`);
  }
  if (stale || stopping || summary.failed || summary.unfinished) throw new Error(`Browser ${batchId} did not complete current validation.`);
  return summary;
}

export async function restoreBrowserUnits({ root = process.cwd(), api = githubRead, operation = artifactOperation, note = console.log } = {}) {
  const plan = validatePlan(readJSON(resolve(root, 'tmp/test/ci/plan.json'))), deadline = Date.now() + 120_000;
  const pending = [], restored = [], missing = [];
  for (const unit of plan.units) {
    try {
      const verified = verifyReceipt(plan, unit, unitDirectory(unit, root), { root, allowCurrentRun: true });
      restored.push({ id: unit.id, reused: true, producer: verified.receipt.producer });
    } catch { pending.push(unit); }
  }
  const artifacts = pending.length ? await discoverUnitArtifacts(plan, { api, deadline, currentOnly: true, note }) : [];
  async function work() {
    while (pending.length) {
      const unit = pending.shift(), result = await restoreUnit(plan, unit, artifacts, { root, deadline, operation, note });
      if (result) restored.push({ id: unit.id, ...result });
      else { missing.push(unit.feature); await restoreFailureDiagnostic(plan, unit, artifacts, { root, deadline, operation, note }); }
    }
  }
  await Promise.all([work(), work()]);
  // The diagnostic merger can display every available original case even when
  // the strict aggregate is incomplete. These files confer no passing status.
  for (const unit of plan.units) {
    const source = unitDirectory(unit, root);
    if (existsSync(resolve(source, 'blobs/browser-chromium.json')) && existsSync(resolve(source, 'executions/browser-chromium.json'))) {
      for (const directory of ['blobs', 'executions']) {
        mkdirSync(resolve(root, 'tmp/test', directory), { recursive: true });
        cpSync(resolve(source, directory, 'browser-chromium.json'), resolve(root, 'tmp/test', directory, `ci-unit-${unit.id}.json`));
      }
    }
  }
  writeJSON(resolve(root, 'tmp/test/ci/selection.json'), { schemaVersion: 1, restored, missing });
  if (missing.length) throw new Error(`Required browser results are outstanding: ${missing.join(', ')}`);
  return restored;
}


// Verify before scheduling: a cache hit should avoid starting a GitHub runner batch.
export async function prepareCachedUnits({ root = process.cwd(), api = githubRead, operation = artifactOperation, outputFile = process.env.GITHUB_OUTPUT, note = console.log } = {}) {
  const plan = validatePlan(readJSON(resolve(root, 'tmp/test/ci/plan.json'))), deadline = Date.now() + 120_000;
  const artifacts = await discoverUnitArtifacts(plan, { api, deadline, note });
  const pending = [...plan.units], reused = [];
  async function work() {
    while (pending.length) {
      const unit = pending.shift(), result = await restoreUnit(plan, unit, artifacts, { root, deadline, operation, note });
      if (result) reused.push({ id: unit.id, ...result });
    }
  }
  await Promise.all([work(), work()]);
  const hits = new Set(reused.map(item => item.id));
  const misses = orderedMisses(plan.units.filter(unit => !hits.has(unit.id)), artifacts);
  const loads = [0, 0, 0];
  for (const batch of plan.batches) batch.units = [];
  for (const unit of misses) {
    if (unit.project.endsWith('-service-library')) plan.batches[0].units.push(unit.id);
    else { const index = loads.indexOf(Math.min(...loads)); plan.batches[index + 1].units.push(unit.id); loads[index] += unit.duration; }
  }
  plan.reusedUnits = reused;
  validatePlan(plan);
  writeJSON(resolve(root, 'tmp/test/ci/plan.json'), plan);
  const batches = plan.batches.filter(batch => batch.units.length).map(batch => batch.id);
  if (outputFile) appendFileSync(outputFile,
    `matrix=${JSON.stringify({ batch: batches.length ? batches : ['none'] })}\nhas_work=${batches.length > 0}\nhas_reused=${reused.length > 0}\n`);
  note(`Verified cache: ${reused.length} reusable features; ${misses.length} features scheduled across ${batches.length} GitHub jobs.`);
  return plan;
}
