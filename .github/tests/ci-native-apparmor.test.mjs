// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import './support.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Then } from '@cucumber/cucumber';
import { buildNativeAppArmorProfile, nativeAppArmorPin, prepareNativeAppArmor } from '../scripts/ci-native-apparmor.mjs';

const source = readFileSync(new URL('../scripts/ci-native-apparmor-default.go.txt', import.meta.url));
const name = 'operations-native-automation-owned';
const parser = '/usr/sbin/apparmor_parser';
const active = async path => { assert.equal(path, '/sys/module/apparmor/parameters/enabled'); return 'Y\n'; };
const findParser = async () => parser;

Then('the owned native AppArmor policy preserves Docker denials and constrains sandbox mounts', function () {
  const profile = buildNativeAppArmorProfile(source, { name });
  assert.match(profile, new RegExp(`profile "${name}" flags=\\(attach_disconnected,mediate_deleted\\)`));
  assert.ok(!profile.includes('{{')); assert.match(profile, /^abi <abi\/4\.0>,$/m);
  const template = String(source).match(/const baseTemplate = `([\s\S]*?)`\n/)[1];
  for (const line of template.split('\n').filter(line => /^  deny /.test(line) && line !== '  deny mount,'))
    assert.ok(profile.includes(line), line);
  assert.match(profile, /signal \(send,receive\) peer="operations-native-automation-owned"/);
  assert.match(profile, /ptrace \(trace,tracedby,read,readby\) peer="operations-native-automation-owned"/);
  assert.match(profile, /deny \/oldroot\/proc\/sysrq-trigger rwklx,/);
  assert.match(profile, /deny \/newroot\/sys\/kernel\/security\/\*\* rwklx,/);
  assert.ok(!/^\s*(?:mount|allow all),\s*$/m.test(profile));
  assert.ok(!/flags=\([^)]*(?:unconfined|complain|default_allow)/.test(profile));
  assert.ok(!/\b(?:px|Px|ux|Ux|change_profile)\b/.test(profile));
  assert.match(profile, /mount options=\(rw,rslave,silent\) -> \/,/);
  assert.match(profile, /pivot_root oldroot=\/tmp\/oldroot\/ \/tmp\/,/);
  assert.match(profile, /pivot_root oldroot=\/newroot\/ \/newroot\/,/);
  assert.ok(profile.includes('/newroot/workspace/tmp/test{,/**}/browser/.runtime/operations-native-*/**'));
  assert.ok(profile.includes('/newroot/tmp/operations-native-*/**'));
  for (const line of profile.split('\n').filter(line => /^  mount /.test(line))) {
    assert.match(line, /options=\([a-z,]+\)/);
    assert.ok(!line.includes('options in'));
    assert.match(line, / -> \/(?:,|tmp\/|newroot|oldroot\/)/);
    if (line.endsWith(' -> /oldroot/,')) assert.ok(line.includes('rprivate'));
    if (line.includes('remount')) {
      const flags = line.match(/options=\(([^)]+)\)/)[1].split(',');
      for (const flag of ['bind', 'nosuid', 'silent']) assert.ok(flags.includes(flag), line);
      if (!line.includes('/dev/{null,zero,full,random,urandom,tty}'))
        for (const flag of ['ro', 'nodev']) assert.ok(flags.includes(flag), line);
    }
  }
  assert.throws(() => buildNativeAppArmorProfile(Buffer.concat([source, Buffer.from('\n')]), { name }), /reviewed pin/);
  for (const invalid of ['docker-default', 'operations-native-', 'operations-native-x*', 'operations-native-x"\nprofile injected {'])
    assert.throws(() => buildNativeAppArmorProfile(source, { name: invalid }), /profile name/);
  assert.equal(nativeAppArmorPin.sdkVersion, '0.163.0');
});

Then('an owned native AppArmor profile loads uniquely and unloads only after verified container removal', async function () {
  const calls = [];
  const handle = await prepareNativeAppArmor({ directory: this.automation.root, name, read: active, findParser,
    run: async (program, args, options) => { calls.push({ program, args, options }); return { code: 0 }; } });
  assert.equal(handle.name, name); assert.deepEqual(handle.dockerArguments, ['--security-opt', `apparmor=${name}`]);
  assert.equal(handle.metadata.state, 'loaded'); assert.equal(handle.metadata.retained, true);
  assert.equal(statSync(handle.metadata.profilePath).mode & 0o777, 0o600);
  assert.equal(calls[0].program, 'sudo');
  assert.deepEqual(calls[0].args, ['-n', parser, '--config-file', '/dev/null', '--add', '--skip-cache', handle.metadata.profilePath]);
  assert.equal(calls[0].options.timeoutMs, 15_000); assert.equal(calls[0].options.quiet, true);
  assert.ok(!calls[0].args.some(value => /replace|sysctl|complain|unconfined/.test(value)));
  await assert.rejects(handle.cleanup(), /verified container absence/);
  await assert.rejects(handle.cleanup({ containerAbsent: false }), /verified container absence/);
  assert.equal(calls.length, 1); assert.ok(existsSync(handle.metadata.profilePath));
  const original = readFileSync(handle.metadata.profilePath);
  writeFileSync(handle.metadata.profilePath, Buffer.concat([original, Buffer.from('\n# changed source\n')]));
  await assert.rejects(handle.cleanup({ containerAbsent: true }), error => error.code === 'NATIVE_APPARMOR_UNLOAD_FAILED');
  assert.equal(calls.length, 1); assert.equal(handle.metadata.retained, true);
  writeFileSync(handle.metadata.profilePath, original);
  await handle.cleanup({ containerAbsent: true });
  assert.equal(handle.metadata.state, 'unloaded'); assert.equal(handle.metadata.retained, false);
  assert.equal(calls.length, 2); assert.ok(calls[1].args.includes('--remove'));
  assert.ok(!existsSync(handle.metadata.profilePath));
  await handle.cleanup({ containerAbsent: true }); assert.equal(calls.length, 2);
});

Then('inactive AppArmor needs no policy while active unavailable tooling fails closed', async function () {
  for (const read of [async () => 'N\n', async () => { throw Object.assign(new Error('Absent module.'), { code: 'ENOENT' }); }]) {
    const handle = await prepareNativeAppArmor({ directory: this.automation.root, read, name,
      findParser: async () => assert.fail('An inactive module must not request privileged tooling.'),
      run: async () => assert.fail('An inactive module must not load a profile.') });
    assert.equal(handle.metadata.state, 'disabled'); assert.equal(handle.name, null); assert.deepEqual(handle.dockerArguments, []);
    await handle.cleanup();
  }
  for (const read of [async () => 'unknown', async () => { throw Object.assign(new Error('PRIVATE_CONTEXT'), { code: 'EACCES' }); }])
    await assert.rejects(prepareNativeAppArmor({ directory: this.automation.root, read, name, run: async () => assert.fail() }),
      error => error.code === 'NATIVE_APPARMOR_STATE_UNAVAILABLE' && !error.message.includes('PRIVATE_CONTEXT'));
  await assert.rejects(prepareNativeAppArmor({ directory: this.automation.root, read: active, name,
    findParser: async () => { throw new Error('PRIVATE_TOOL_PATH'); }, run: async () => assert.fail() }),
    error => error.code === 'NATIVE_APPARMOR_PARSER_UNAVAILABLE' && !error.message.includes('PRIVATE_TOOL_PATH'));
});

Then('native AppArmor load and unload failures retain their owned profile for recovery', async function () {
  let ordinal = 0;
  for (const transport of [false, true]) {
    const selectedName = `${name}-load-${++ordinal}`;
    await assert.rejects(prepareNativeAppArmor({ directory: this.automation.root, read: active, findParser, name: selectedName,
      run: async () => { if (transport) throw new Error('PRIVATE_TRANSPORT_ERROR'); return { code: 1 }; } }), error => {
      assert.equal(error.code, 'NATIVE_APPARMOR_LOAD_FAILED'); assert.equal(error.nativeAppArmor.name, selectedName);
      assert.equal(error.nativeAppArmor.state, 'load-failed'); assert.equal(error.nativeAppArmor.retained, true);
      assert.ok(existsSync(error.nativeAppArmor.profilePath)); assert.ok(!error.message.includes('PRIVATE_TRANSPORT_ERROR')); return true;
    });
  }
  for (const transport of [false, true]) {
    let failed = true, load = true;
    const handle = await prepareNativeAppArmor({ directory: this.automation.root, read: active, findParser, name: `${name}-unload-${++ordinal}`,
      run: async () => { if (load) { load = false; return { code: 0 }; }
        if (failed && transport) throw new Error('PRIVATE_UNLOAD_ERROR'); return { code: failed ? 1 : 0 }; } });
    await assert.rejects(handle.cleanup({ containerAbsent: true }), error => {
      assert.equal(error.code, 'NATIVE_APPARMOR_UNLOAD_FAILED'); assert.equal(error.nativeAppArmor, handle.metadata);
      assert.equal(handle.metadata.state, 'unload-failed'); assert.equal(handle.metadata.retained, true);
      assert.ok(existsSync(handle.metadata.profilePath)); assert.ok(!error.message.includes('PRIVATE_UNLOAD_ERROR')); return true;
    });
    failed = false; await handle.cleanup({ containerAbsent: true });
    assert.equal(handle.metadata.retained, false); assert.ok(!existsSync(handle.metadata.profilePath));
  }
});
