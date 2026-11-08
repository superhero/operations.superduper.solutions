// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { command } from './ci-browser.mjs';
import { browserResources } from './ci-browser-resources.mjs';
import { resolvePinnedBrowserImage } from './ci-browser-image.mjs';
import { prepareNativeRuntime, nativeRuntimeDockerArguments, nativeRuntimePin, nativeRuntimeSeccompPin } from './ci-native-runtime.mjs';
import { runContainerNativePreflight } from './ci-native-probe.mjs';

export async function runNativePreflightGate({ root = process.cwd(), run = command, resolveImage = resolvePinnedBrowserImage,
  prepareNative = prepareNativeRuntime, probe = runContainerNativePreflight, capacity, note = console.log } = {}) {
  const container = `operations-native-preflight-${randomUUID()}`, node = await realpath(process.execPath);
  let native, launchAttempted = false, evidence = { passed: false, phase: 'host-prepare', container };
  const output = resolve(root, 'tmp/test/ci/native-preflight.json');
  await mkdir(resolve(root, 'tmp/test/ci'), { recursive: true });
  const save = () => writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  try {
    const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
    if (process.version !== 'v' + manifest.engines.node) throw new Error('Native preflight requires the pinned project Node.');
    const image = await resolveImage({ root, run, pull: true }), resources = browserResources({ ...capacity, ci: true });
    native = await prepareNative({ run });
    evidence = { ...evidence, image, resources, runtime: { version: nativeRuntimePin.version,
      executableSha256: nativeRuntimePin.executable.sha256, sandboxSha256: nativeRuntimePin.sandbox.sha256,
      seccompSha256: nativeRuntimeSeccompPin.profileSha256 } };
    launchAttempted = true;
    const started = await run('docker', ['run', '--detach', '--init', '--name', container, '--network=none', '--read-only', '--shm-size=1g',
      `--cpus=${resources.cpus}`, `--memory=${resources.memoryBytes}`, `--memory-swap=${resources.memoryBytes}`, `--pids-limit=${resources.pids}`,
      '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', `${process.getuid()}:${process.getgid()}`,
      '--env', 'HOME=/tmp', '--env', 'XDG_DATA_HOME=/tmp/data', '--env', 'CI=true',
      '--env', `NODE_OPTIONS=--max-old-space-size=${resources.nodeHeapMiB}`, '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m',
      '--mount', `type=bind,source=${root},target=/workspace,readonly`,
      '--mount', `type=bind,source=${root}/tmp/test,target=/workspace/tmp/test`,
      '--mount', `type=bind,source=${node},target=/usr/local/bin/node,readonly`, ...nativeRuntimeDockerArguments(native.directory),
      '--workdir', '/workspace', image.image, 'node', '-e', 'setInterval(() => {}, 60000)'], { cwd: root, quiet: true, timeoutMs: 60_000 });
    if (started.code !== 0) throw new Error('Cannot start the isolated native preflight container.');
    evidence = { ...evidence, ...await probe({ run, container, root, note }) };
    if (!evidence.passed) throw new Error('The real native SDK sandbox preflight failed.');
    return evidence;
  } catch (error) {
    evidence.passed = false;
    evidence.failure ??= { code: 'NATIVE_PREFLIGHT_SETUP_FAILED' };
    throw error;
  } finally {
    let cleanupFailed = false;
    try {
      if (launchAttempted) {
        const removed = await run('docker', ['rm', '-f', container], { cwd: root, quiet: true, timeoutMs: 15_000 });
        if (removed.code !== 0) cleanupFailed = true;
      }
    } catch { cleanupFailed = true; }
    try { await native?.cleanup(); } catch { cleanupFailed = true; }
    if (cleanupFailed) {
      evidence.passed = false;
      evidence.cleanupFailure = { code: 'NATIVE_PREFLIGHT_CLEANUP_FAILED' };
      evidence.failure ??= evidence.cleanupFailure;
    }
    await save();
    if (cleanupFailed) throw new Error('Owned native preflight resources could not be removed.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await runNativePreflightGate(); }
  catch { console.error('::error::Real native SDK sandbox preflight failed; see its retained safe diagnostic.'); process.exitCode = 1; }
}
