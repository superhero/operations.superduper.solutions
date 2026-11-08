// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The executable matches docs/evidence/codex-native-runtime-0.163.0.json.
// The sandbox helper is from the same official, previously qualified release.
export const nativeRuntimePin = Object.freeze({
  version: '0.163.0',
  executable: Object.freeze({ member: 'codex-x86_64-unknown-linux-musl', bytes: 296865480,
    sha256: '399ff69c431c066e40de318fba45c2b07f45a76b19939d247ee4828fc70c4215' }),
  sandbox: Object.freeze({ member: 'bwrap-x86_64-unknown-linux-musl', bytes: 529776,
    sha256: '77360cb751ccedc5971391444ac86a8a33c15b04d6b4a6fe45f5d25496e62c4c' }),
});
export const nativeRuntimeSeccompPin = Object.freeze({
  baseSha256: '6416b47770785a41ac59073cdc77d9fe98517df2799dc83ef207e622de3053f6',
  profileSha256: '4bf2f1e2d87e9ad7e9b759944f5dd28a42eee08710d00c3e51e82144da5d49e4',
  addedSyscalls: Object.freeze(['clone', 'unshare', 'mount', 'umount2', 'pivot_root', 'setns']),
});

export function qualifiedNativeSeccompProfile(source) {
  if (createHash('sha256').update(source).digest('hex') !== nativeRuntimeSeccompPin.baseSha256)
    throw new Error('The native sandbox base seccomp profile differs from its qualification.');
  const profile = JSON.parse(source);
  profile.syscalls.push({ names: [...nativeRuntimeSeccompPin.addedSyscalls], action: 'SCMP_ACT_ALLOW' });
  const bytes = Buffer.from(JSON.stringify(profile));
  if (createHash('sha256').update(bytes).digest('hex') !== nativeRuntimeSeccompPin.profileSha256)
    throw new Error('The native sandbox seccomp profile differs from its qualification.');
  return bytes;
}

const containerDirectory = '/opt/operations-ci-native';
export function needsNativeRuntime(units) {
  return units.some(unit => unit.bindings.some(test => test.tags.includes('@native-real-runtime')));
}

export async function verifyNativeRuntimeFile(path, pin) {
  const info = await lstat(path);
  if (!info.isFile() || info.size !== pin.bytes) throw new Error('Pinned native runtime executable has an invalid type or size.');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  if (hash.digest('hex') !== pin.sha256) throw new Error('Pinned native runtime executable digest differs from its qualification.');
}

export function nativeRuntimeDockerArguments(directory) {
  return ['--security-opt', `seccomp=${join(directory, 'native-seccomp.json')}`,
    '--mount', `type=bind,source=${directory},target=${containerDirectory},readonly`,
    '--env', `PATH=${containerDirectory}/codex-resources:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    '--env', `OPERATIONS_CODEX_QUALIFICATION_BINARY=${containerDirectory}/codex`,
    '--env', `OPERATIONS_CODEX_QUALIFICATION_SHA256=${nativeRuntimePin.executable.sha256}`];
}

/** Acquire public release assets on the host before the offline container exists. */
export async function prepareNativeRuntime({ run, signal, platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'linux' || arch !== 'x64') throw new Error('The qualified browser native runtime requires Linux x64.');
  signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), 'operations-ci-native-'));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const seccomp = qualifiedNativeSeccompProfile(await readFile(new URL('./ci-native-seccomp-default.json', import.meta.url)));
    await writeFile(join(directory, 'native-seccomp.json'), seccomp, { mode: 0o444 });
    await mkdir(join(directory, 'codex-resources'));
    for (const [kind, pin] of [['executable', nativeRuntimePin.executable], ['sandbox', nativeRuntimePin.sandbox]]) {
      signal?.throwIfAborted();
      const archive = join(directory, `${pin.member}.tar.gz`);
      const source = `https://github.com/openai/codex/releases/download/rust-v${nativeRuntimePin.version}/${pin.member}.tar.gz`;
      const downloaded = await run('curl', ['--fail', '--location', '--silent', '--show-error', '--proto', '=https',
        '--proto-redir', '=https', '--connect-timeout', '20', '--max-time', '180', '--retry', '2',
        '--max-filesize', '268435456', '--output', archive, source], { quiet: true, timeoutMs: 240_000 });
      if (downloaded.code !== 0) throw new Error(`Cannot download the pinned Codex ${kind} release asset.`);
      signal?.throwIfAborted();
      // Select only the exact flat release member; never extract an archive tree.
      const extracted = await run('tar', ['--extract', '--gzip', '--file', archive, '--directory', directory,
        '--no-same-owner', '--no-same-permissions', '--', pin.member], { quiet: true, timeoutMs: 60_000 });
      if (extracted.code !== 0) throw new Error(`Cannot extract the pinned Codex ${kind} release asset.`);
      const binary = join(directory, pin.member);
      await verifyNativeRuntimeFile(binary, pin);
      await chmod(binary, 0o555);
      await rename(binary, kind === 'executable' ? join(directory, 'codex') : join(directory, 'codex-resources/bwrap'));
      await rm(archive);
    }
    signal?.throwIfAborted();
    return { directory, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
