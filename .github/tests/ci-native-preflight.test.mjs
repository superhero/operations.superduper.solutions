// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import './support.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { parseDocument } from 'yaml';
import { nativeSandboxContext, classifyNativeSandboxFailure, probeNativeSandbox, runContainerNativePreflight } from '../scripts/ci-native-probe.mjs';
import { resolvePinnedBrowserImage } from '../scripts/ci-browser-image.mjs';
import { runNativePreflightGate } from '../scripts/ci-native-preflight.mjs';

const image = `sha256:${'a'.repeat(64)}`, imageReference = `mcr.microsoft.com/playwright@sha256:${'b'.repeat(64)}`;
const status = 'Uid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\nCapEff:\t0000000000000000\nCapPrm:\t0000000000000000\nCapBnd:\t0000000000000000\nNoNewPrivs:\t1\nSeccomp:\t2\n';
const readContext = async path => path.endsWith('/status') ? status : path.endsWith('/current') ? 'docker-default (enforce)\n' : '1\n';
const marker = 'OPERATIONS_NATIVE_PREFLIGHT ';
const apparmorMetadata = { name: 'owned-native-profile', state: 'enforcing', profilePath: '/owned/qualified-runtime/native-apparmor' };
const apparmorFixture = (cleanup = async () => {}) => ({ name: apparmorMetadata.name, metadata: apparmorMetadata,
  dockerArguments: ['--security-opt', `apparmor=${apparmorMetadata.name}`],
  async cleanup(options) { assert.deepEqual(options, { containerAbsent: true }); await cleanup(); } });

Then('the native preflight verifies persisted command output and redacts failure context', async function () {
  const lifecycle = [], records = [];
  const fixture = { directory: '/owned/directory', home: '/owned/directory/home', workspace: '/owned/directory/workspace',
    events: [{ method: 'item/completed', params: { item: { type: 'commandExecution', exitCode: 0, aggregatedOutput: 'OWNED_STORED_THREAD_HISTORY' } } }],
    async seed() { lifecycle.push('seed'); return { threadId: 'owned-thread', turn: { status: 'completed' } }; },
    async call(method, params) { lifecycle.push(method); assert.deepEqual(params, { threadId: 'owned-thread', includeTurns: true });
      return { thread: { id: 'owned-thread', history: 'OWNED_STORED_THREAD_HISTORY' } }; },
    async close() { lifecycle.push('close'); } };
  const result = await probeNativeSandbox({ createFixture: async () => fixture, read: readContext, emit: value => records.push(value) });
  assert.equal(result.passed, true); assert.deepEqual(lifecycle, ['seed', 'thread/read', 'close']);
  assert.equal(result.context.apparmor, 'docker-default (enforce)');
  assert.equal(result.context.process.CapEff, '0000000000000000'); assert.equal(result.context.process.NoNewPrivs, '1');
  assert.deepEqual(records.map(record => record.kind), ['context', 'result']);
  const privateValue = 'OWNED_PRIVATE_DIAGNOSTIC_VALUE';
  const error = new Error(`Owned SDK request rejected: bwrap: No permissions to create a new namespace ${fixture.home} Bearer ${privateValue}`);
  const failure = classifyNativeSandboxFailure(error, fixture);
  assert.equal(failure.code, 'NATIVE_NAMESPACE_DENIED'); assert.match(failure.detail, /No permissions to create a new namespace/);
  for (const message of ['bwrap: Failed to make / slave: Permission denied', 'bwrap: rslave propagation failed', 'bwrap: pivot_root: Operation not permitted'])
    assert.equal(classifyNativeSandboxFailure(new Error(message)).code, 'NATIVE_MOUNT_DENIED');
  assert.ok(!JSON.stringify(failure).includes(fixture.home)); assert.ok(!JSON.stringify(failure).includes(privateValue));
  assert.deepEqual(classifyNativeSandboxFailure(new Error(privateValue)), { code: 'NATIVE_SDK_SEED_FAILED' });
  let closed = 0;
  const denied = await probeNativeSandbox({ createFixture: async () => ({ async seed() { throw error; }, async close() { closed++; } }),
    read: readContext, emit: () => {} });
  assert.equal(denied.passed, false); assert.equal(denied.phase, 'sdk-store-seed'); assert.equal(closed, 1);
  const failedCommand = await probeNativeSandbox({ createFixture: async () => ({ ...fixture,
    async seed() { return { threadId: 'owned-thread', turn: { status: 'failed' } }; } }), read: readContext, emit: () => {} });
  assert.equal(failedCommand.passed, false);
  const missingOutput = await probeNativeSandbox({ createFixture: async () => ({ ...fixture, events: [] }), read: readContext, emit: () => {} });
  assert.equal(missingOutput.passed, false);
  const unavailable = await nativeSandboxContext(async () => { throw new Error(privateValue); });
  assert.equal(unavailable.apparmor, 'unavailable'); assert.ok(!JSON.stringify(unavailable).includes(privateValue));
  const unsafe = await probeNativeSandbox({ createFixture: async () => assert.fail('An unsafe boundary must not start the SDK.'),
    read: async path => path.endsWith('/status') ? status.replace('CapEff:\t0000000000000000', 'CapEff:\t0000000000200000') : '1', emit: () => {} });
  assert.equal(unsafe.passed, false); assert.equal(unsafe.failure.code, 'NATIVE_PREFLIGHT_BOUNDARY_FAILED');
});

Then('container native probes require complete evidence and enforce the fifteen second deadline', async function () {
  for (const [code, result, expected] of [[0, { passed: true }, true], [1, { passed: false, failure: { code: 'NATIVE_NAMESPACE_DENIED' } }, false],
    [124, null, false], [0, null, false], [1, { passed: true }, false]]) {
    const records = [marker + JSON.stringify({ kind: 'context', context: { apparmor: 'docker-default (enforce)' } })];
    if (result) records.push(marker + JSON.stringify({ kind: 'result', phase: 'sdk-store-seed', ...result }));
    const evidence = await runContainerNativePreflight({ container: 'owned-preflight', note: () => {}, run: async (program, args, options) => {
      assert.equal(program, 'docker'); assert.deepEqual(args, ['exec', 'owned-preflight', 'timeout', '--signal=TERM', '--kill-after=2s', '15s',
        'node', '.github/scripts/ci-native-probe.mjs']);
      assert.equal(options.timeoutMs, 22_000); assert.equal(options.quiet, true);
      return { code, output: records.join('\n') };
    } });
    assert.equal(evidence.passed, expected);
    if (code === 124) assert.equal(evidence.failure.code, 'NATIVE_PREFLIGHT_DEADLINE');
    if (code === 0 && !result) assert.equal(evidence.failure.code, 'NATIVE_PREFLIGHT_EVIDENCE_MISSING');
  }
});

Then('native qualification resolves only the exact declared browser image and its registry digest', async function () {
  const root = this.automation.root;
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { '@playwright/test': '1.63.0' } }));
  const calls = [];
  const run = async (program, args) => { calls.push([program, args]); return { code: 0,
    output: args.includes('{{.Id}}') ? image : args.includes('{{json .RepoDigests}}') ? JSON.stringify([imageReference]) : '' }; };
  assert.deepEqual(await resolvePinnedBrowserImage({ root, run, pull: true }), { image, imageReference });
  assert.deepEqual(calls[0], ['docker', ['pull', 'mcr.microsoft.com/playwright:v1.63.0-noble']]);
  await assert.rejects(resolvePinnedBrowserImage({ root, run: async () => ({ code: 1 }) }), /verify/);
  await assert.rejects(resolvePinnedBrowserImage({ root, run: async (program, args) => ({ code: 0,
    output: args.includes('{{.Id}}') ? image : JSON.stringify(['untrusted.example/browser@sha256:' + 'b'.repeat(64)]) }) }), /immutable/);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ devDependencies: { '@playwright/test': '^1.63.0' } }));
  await assert.rejects(resolvePinnedBrowserImage({ root, run }), /exact Playwright/);
});

Then('a failed native sandbox gate retains evidence and cleans its isolated runtime', async function () {
  const root = this.automation.root, lifecycle = [], calls = [];
  writeFileSync(join(root, 'package.json'), JSON.stringify({ engines: { node: process.versions.node } }));
  await assert.rejects(runNativePreflightGate({ root, note: () => {}, capacity: { cpus: 4, memoryBytes: 16 * 1024 ** 3 },
    resolveImage: async options => { assert.equal(options.pull, true); return { image, imageReference }; },
    prepareNative: async () => ({ directory: '/owned/qualified-runtime', cleanup: async () => lifecycle.push('cleanup') }),
    prepareAppArmor: async () => apparmorFixture(async () => lifecycle.push('apparmor-cleanup')),
    probe: async () => { lifecycle.push('probe'); return { passed: false, phase: 'sdk-store-seed', failure: { code: 'NATIVE_NAMESPACE_DENIED' } }; },
    run: async (program, args) => { calls.push([program, args]); lifecycle.push(args[0]); return { code: 0 }; },
  }), /sandbox preflight failed/);
  assert.deepEqual(lifecycle, ['run', 'probe', 'rm', 'apparmor-cleanup', 'cleanup']);
  const start = calls[0][1];
  for (const arg of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=512',
    'PATH=/opt/operations-ci-native/codex-resources:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    image, `apparmor=${apparmorMetadata.name}`, 'type=bind,source=/owned/qualified-runtime,target=/opt/operations-ci-native,readonly']) assert.ok(start.includes(arg), arg);
  assert.ok(!start.some(arg => /GH_TOKEN|ACTIONS_RUNTIME_TOKEN|privileged|unconfined|cap-add/.test(arg)));
  const evidence = JSON.parse(readFileSync(join(root, 'tmp/test/ci/native-preflight.json'), 'utf8'));
  assert.equal(evidence.passed, false); assert.equal(evidence.failure.code, 'NATIVE_NAMESPACE_DENIED');
  assert.deepEqual(evidence.runtime.apparmor, apparmorMetadata);
});

Then('all validation preparation jobs gate expensive checks on the real native sandbox', function () {
  for (const name of ['ci-release.yml', 'ci-main.yml', 'ci-support.yml', 'test-develop.yml']) {
    const document = parseDocument(readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8'));
    assert.deepEqual(document.errors, [], name);
    const job = document.toJS().jobs['validation-prepare'], steps = job.steps;
    const install = steps.findIndex(step => step.run?.includes('npm ci'));
    const preflight = steps.findIndex(step => step.run === 'node .github/scripts/ci-native-preflight.mjs');
    const typecheck = steps.findIndex(step => step.run?.includes('run typecheck'));
    const source = steps.findIndex(step => step.run?.includes('run test:source'));
    assert.ok(install >= 0 && preflight > install && typecheck > preflight && source > preflight, name);
    assert.equal(steps[preflight].if, steps[install].if, name);
    assert.notEqual(steps[preflight]['continue-on-error'], true); assert.notEqual(job['continue-on-error'], true);
    const evidence = steps.find(step => step.with?.path === 'tmp/test/ci/native-preflight.json');
    assert.match(evidence.if, /always\(\)/); assert.match(evidence.if, /native-preflight\.outcome/);
    assert.match(evidence.uses, /^actions\/upload-artifact@/);
  }
});

Then('native preflight cleanup failures fail the gate and preserve its diagnostic', async function () {
  const root = this.automation.root;
  writeFileSync(join(root, 'package.json'), JSON.stringify({ engines: { node: process.versions.node } }));
  for (const failure of ['container status', 'container transport', 'native files']) {
    let cleanupCalls = 0, removalCalls = 0, profileCleanupCalls = 0;
    await assert.rejects(runNativePreflightGate({ root, note: () => {}, capacity: { cpus: 4, memoryBytes: 16 * 1024 ** 3 },
      resolveImage: async () => ({ image, imageReference }),
      prepareNative: async () => ({ directory: '/owned/qualified-runtime', cleanup: async () => {
        cleanupCalls++; if (failure === 'native files') throw new Error('Owned cleanup failure.');
      } }),
      prepareAppArmor: async () => apparmorFixture(async () => { profileCleanupCalls++; }),
      probe: async () => ({ passed: true, phase: 'sdk-store-seed', context: { apparmor: `${apparmorMetadata.name} (enforce)` } }),
      run: async (program, args) => {
        if (args[0] === 'rm') { removalCalls++; if (failure === 'container transport') throw new Error('Owned Docker transport failure.');
          return { code: failure === 'container status' ? 1 : 0 }; }
        return { code: 0 };
      },
    }), /resources could not be removed/);
    const removed = failure === 'native files';
    assert.equal(cleanupCalls, removed ? 1 : 0); assert.equal(profileCleanupCalls, removed ? 1 : 0); assert.equal(removalCalls, 1);
    const evidence = JSON.parse(readFileSync(join(root, 'tmp/test/ci/native-preflight.json'), 'utf8'));
    assert.equal(evidence.passed, false); assert.equal(evidence.failure.code, 'NATIVE_PREFLIGHT_CLEANUP_FAILED');
    assert.equal(evidence.cleanupFailure.code, 'NATIVE_PREFLIGHT_CLEANUP_FAILED');
    if (!removed) assert.deepEqual(evidence.retainedRuntime, { directory: '/owned/qualified-runtime', apparmor: apparmorMetadata });
  }
});

Then('native AppArmor load and unload uncertainty retains its owned profile files', async function () {
  const root = this.automation.root;
  writeFileSync(join(root, 'package.json'), JSON.stringify({ engines: { node: process.versions.node } }));
  for (const failure of ['unknown load', 'failed unload', 'wrong active profile']) {
    let assetsRemoved = 0, unloads = 0, launches = 0;
    const loadMetadata = { ...apparmorMetadata, state: 'load-failed', retained: true };
    await assert.rejects(runNativePreflightGate({ root, note: () => {}, capacity: { cpus: 4, memoryBytes: 16 * 1024 ** 3 },
      resolveImage: async () => ({ image, imageReference }),
      prepareNative: async () => ({ directory: '/owned/qualified-runtime', cleanup: async () => { assetsRemoved++; } }),
      prepareAppArmor: async () => {
        if (failure === 'unknown load') throw Object.assign(new Error('Owned profile load outcome unknown.'), { nativeAppArmor: loadMetadata });
        return apparmorFixture(async () => { unloads++; if (failure === 'failed unload') throw new Error('Owned profile unload failed.'); });
      },
      probe: async () => ({ passed: true, phase: 'sdk-store-seed', context: {
        apparmor: failure === 'wrong active profile' ? 'docker-default (enforce)' : `${apparmorMetadata.name} (enforce)` } }),
      run: async (program, args) => { if (args[0] === 'run') launches++; return { code: 0 }; },
    }), /resources could not be removed|sandbox preflight failed/);
    const evidence = JSON.parse(readFileSync(join(root, 'tmp/test/ci/native-preflight.json'), 'utf8'));
    assert.equal(evidence.passed, false);
    if (failure === 'wrong active profile') {
      assert.equal(evidence.failure.code, 'NATIVE_PREFLIGHT_APPARMOR_MISMATCH');
      assert.equal(assetsRemoved, 1); assert.equal(unloads, 1); assert.equal(evidence.retainedRuntime, undefined);
    } else {
      assert.equal(assetsRemoved, 0); assert.equal(launches, failure === 'unknown load' ? 0 : 1);
      assert.equal(unloads, failure === 'unknown load' ? 0 : 1);
      assert.deepEqual(evidence.retainedRuntime, { directory: '/owned/qualified-runtime',
        apparmor: failure === 'unknown load' ? loadMetadata : apparmorMetadata });
    }
  }
});
