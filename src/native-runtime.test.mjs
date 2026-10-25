// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { Before, After, Then } from '@cucumber/cucumber';
import { nativeHostFixture } from '../tests/native-runtime.fixture.mjs';
import { nativeVaultFixture as vault } from '../tests/native-vault.fixture.mjs';
import { NativeRuntimeBroker } from './lib/secrets/native-runtime.ts';
import { nativeHost, nativeReference, validateNativeConnection } from './lib/secrets/native-runtime-config.ts';
import { NativeRuntimeBroker as Broker } from './lib/secrets/native-runtime.ts';
import { nativeRuntimeProfile, nativeRuntimeLimits } from './lib/native-runtime-contract.ts';
import { VaultError } from './lib/secrets/types.ts';
import { openCodexRuntime } from '../companions/codex/runtime.mjs';

Before({ tags: '@native-runtime' }, function () { this.nativeFixtures = []; this.nativeBrokers = []; });
After({ tags: '@native-runtime' }, async function () {
  for (const broker of this.nativeBrokers) broker.clear();
  for (const f of this.nativeFixtures.reverse()) await f.close();
});
const wait = async predicate => {
  const deadline = Date.now() + 1500;
  while (!predicate()) { if (Date.now() > deadline) assert.fail('The owned native transition did not finish.'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
async function fixture(world, options) { const f = await nativeHostFixture(options); world.nativeFixtures.push(f); return f; }
function broker(world, f) { const value = new NativeRuntimeBroker(f.runtime); world.nativeBrokers.push(value); return value; }
const initialize = { id: 'init', method: 'initialize', params: { clientInfo: { name: 'operations', version: '1' }, capabilities: { experimentalApi: false } } };
async function raw(f) {
  const { value } = await f.ticket(), socket = await f.socket(value.ticket);
  assert.equal((await socket.next()).type, 'paired');
  socket.ws.send(JSON.stringify(initialize)); assert.equal((await socket.next()).id, 'init');
  socket.ws.send(JSON.stringify({ method: 'initialized' })); return socket;
}

Then('native pairing rejects unsafe hosts origins and missing authorization before a child starts', async function () {
  const f = await fixture(this);
  for (const value of ['http://127.0.0.1', 'https://user:secret@host.test', 'https://host.test/path', 'https://host.test?key=secret', 'https://host.test#key', 'https://host.test\\evil']) assert.throws(() => nativeHost(value));
  assert.equal((await f.ticket(undefined, { Origin: 'https://foreign.test' })).status, 403);
  assert.equal((await f.ticket(undefined, { Authorization: '' })).status, 401);
  const preflight = await f.fetch(f.publicOrigin + '/v1/codex/tickets', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), f.applicationOrigin);
  assert.equal(preflight.headers.get('cross-origin-resource-policy'), 'cross-origin');
  const outsider = await f.socket(undefined, { origin: 'https://foreign.test' }); assert.equal(outsider.ws.readyState, 3);
  assert.equal(f.starts, 0);
});

Then('native pairing consumes tickets once and rejects expiry replay and queue exhaustion', async function () {
  const f = await fixture(this), expired = await f.ticket(); f.advance(nativeRuntimeLimits.ticketMs + 1);
  const old = await f.socket(expired.value.ticket); assert.equal(await old.next(), undefined); assert.equal(f.starts, 0);
  const issued = await f.ticket(), first = await f.socket(issued.value.ticket); assert.equal((await first.next()).profile, nativeRuntimeProfile);
  await first.close(); await wait(() => f.stops === 1);
  const replay = await f.socket(issued.value.ticket); assert.equal(await replay.next(), undefined); assert.equal(f.starts, 1);
  for (let index = 0; index < nativeRuntimeLimits.tickets; index++) assert.equal((await f.ticket()).status, 200);
  assert.equal((await f.ticket()).status, 409);
});

Then('native pairing enforces its reviewed method parameters and native initialization order', async function () {
  const f = await fixture(this), socket = await raw(f);
  socket.ws.send(JSON.stringify({ id: 'forbidden', method: 'command/exec', params: { command: 'never' } }));
  await socket.close(); await wait(() => f.stops === 1);
  assert.ok(!f.frames.some(frame => frame.method === 'command/exec'));
  const issued = await f.ticket(), uninitialized = await f.socket(issued.value.ticket); await uninitialized.next();
  uninitialized.ws.send(JSON.stringify({ id: 'early', method: 'account/read', params: { refreshToken: false } }));
  assert.equal(await uninitialized.next(), undefined); await uninitialized.close();
  const next = await raw(f);
  next.ws.send(JSON.stringify({ id: 'refresh', method: 'account/read', params: { refreshToken: true } }));
  assert.equal(await next.next(), undefined); assert.ok(!f.frames.some(frame => frame.params?.refreshToken === true));
});

Then('native pairing correlates concurrent requests and rejects foreign responses', async function () {
  const f = await fixture(this), socket = await raw(f); f.hold = true;
  for (const id of ['one', 'two']) socket.ws.send(JSON.stringify({ id, method: 'account/read', params: { refreshToken: false } }));
  await wait(() => f.release.length === 2); f.release.reverse().forEach(done => done());
  assert.equal((await socket.next()).id, 'two'); assert.equal((await socket.next()).id, 'one');
  f.emit({ id: 'foreign', result: {} }); await socket.close(); await wait(() => f.stops === 1);
});

Then('the native worker broker pairs initializes and returns only safe connection metadata', async function () {
  const f = await fixture(this, { account: { type: 'chatgpt', email: 'private@example.test', planType: 'team' } }), b = broker(this, f);
  const result = await b.check(randomUUID(), f.publicOrigin, f.key, 'c'.repeat(64), undefined, async () => {});
  assert.equal(result.accountType, 'chatgpt'); assert.equal(result.identity.version, '0.163.0');
  assert.ok(!JSON.stringify(result).includes(f.key)); assert.ok(!JSON.stringify(result).includes('private@example.test'));
  assert.deepEqual(f.frames.map(frame => frame.method), ['initialize', 'initialized', 'account/read']);
  assert.ok(f.requests.every(request => !request.path.includes('?'))); assert.ok(f.sockets.every(socket => socket.protocol === undefined && !socket.path.includes('?')));
});

Then('native saved pairings persist encrypted and reconnect to the same runtime only', async function () {
  const f = await fixture(this), v = await vault(f);
  const connection = await v.session.pairNativeRuntime(v.input, v.selection);
  assert.ok(!JSON.stringify(v.storage.state).includes(f.key)); assert.deepEqual(await v.session.connections(), []);
  v.session.lock(); await wait(() => f.stops === 1);
  v.session = v.newSession(); await v.session.unlock(v.proof);
  assert.equal((await v.session.nativeConnections())[0].connected, false);
  const current = await v.session.checkNativeRuntime(nativeReference(connection), v.selection);
  assert.deepEqual(current.identity, connection.identity); assert.equal(current.connected, true);
  await assert.rejects(v.session.checkNativeRuntime({ ...nativeReference(connection), revision: 2 }, v.selection), { code: 'CONFLICT' });
  v.session.lock();
});

Then('native pairings reject changed runtime account workspace source and pairing keys', async function () {
  for (const field of ['runtimeId', 'generation', 'workspace', 'configuration', 'accountEpoch', 'source', 'key']) {
    const f = await fixture(this), v = await vault(f), connection = await v.session.pairNativeRuntime(v.input, v.selection);
    if (field === 'source') v.enabled = false;
    else if (field === 'key') await v.session.put(null, { id: v.keyId, label: 'Native pairing key', kind: 'secret', value: 'B'.repeat(43) });
    else f.identity[field] = ['workspace', 'configuration'].includes(field) ? 'd'.repeat(64) : randomUUID();
    await assert.rejects(v.session.checkNativeRuntime(nativeReference(connection), v.selection));
    await wait(() => f.stops === f.starts);
    const saved = await v.session.nativeConnections(); assert.ok(saved.every(item => !item.connected));
    if (field === 'key') assert.deepEqual(saved, []);
    v.session.lock();
  }
});

Then('native pairing cancellation and expiry close owned requests without retry or logout', async function () {
  const f = await fixture(this), b = broker(this, f), controller = new AbortController(); f.hold = true;
  const pending = b.check(randomUUID(), f.publicOrigin, f.key, 'c'.repeat(64), undefined, async () => {}, controller.signal);
  await wait(() => f.release.length === 1); controller.abort(); await assert.rejects(pending, { code: 'CANCELLED' });
  await wait(() => f.stops === 1); assert.equal(f.frames.filter(frame => frame.method === 'account/read').length, 1);
  assert.ok(!f.frames.some(frame => frame.method === 'account/logout'));
  const second = await fixture(this), timeout = broker(this, { ...second, runtime: { ...second.runtime, requestMs: 100 } }); second.hold = true;
  await assert.rejects(timeout.check(randomUUID(), second.publicOrigin, second.key, 'c'.repeat(64), undefined, async () => {}), { code: 'NETWORK' });
  await wait(() => second.stops === 1);
  const third = await fixture(this), socket = await raw(third); third.advance(nativeRuntimeLimits.sessionMs + 1);
  socket.ws.send(JSON.stringify({ id: 'expired', method: 'account/read', params: { refreshToken: false } }));
  assert.equal(await socket.next(), undefined); assert.ok(!third.frames.some(frame => frame.id === 'expired'));
});

Then('native pairing lock disconnect and key removal close transports and preserve host ownership', async function () {
  const f = await fixture(this), v = await vault(f), connection = await v.session.pairNativeRuntime(v.input, v.selection);
  const sibling = await fixture(this), other = broker(this, sibling), siblingId = randomUUID();
  await other.check(siblingId, sibling.publicOrigin, sibling.key, 'c'.repeat(64), undefined, async () => {});
  await v.session.disconnectNativeRuntime(nativeReference(connection)); await wait(() => f.stops === 1);
  assert.equal(other.connected(siblingId), true); assert.equal(sibling.stops, 0);
  await v.session.checkNativeRuntime(nativeReference(connection), v.selection);
  await v.session.remove(null, v.keyId); await wait(() => f.stops === 2);
  assert.deepEqual(await v.session.nativeConnections(), []); assert.ok(!f.frames.some(frame => frame.method === 'account/logout'));
  v.session.lock();
});

Then('native pairing cannot save after cancellation lock or stale schema approval', async function () {
  for (const mode of ['cancel', 'lock', 'schema']) {
    const f = await fixture(this), v = await vault(f), fetch = f.runtime.fetch, controller = new AbortController();
    f.runtime.fetch = async (...args) => {
      const response = await fetch(...args);
      if (mode === 'cancel') controller.abort(); else if (mode === 'lock') v.session.lock(); else v.enabled = false;
      return response;
    };
    await assert.rejects(v.session.pairNativeRuntime(v.input, v.selection, controller.signal));
    assert.equal(f.starts, 0);
    if (mode !== 'lock') assert.deepEqual(await v.session.nativeConnections(), []);
    v.session.lock();
  }
  const f = await fixture(this), v = await vault(f); f.hold = true;
  const pending = v.session.pairNativeRuntime(v.input, v.selection);
  await wait(() => f.release.length === 1); v.session.lock();
  await assert.rejects(pending, { code: 'CANCELLED' }); await wait(() => f.stops === 1);
  await v.session.unlock(v.proof); assert.deepEqual(await v.session.nativeConnections(), []); v.session.lock();
});

Then('native pairings reject credential echoes malformed profiles and untrusted TLS', async function () {
  const f = await fixture(this), v = await vault(f); f.echo = true;
  await assert.rejects(v.session.pairNativeRuntime(v.input, v.selection)); assert.deepEqual(await v.session.nativeConnections(), []);
  f.echo = false; await wait(() => f.stops === f.starts);
  const connection = await v.session.pairNativeRuntime(v.input, v.selection);
  for (const mutate of [value => value.profile = 'other', value => value.host = 'http://127.0.0.1', value => value.identity.version = '0.164.0',
    value => value.pairingKeyId = 'invalid', value => value.revision = 0, value => value.modelFingerprint = 'wrong']) {
    const changed = structuredClone(connection); delete changed.connected; mutate(changed); assert.throws(() => validateNativeConnection(changed));
  }
  v.session.lock();
  const untrusted = new Broker({ requestMs: 1000 }); this.nativeBrokers.push(untrusted);
  await assert.rejects(untrusted.check(randomUUID(), f.publicOrigin, f.key, 'c'.repeat(64), undefined, async () => {}), { code: 'NETWORK' });
});

Then('the native runtime isolates its home environment configuration and owned child lifecycle', async function () {
  const directory = await mkdtemp(join(tmpdir(), 'operations-owned-native-'));
  const home = join(directory, 'private'), workspace = join(directory, 'workspace'), executable = join(directory, 'codex-fixture');
  const previousKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'native-parent-provider-canary';
  try {
    await mkdir(home, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 });
    const code = `#!${process.execPath}\nimport fs from 'node:fs';\nimport readline from 'node:readline';\nif(process.argv.includes('--version')){console.log('codex-cli 0.163.0');process.exit(0);}\nfs.writeFileSync(process.env.CODEX_HOME+'/observed.json',JSON.stringify({home:process.env.HOME,codexHome:process.env.CODEX_HOME,cwd:process.cwd(),providerKey:!!process.env.OPENAI_API_KEY,args:process.argv.slice(2)}));\nreadline.createInterface({input:process.stdin}).on('line',line=>{const frame=JSON.parse(line);if(frame.id!==undefined)console.log(JSON.stringify({id:frame.id,result:frame.method==='initialize'?{userAgent:'codex/0.163.0'}:{account:null,requiresOpenaiAuth:true}}));});\n`;
    await writeFile(executable, code, { mode: 0o700 });
    const config = { runtimeId: randomUUID(), executable, binarySha256: createHash('sha256').update(code).digest('hex'), home, workspace };
    await assert.rejects(openCodexRuntime({ ...config, home: join(homedir(), '.codex') }));
    await assert.rejects(openCodexRuntime({ ...config, binarySha256: '0'.repeat(64) }));
    const wrongVersion = code.replace('codex-cli 0.163.0', 'codex-cli 0.162.0'), wrongExecutable = join(directory, 'wrong-codex');
    await writeFile(wrongExecutable, wrongVersion, { mode: 0o700 });
    await assert.rejects(openCodexRuntime({ ...config, executable: wrongExecutable, binarySha256: createHash('sha256').update(wrongVersion).digest('hex') }));
    const linked = join(directory, 'linked'); await symlink(home, linked); await assert.rejects(openCodexRuntime({ ...config, home: linked }));
    const runtime = await openCodexRuntime(config), f = await fixture(this, { runtime }), b = broker(this, f);
    const id = randomUUID(); await b.check(id, f.publicOrigin, f.key, 'c'.repeat(64), undefined, async () => {});
    const observed = JSON.parse(await readFile(join(home, 'observed.json'), 'utf8'));
    assert.equal(observed.home, home); assert.equal(observed.codexHome, home); assert.equal(observed.cwd, workspace); assert.equal(observed.providerKey, false);
    assert.ok(observed.args.includes('cli_auth_credentials_store="file"')); assert.ok(observed.args.includes('sandbox_mode="read-only"'));
    const before = await runtime.authority();
    await writeFile(join(home, 'auth.json'), '{"syntheticAccount":"changed"}', { mode: 0o600 });
    const changed = await runtime.authority(); assert.notEqual(changed.accountEpoch, before.accountEpoch);
    await writeFile(join(home, 'config.toml'), 'test_configuration = true\n');
    assert.notEqual((await runtime.authority()).configuration, before.configuration);
    b.close(id); await f.host.close();
    assert.equal(b.connected(id), false); assert.ok(JSON.parse(await readFile(join(home, 'observed.json'), 'utf8')).args.includes('app-server'));
    await rm(join(home, 'auth.json')); await symlink(join(home, 'observed.json'), join(home, 'auth.json'));
    await assert.rejects(runtime.authority());
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
    await rm(directory, { recursive: true, force: true });
  }
});
