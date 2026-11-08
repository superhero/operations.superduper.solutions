// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nativeRuntimePin } from './ci-native-runtime.mjs';
import { captureNativeAppArmorAudit } from './ci-native-audit.mjs';

const marker = 'OPERATIONS_NATIVE_PREFLIGHT ';
const sysctls = Object.freeze({
  unprivilegedUsernsClone: '/proc/sys/kernel/unprivileged_userns_clone',
  apparmorRestrictUnprivilegedUserns: '/proc/sys/kernel/apparmor_restrict_unprivileged_userns',
  maxUserNamespaces: '/proc/sys/user/max_user_namespaces',
});

export async function selectedNativeBwrap({ environment = process.env, stat = lstat, read = readFile } = {}) {
  const executable = environment.OPERATIONS_CODEX_QUALIFICATION_BINARY;
  if (typeof executable !== 'string' || !isAbsolute(executable)) return { state: 'unavailable' };
  const directory = join(dirname(executable), 'codex-resources'), path = join(directory, 'bwrap');
  if (environment.PATH?.split(':')[0] !== directory) return { state: 'unexpected-path', path };
  try {
    const info = await stat(path);
    if (!info.isFile() || !(info.mode & 0o111) || info.size !== nativeRuntimePin.sandbox.bytes) return { state: 'unavailable', path };
    const bytes = await read(path), sha256 = createHash('sha256').update(bytes).digest('hex');
    return { state: 'selected', path, sha256, pinned: sha256 === nativeRuntimePin.sandbox.sha256 };
  } catch { return { state: 'unavailable', path }; }
}

export async function nativeSandboxContext(read = readFile, bwrap = selectedNativeBwrap) {
  const safeRead = async path => { try { return (await read(path, 'utf8')).trim(); } catch { return 'unavailable'; } };
  const status = await safeRead('/proc/self/status'), values = {};
  for (const name of ['Uid', 'Gid', 'CapEff', 'CapPrm', 'CapBnd', 'NoNewPrivs', 'Seccomp']) {
    const value = status.match(new RegExp(`^${name}:\\s*([0-9a-f\\t ]+)$`, 'm'))?.[1];
    values[name] = value?.trim() ?? 'unavailable';
  }
  const label = await safeRead('/proc/self/attr/current');
  const apparmor = /^[\w\s/.:()=-]{1,180}$/.test(label) ? label : 'unavailable';
  const userNamespaces = {};
  for (const [name, path] of Object.entries(sysctls)) {
    const value = await safeRead(path); userNamespaces[name] = /^\d{1,20}$/.test(value) ? value : 'unavailable';
  }
  return { apparmor, process: values, userNamespaces, bwrap: await bwrap(), containerPid: process.pid };
}

export function classifyNativeSandboxFailure(error, fixture) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const bwrap = message.match(/\bbwrap:\s*([^\r\n]{1,700})/)?.[1];
  if (bwrap) {
    let detail = 'bwrap: ' + bwrap;
    for (const path of [fixture?.directory, fixture?.home, fixture?.workspace].filter(Boolean)) detail = detail.replaceAll(path, '<owned-path>');
    detail = detail.replace(/\/[\w./:@%+=,-]+/g, '<path>')
      .replace(/\b(?:bearer|token|password|secret|api[_-]?key|authorization)\s*[:= ]\s*[^\s;,]+/gi, '<redacted>')
      .replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 700);
    return { code: /namespace|uid map|gid map/i.test(bwrap) ? 'NATIVE_NAMESPACE_DENIED'
      : /mount|pivot_root|rslave|failed to make.*\bslave\b/i.test(bwrap) ? 'NATIVE_MOUNT_DENIED' : 'NATIVE_SANDBOX_FAILED', detail };
  }
  return { code: /timed out|deadline/i.test(message) ? 'NATIVE_PREFLIGHT_DEADLINE'
    : /binary|digest|pin|executable|version/i.test(message) ? 'NATIVE_RUNTIME_IDENTITY_FAILED' : 'NATIVE_SDK_SEED_FAILED' };
}

/** Only owned local SDK data and a fixed printf command; no login or inference. */
export async function probeNativeSandbox({ createFixture, read, emit = value => console.log(marker + JSON.stringify(value)) } = {}) {
  const context = await nativeSandboxContext(read); emit({ kind: 'context', context });
  let fixture, result, phase = 'fixture-create';
  try {
    const boundary = context.process;
    if (!boundary.Uid.split(/\s+/).every(value => /^\d+$/.test(value) && Number(value) > 0)
      || !['CapEff', 'CapPrm', 'CapBnd'].every(name => /^0+$/.test(boundary[name]))
      || boundary.NoNewPrivs !== '1' || boundary.Seccomp !== '2') {
      result = { passed: false, phase: 'security-boundary', context, failure: { code: 'NATIVE_PREFLIGHT_BOUNDARY_FAILED' } };
    } else {
    const create = createFixture ?? (await import('../../tests/native-stored-thread-sdk.fixture.mjs')).nativeStoredThreadSdkFixture;
    fixture = await create(); phase = 'sdk-store-seed';
    const seeded = await fixture.seed();
    if (seeded.turn?.status !== 'completed') throw new Error(seeded.turn?.error?.message ?? 'Owned SDK seed turn did not complete.');
    const executed = fixture.events.some(event => event.method === 'item/completed' && event.params?.item?.type === 'commandExecution'
      && event.params.item.exitCode === 0 && event.params.item.aggregatedOutput === 'OWNED_STORED_THREAD_HISTORY');
    if (!executed) throw new Error('Owned SDK seed command output was not verified.');
    const persisted = await fixture.call('thread/read', { threadId: seeded.threadId, includeTurns: true });
    if (persisted.thread?.id !== seeded.threadId || !JSON.stringify(persisted).includes('OWNED_STORED_THREAD_HISTORY'))
      throw new Error('Owned SDK persisted seed history was not verified.');
    result = { passed: true, phase, context };
    }
  } catch (error) { result = { passed: false, phase, context, failure: classifyNativeSandboxFailure(error, fixture) }; }
  finally {
    try { await fixture?.close(); }
    catch { result = { passed: false, phase: 'fixture-cleanup', context, failure: { code: 'NATIVE_PREFLIGHT_CLEANUP_FAILED' } }; }
  }
  emit({ kind: 'result', ...result }); return result;
}

export async function runContainerNativePreflight({ run, container, profileName, root = process.cwd(), note = console.log,
  audit = captureNativeAppArmorAudit } = {}) {
  // GNU timeout owns a separate process group, including SDK descendants. Its
  // TERM/KILL deadline remains effective when a probe or child stops responding.
  const startedAt = Date.now();
  const execution = await run('docker', ['exec', container, 'timeout', '--signal=TERM', '--kill-after=2s', '15s',
    'node', '.github/scripts/ci-native-probe.mjs'], { cwd: root, quiet: true, timeoutMs: 22_000 });
  const finishedAt = Date.now();
  const records = [];
  for (const line of (execution.output ?? '').split('\n')) if (line.startsWith(marker)) {
    try { records.push(JSON.parse(line.slice(marker.length))); } catch { /* Missing evidence fails below. */ }
  }
  const context = records.find(record => record.kind === 'context')?.context;
  const result = records.findLast(record => record.kind === 'result');
  const evidence = result && typeof result.passed === 'boolean' ? result
    : { passed: false, phase: 'probe-process', context, failure: { code: execution.code === 124 || execution.code === 137
      ? 'NATIVE_PREFLIGHT_DEADLINE' : 'NATIVE_PREFLIGHT_EVIDENCE_MISSING' } };
  if (execution.code !== 0) evidence.passed = false;
  evidence.probeWindow = { startedAt, finishedAt };
  if (!evidence.passed) evidence.apparmorAudit = await audit({ run, root, profileName, startedAt, finishedAt });
  note(`Native sandbox preflight: ${JSON.stringify(evidence)}`);
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await probeNativeSandbox();
  if (!result.passed) process.exitCode = 1;
}
