// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';

export const nativeAppArmorPin = Object.freeze({
  sourceSha256: '7da15d81aa5c507f5002b844fdc49a969904681447a2cc29222bd6cbe797163b',
  sdkVersion: '0.163.0',
  policyVersion: 1,
});
const moduleEnabled = '/sys/module/apparmor/parameters/enabled';
const sourceURL = new URL('./ci-native-apparmor-default.go.txt', import.meta.url);
const digest = value => createHash('sha256').update(value).digest('hex');

function checkName(name) {
  if (typeof name !== 'string' || !/^operations-native-[a-z0-9][a-z0-9-]{0,79}$/.test(name))
    throw new Error('Invalid owned native AppArmor profile name.');
}

function sandboxRules() {
  const rules = [
    '  # Codex 0.163.0: one enforcing profile, inherited across every exec.',
    '  userns create,',
    '  network unix,',
    '  # Bootstrap the private mount namespace, then construct only /newroot.',
    '  mount options=(rw,rslave,silent) -> /,',
    '  mount fstype=tmpfs options=(rw,nosuid,nodev) -> /tmp/,',
    '  mount options=(rw,rbind) /tmp/newroot/ -> /tmp/newroot/,',
    '  pivot_root oldroot=/tmp/oldroot/ /tmp/,',
    '  mount options=(rw,rbind) /oldroot/ -> /newroot/,',
    '  mount options=(rw,rbind) /oldroot/** -> /newroot/**,',
    '  mount fstype=tmpfs options=(rw,nosuid,nodev) -> /newroot/dev/,',
    '  mount fstype=devpts options=(rw,nosuid,noexec) -> /newroot/dev/pts/,',
    '  mount fstype=proc options=(rw,nosuid,nodev,noexec) -> /newroot/proc/,',
    '  # Empty masks for the fixture-owned credential tree and SDK control socket.',
    '  mount fstype=tmpfs options=(rw,nosuid,nodev) -> /newroot/tmp/operations-native-*/**,',
    '  mount fstype=tmpfs options=(rw,nosuid,nodev) -> /newroot/workspace/tmp/test{,/**}/browser/.runtime/operations-native-*/**,',
    '  mount fstype=tmpfs options=(rw,nosuid,nodev) -> /newroot/tmp/codex-daemon-[0-9]*/,',
    '  mount options=(rw,rbind) /bindfile?????? -> /newroot/tmp/operations-native-*/**,',
    '  mount options=(rw,rbind) /bindfile?????? -> /newroot/workspace/tmp/test{,/**}/browser/.runtime/operations-native-*/**,',
    '  mount options=(rw,rprivate,silent) -> /oldroot/,',
    '  pivot_root oldroot=/newroot/ /newroot/,',
    '  # Exact remount flag sets preserve mandatory flags; options-in is too broad.',
  ];
  // bind-mount.c retains these four inherited flags. Every ordinary remount is
  // read-only, nosuid and nodev; only the six standard /dev nodes may remain rw.
  const inherited = ['noexec', 'noatime', 'nodiratime', 'relatime'];
  for (let mask = 0; mask < 1 << inherited.length; mask++) {
    const extra = inherited.filter((_, bit) => mask & (1 << bit));
    rules.push(`  mount options=(${['ro', 'nosuid', 'nodev', 'remount', 'bind', 'silent', ...extra].join(',')}) -> /newroot{,/**},`);
    for (const mode of ['rw', 'ro']) for (const nodev of [[], ['nodev']])
      rules.push(`  mount options=(${[mode, 'nosuid', ...nodev, 'remount', 'bind', 'silent', ...extra].join(',')}) -> /newroot/dev/{null,zero,full,random,urandom,tty},`);
  }
  return rules.join('\n') + '\n';
}

/** Render only a digest-pinned upstream template and fixed SDK-specific rules. */
export function buildNativeAppArmorProfile(source, { name } = {}) {
  checkName(name);
  if (digest(source) !== nativeAppArmorPin.sourceSha256) throw new Error('Native AppArmor source differs from its reviewed pin.');
  let profile = String(source).match(/const baseTemplate = `([\s\S]*?)`\n/)?.[1];
  if (!profile) throw new Error('Native AppArmor source has no reviewed template.');
  profile = profile.replace(/{{if \.Abi}}abi <{{\.Abi}}>,\n{{- end}}/, 'abi <abi/4.0>,')
    .replace(/{{range \$value := \.Imports}}\n{{\$value}}\n{{- end}}/, '#include <tunables/global>')
    .replace(/{{- range \$value := \.InnerImports}}\n  {{\$value}}\n{{- end}}{{if \.InnerImports}}\n{{end}}/, '\n  #include <abstractions/base>\n')
    .replaceAll('{{.Name}}', JSON.stringify(name)).replaceAll('{{.PeerName}}', JSON.stringify(name))
    .replaceAll('{{.DaemonProfile}}', 'unconfined').replace('  deny mount,\n', sandboxRules());
  if (profile.includes('{{') || profile.includes('  deny mount,')) throw new Error('Native AppArmor template could not be rendered.');
  // Keep default proc/sys protections through bwrap's temporary root aliases.
  const denies = profile.split('\n').filter(line => /^  deny (?:@\{PROC\}|\/sys\/)/.test(line));
  const aliases = [];
  for (const prefix of ['/oldroot', '/newroot', '/tmp/oldroot', '/tmp/newroot']) for (const line of denies)
    aliases.push(line.replace('@{PROC}/', prefix + '/proc/').replace('deny /sys/', `deny ${prefix}/sys/`));
  return profile.replace(/\n}\s*$/, '\n  # Preserve the same denials at temporary bwrap root aliases.\n' + aliases.join('\n') + '\n}\n');
}

function unavailable(code, message, metadata) {
  return Object.assign(new Error(message), { code, ...(metadata ? { nativeAppArmor: metadata } : {}) });
}

async function findNativeAppArmorParser() {
  const paths = new Set(['/usr/sbin/apparmor_parser', '/sbin/apparmor_parser',
    ...(process.env.PATH ?? '').split(delimiter).filter(isAbsolute).map(path => join(path, 'apparmor_parser'))]);
  for (const candidate of paths) {
    try {
      const path = await realpath(candidate), info = await lstat(path);
      // sudo must never execute a user-owned PATH replacement. Resolve common
      // merged-/usr aliases, then require the actual system-owned executable.
      if (/^\/(?:usr\/)?(?:sbin|bin)\/apparmor_parser$/.test(path) && info.isFile()
        && info.uid === 0 && !(info.mode & 0o022) && (info.mode & 0o111)) return path;
    } catch { /* Try the next known system path. */ }
  }
  throw unavailable('NATIVE_APPARMOR_PARSER_UNAVAILABLE', 'Active AppArmor requires its trusted system parser.');
}

/** Load only a unique task-owned profile; callers retain it after uncertain removal. */
export async function prepareNativeAppArmor({ directory, run, name = `operations-native-${randomUUID()}`,
  read = readFile, findParser = findNativeAppArmorParser } = {}) {
  checkName(name);
  let enabled;
  try { enabled = String(await read(moduleEnabled, 'utf8')).trim(); }
  catch (error) {
    if (error?.code === 'ENOENT') enabled = 'N';
    else throw unavailable('NATIVE_APPARMOR_STATE_UNAVAILABLE', 'Cannot determine host AppArmor enforcement.');
  }
  if (enabled === 'N') return { name: null, dockerArguments: [],
    metadata: { state: 'disabled', retained: false, ...nativeAppArmorPin }, async cleanup() {} };
  if (enabled !== 'Y') throw unavailable('NATIVE_APPARMOR_STATE_UNAVAILABLE', 'Cannot determine host AppArmor enforcement.');
  let parser;
  try { parser = await findParser(); }
  catch { throw unavailable('NATIVE_APPARMOR_PARSER_UNAVAILABLE', 'Active AppArmor requires its trusted system parser.'); }
  if (!/^\/(?:usr\/)?(?:sbin|bin)\/apparmor_parser$/.test(parser ?? ''))
    throw unavailable('NATIVE_APPARMOR_PARSER_UNAVAILABLE', 'Active AppArmor requires its trusted system parser.');
  if (typeof run !== 'function' || typeof directory !== 'string' || !isAbsolute(directory))
    throw unavailable('NATIVE_APPARMOR_DIRECTORY_UNSAFE', 'Native AppArmor requires an owned absolute source directory.');
  const parent = await lstat(directory);
  if (!parent.isDirectory() || parent.uid !== process.getuid() || parent.mode & 0o022)
    throw unavailable('NATIVE_APPARMOR_DIRECTORY_UNSAFE', 'Native AppArmor requires an owned private source directory.');
  const profile = buildNativeAppArmorProfile(await readFile(sourceURL), { name });
  const profilePath = join(directory, `native-apparmor-${name}.profile`);
  const metadata = { state: 'load-failed', name, profilePath, parser, retained: true,
    ...nativeAppArmorPin, profileSha256: digest(profile) };
  const invoke = operation => run('sudo', ['-n', parser, '--config-file', '/dev/null', operation, '--skip-cache', profilePath],
    { cwd: directory, quiet: true, timeoutMs: 15_000 });
  try {
    // Add rather than replace: a collision cannot overwrite any existing policy.
    await writeFile(profilePath, profile, { flag: 'wx', mode: 0o600 });
    if ((await invoke('--add')).code !== 0) throw new Error();
    metadata.state = 'loaded';
  } catch {
    // A transport deadline can leave kernel state uncertain. The source and name
    // remain available to the caller, which must not delete the parent directory.
    throw unavailable('NATIVE_APPARMOR_LOAD_FAILED', 'The owned native AppArmor profile could not be loaded.', metadata);
  }
  let cleaning;
  async function cleanup({ containerAbsent = false } = {}) {
    if (metadata.state === 'unloaded') return;
    if (containerAbsent !== true) throw unavailable('NATIVE_APPARMOR_CONTAINER_UNVERIFIED',
      'Native AppArmor cleanup requires verified container absence.', metadata);
    if (cleaning) return cleaning;
    cleaning = (async () => {
      try {
        const info = await lstat(profilePath);
        if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o022
          || digest(await readFile(profilePath)) !== metadata.profileSha256) throw new Error();
        if ((await invoke('--remove')).code !== 0) throw new Error();
        await rm(profilePath);
        metadata.state = 'unloaded'; metadata.retained = false;
      } catch {
        metadata.state = 'unload-failed'; metadata.retained = true;
        throw unavailable('NATIVE_APPARMOR_UNLOAD_FAILED', 'The owned native AppArmor profile could not be removed.', metadata);
      }
    })();
    try { return await cleaning; } finally { cleaning = undefined; }
  }
  return { name, dockerArguments: ['--security-opt', `apparmor=${name}`], metadata, cleanup };
}
