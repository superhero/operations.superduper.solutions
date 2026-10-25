// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { nativeRuntimeVersion as version, nativeRuntimeLimits as limits, nativeUuid } from '../../src/lib/native-runtime-contract.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
export async function openCodexRuntime(config) {
  if (!nativeUuid(config.runtimeId) || ![config.executable, config.home, config.workspace].every(value => typeof value === 'string' && isAbsolute(value))
    || !/^[a-f0-9]{64}$/.test(config.binarySha256)) throw new Error('Invalid private runtime configuration.');
  const requestedHome = resolve(config.home), desktopHome = join(homedir(), '.codex');
  if (requestedHome === desktopHome || requestedHome.startsWith(desktopHome + '/') || requestedHome === homedir() || requestedHome === '/') throw new Error('A dedicated private runtime home is required.');
  await mkdir(requestedHome, { recursive: true, mode: 0o700 });
  const home = await realpath(requestedHome), workspace = await realpath(config.workspace), executable = await realpath(config.executable);
  const privateHome = await lstat(requestedHome);
  if (privateHome.isSymbolicLink() || home !== requestedHome || !privateHome.isDirectory() || privateHome.mode & 0o077
    || privateHome.uid !== process.getuid?.() || home === workspace || workspace.startsWith(home + '/')) throw new Error('Invalid private runtime home.');
  const binary = await readFile(executable);
  if (hash(binary) !== config.binarySha256) throw new Error('The configured Codex binary does not match its pin.');
  const environment = { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: home, CODEX_HOME: home, TMPDIR: process.env.TMPDIR ?? '/tmp' };
  const reported = await promisify(execFile)(executable, ['--version'], { cwd: workspace, env: environment, timeout: 5000, maxBuffer: 4096 });
  if (reported.stdout.trim() !== 'codex-cli ' + version) throw new Error('The Codex runtime version does not match the schema pin.');
  const generation = randomUUID(), binaryStat = await stat(executable);
  let lastAccount, accountEpoch = randomUUID(), owned;
  const fileHash = async path => {
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024 * 1024) throw new Error('Invalid runtime authority file.');
      return hash(await readFile(path));
    } catch (error) { if (error.code === 'ENOENT') return 'absent'; throw error; }
  };
  async function authority() {
    const current = await stat(executable), directory = await stat(workspace), owner = await lstat(home);
    if (current.ino !== binaryStat.ino || current.size !== binaryStat.size || current.mtimeMs !== binaryStat.mtimeMs
      || current.dev !== binaryStat.dev || owner.mode & 0o077 || owner.uid !== privateHome.uid || !owner.isDirectory()) throw new Error('Runtime authority changed.');
    const auth = await fileHash(join(home, 'auth.json'));
    if (lastAccount !== undefined && lastAccount !== auth) accountEpoch = randomUUID();
    lastAccount = auth;
    const configuration = hash(JSON.stringify([config.binarySha256, executable, home, workspace, directory.dev, directory.ino,
      await fileHash(join(home, 'config.toml')), await fileHash(join(workspace, '.codex/config.toml')), 'file', 'read-only', false]));
    return { runtimeId: config.runtimeId, generation, version, configuration, workspace: hash(workspace), accountEpoch };
  }
  await authority();
  async function start(receive, exited) {
    if (owned) throw new Error('The runtime is already owned by a connection.');
    const child = spawn(executable, ['-c', 'cli_auth_credentials_store="file"', '-c', 'analytics.enabled=false',
      '-c', 'sandbox_mode="read-only"', 'app-server', '--listen', 'stdio://'], { cwd: workspace, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    owned = child;
    let buffer = Buffer.alloc(0), stopped = false;
    const finished = new Promise(resolve => { child.once('close', () => { if (owned === child) owned = undefined; exited(); resolve(); }); });
    child.on('error', () => { exited(); }); child.stdin.on('error', () => { exited(); });
    child.stderr.on('data', () => { /* Native logs can contain private inputs; do not expose them. */ });
    child.stdout.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > limits.frame * 2) { void close(); return; }
      let end;
      while ((end = buffer.indexOf(10)) >= 0) {
        const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
        if (!line.length) continue;
        try { if (line.length > limits.frame) throw new Error(); receive(JSON.parse(line.toString('utf8'))); }
        catch { void close(); return; }
      }
    });
    async function close() {
      if (!stopped) {
        stopped = true; child.stdin.end(); child.kill('SIGTERM');
        const kill = setTimeout(() => child.kill('SIGKILL'), 1500);
        try { await finished; } finally { clearTimeout(kill); buffer.fill(0); }
      } else await finished;
    }
    return { send(frame) {
      const bytes = JSON.stringify(frame) + '\n';
      if (stopped || child.stdin.destroyed || Buffer.byteLength(bytes) > limits.frame || child.stdin.writableLength > limits.frame) throw new Error('Native input unavailable.');
      child.stdin.write(bytes);
    }, close };
  }
  return { authority, start };
}
