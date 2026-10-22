// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { filesBelow, positive, commitSha } from '../../tests/gherkin/ci-inputs.mjs';
import { verifyReceipt, unitDirectory, writeJSON, readJSON, trustedWorkflows, MAX_AGE_MS } from '../../tests/gherkin/ci-units.mjs';

export async function githubRead(endpoint, { token = process.env.GH_TOKEN, timeoutMs = 10_000 } = {}) {
  if (!endpoint.startsWith('repos/') || /[\r\n]/.test(endpoint)) throw new Error('Invalid GitHub read endpoint.');
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (Date.now() >= deadline) throw new Error('GitHub read deadline exceeded.');
    let response;
    try {
      response = await fetch(`https://api.github.com/${endpoint}`, { headers: { authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
    } catch {
      if (attempt === 2) throw new Error('GitHub read unavailable.');
    }
    if (response?.ok) {
      const text = await response.text();
      if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('Oversized GitHub read.');
      try { return JSON.parse(text); } catch { throw new Error('Invalid GitHub read response.'); }
    }
    if (response && (!(response.status >= 500) || response.headers.has('retry-after') || response.headers.get('x-ratelimit-remaining') === '0'))
      throw new Error('GitHub read rejected.');
    if (attempt === 2) throw new Error('GitHub read unavailable.');
    await new Promise(resolveWait => setTimeout(resolveWait, Math.min((attempt + 1) * 1000, Math.max(0, deadline - Date.now()))));
  }
}

function trustedUnitSource(run, plan) {
  return positive(run?.id) && trustedWorkflows.has(run.path?.split('@')[0]) && commitSha(run.head_sha)
    && run.repository?.full_name === plan.repository && run.head_repository?.full_name === plan.repository
    && positive(run.repository.id) && run.head_repository.id === run.repository.id
    && (Number(run.id) === plan.runId || run.event === 'pull_request')
    && ['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'].includes(run.status);
}
export function trustedUnitRun(run, plan, associations = run?.pull_requests) {
  return trustedUnitSource(run, plan) && (Number(run.id) === plan.runId || (plan.pullRequest > 0
    && Array.isArray(associations) && associations.some(pr => pr.number === plan.pullRequest
      && pr.base?.repo?.id === run.repository.id && pr.head?.repo?.id === run.repository.id)));
}

export async function discoverUnitArtifacts(plan, { api = githubRead, now = Date.now, deadline = now() + 120_000, currentOnly = false, note = console.log } = {}) {
  const artifacts = [], runs = new Map();
  const request = endpoint => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Unit lookup budget exhausted.');
    return api(endpoint, { timeoutMs: Math.min(10_000, remaining) });
  };
  const candidates = [plan.runId];
  try {
    if (plan.pullRequest > 0 && !currentOnly) {
      const pr = await request(`repos/${plan.repository}/pulls/${plan.pullRequest}`);
      if (pr.number !== plan.pullRequest || pr.head?.repo?.full_name !== plan.repository || typeof pr.head.ref !== 'string') throw new Error('PR identity changed.');
      const response = await request(`repos/${plan.repository}/actions/runs?event=pull_request&branch=${encodeURIComponent(pr.head.ref)}&per_page=30`);
      if (!Array.isArray(response.workflow_runs)) throw new Error('Invalid workflow history.');
      for (const run of response.workflow_runs) if (trustedUnitSource(run, plan) && run.head_branch === pr.head.ref && now() - Date.parse(run.created_at) <= MAX_AGE_MS) {
        runs.set(run.id, run); candidates.push(run.id);
      }
    }
    for (const id of [...new Set(candidates)].slice(0, 10)) {
      const run = runs.get(id) ?? await request(`repos/${plan.repository}/actions/runs/${id}`);
      let associated = run.pull_requests;
      if (!trustedUnitRun(run, plan, associated) && trustedUnitSource(run, plan) && plan.pullRequest > 0) {
        // GitHub often leaves workflow-run pull_requests empty, even for a PR run.
        associated = await request(`repos/${plan.repository}/commits/${run.head_sha}/pulls?per_page=100`);
      }
      if (!trustedUnitRun(run, plan, associated)) continue;
      runs.set(id, run);
      for (let page = 1; page <= 10; page++) {
        const result = await request(`repos/${plan.repository}/actions/runs/${id}/artifacts?per_page=100&page=${page}`);
        if (!Array.isArray(result.artifacts) || result.artifacts.length > 100) throw new Error('Invalid unit artifact inventory.');
        for (const artifact of result.artifacts) {
          const match = /^ci-(unit|failure)-v1-pr(\d+)-([a-f0-9]{24})-([a-f0-9]{64})-r(\d+)-a(\d+)$/.exec(artifact.name ?? '');
          if (!match || Number(match[2]) !== plan.pullRequest || Number(match[5]) !== id || !positive(match[6])
            || Number(match[6]) > run.run_attempt
            || artifact.expired !== false || !positive(artifact.id) || artifact.workflow_run?.id !== id
            || artifact.workflow_run?.head_repository_id !== run.repository.id
            || artifact.workflow_run?.head_sha !== run.head_sha || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? '')) continue;
          artifacts.push({ ...artifact, kind: match[1], unitId: match[3], inputDigest: match[4], runId: id, runAttempt: Number(match[6]), workflow: run.path.split('@')[0] });
        }
        if (result.artifacts.length < 100) break;
      }
    }
  } catch { note('Unit lookup incomplete or unavailable; missing results will execute.'); }
  return artifacts.sort((a, b) => b.id - a.id);
}

export async function artifactOperation(input, { root = process.cwd(), timeoutMs = 30_000, node = process.execPath } = {}) {
  const directory = resolve(root, 'tmp/test/ci/artifact-operations');
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, `${randomUUID()}.json`);
  writeJSON(file, input);
  try {
    await new Promise((resolveDone, reject) => {
      const child = spawn(node, [resolve(root, '.github/scripts/ci-artifact.mjs'), file],
        { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      // Never expose SDK diagnostics containing signed URLs or authentication data.
      child.stdout.resume(); child.stderr.resume();
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.once('error', error => { clearTimeout(timer); reject(new Error('Artifact subprocess unavailable.', { cause: error })); });
      child.once('close', code => { clearTimeout(timer); code === 0 ? resolveDone() : reject(new Error('Artifact operation failed or exceeded its deadline.')); });
    });
    return readJSON(`${file}.result`);
  } finally { rmSync(file, { force: true }); rmSync(`${file}.result`, { force: true }); }
}

export async function restoreUnit(plan, unit, artifacts, { root = process.cwd(), now = Date.now, deadline = now() + 120_000,
  operation = artifactOperation, note = console.log } = {}) {
  for (const artifact of artifacts.filter(item => item.kind !== 'failure' && item.inputDigest === unit.inputDigest
    && (unit.cacheable !== false || item.runId === plan.runId))) {
    if (now() >= deadline) break;
    const parent = resolve(root, 'tmp/test/ci/downloads'); mkdirSync(parent, { recursive: true });
    const temporary = mkdtempSync(resolve(parent, 'unit-'));
    try {
      await operation({ command: 'download', id: artifact.id, runId: artifact.runId, repository: plan.repository,
        digest: artifact.digest, directory: temporary }, { root, timeoutMs: Math.min(30_000, deadline - now()) });
      const verified = verifyReceipt(plan, unit, temporary, { root, now: now(), allowCurrentRun: true });
      if (verified.receipt.producer.runId !== artifact.runId || verified.receipt.producer.runAttempt !== artifact.runAttempt
        || verified.receipt.producer.workflow !== artifact.workflow) throw new Error('Artifact producer differs from receipt.');
      const target = unitDirectory(unit, root);
      rmSync(target, { recursive: true, force: true }); mkdirSync(resolve(target, '..'), { recursive: true });
      cpSync(temporary, target, { recursive: true, errorOnExist: true });
      verifyReceipt(plan, unit, target, { root, now: now(), allowCurrentRun: true });
      note(`Reused ${unit.feature}: ${unit.expectedCaseIds.length} cases from run ${artifact.runId}, attempt ${artifact.runAttempt}.`);
      return { artifactId: artifact.id, reused: true, producer: verified.receipt.producer };
    } catch { note(`Unit cache miss for ${unit.feature}: evidence unavailable, expired or invalid.`); }
    finally { rmSync(temporary, { recursive: true, force: true }); }
  }
  return undefined;
}

export async function publishUnit(plan, unit, { root = process.cwd(), operation = artifactOperation, environment = process.env } = {}) {
  const directory = unitDirectory(unit, root), verified = verifyReceipt(plan, unit, directory, { root, allowCurrentRun: true });
  const { producer } = verified.receipt;
  if (producer.runId !== plan.runId || producer.runAttempt !== Number(environment.GITHUB_RUN_ATTEMPT ?? plan.runAttempt)
    || producer.testedSha !== plan.testedSha) throw new Error('Only a freshly completed current unit may be published.');
  const name = `ci-unit-v1-pr${plan.pullRequest}-${unit.id}-${unit.inputDigest}-r${producer.runId}-a${producer.runAttempt}`;
  const files = [...verified.receipt.files.map(([path]) => resolve(directory, path)), resolve(directory, 'receipt.json')];
  const uploaded = await operation({ command: 'upload', name, files, directory }, { root, timeoutMs: 60_000 });
  if (!positive(uploaded.id) || !/^(?:sha256:)?[a-f0-9]{64}$/.test(uploaded.digest ?? '')) throw new Error('Unit publication did not return verified identity.');
  return { artifactId: uploaded.id, artifactDigest: uploaded.digest, reused: false, producer };
}

// Diagnostics never supply reusable receipts. Restrict downloads to the current
// run and current unit inputs, then retain their original native blob and proof.
export async function restoreFailureDiagnostic(plan, unit, artifacts, { root = process.cwd(), deadline = Date.now() + 120_000,
  operation = artifactOperation, note = console.log } = {}) {
  const artifact = artifacts.find(item => item.kind === 'failure' && item.runId === plan.runId && item.unitId === unit.id && item.inputDigest === unit.inputDigest);
  if (!artifact || Date.now() >= deadline) return;
  const parent = resolve(root, 'tmp/test/ci/downloads'); mkdirSync(parent, { recursive: true });
  const temporary = mkdtempSync(resolve(parent, 'diagnostic-'));
  try {
    await operation({ command: 'download', id: artifact.id, runId: artifact.runId, repository: plan.repository,
      digest: artifact.digest, directory: temporary }, { root, timeoutMs: Math.min(30_000, deadline - Date.now()) });
    filesBelow('.', temporary); // Reject symlinks and irregular extracted outputs.
    const proof = readJSON(resolve(temporary, 'executions/browser-chromium.json'));
    if (proof.head !== plan.testedSha || Number(proof.runId) !== plan.runId || Number(proof.runAttempt) !== artifact.runAttempt
      || JSON.stringify(proof.featurePaths) !== JSON.stringify([unit.feature])) throw new Error('Unrelated failure diagnostics.');
    const target = unitDirectory(unit, root);
    rmSync(target, { recursive: true, force: true }); cpSync(temporary, target, { recursive: true });
    rmSync(resolve(target, 'receipt.json'), { force: true });
    return target;
  } catch { note(`Combined diagnostics unavailable for ${unit.feature}; its separate failure artifact remains available.`); }
  finally { rmSync(temporary, { recursive: true, force: true }); }
}
