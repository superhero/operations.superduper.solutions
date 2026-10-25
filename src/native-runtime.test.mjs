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
import { nativeHost, nativeReference, validateNativeConnection, validateNativeBinding, storedNativeConnections } from './lib/secrets/native-runtime-config.ts';
import { NativeRuntimeBroker as Broker } from './lib/secrets/native-runtime.ts';
import { nativeRuntimeProfile, nativeRuntimeLimits, nativeScope } from './lib/native-runtime-contract.ts';
import { VaultError } from './lib/secrets/types.ts';
import { decryptJSON, encryptJSON, recoveryKey, unwrapVaultKey } from './lib/secrets/crypto.ts';
import { sealSnapshot } from './lib/secrets/format.ts';
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

// A hostile companion can return frames the trusted host fixture will never emit.
// Exercise the worker's public transport boundary without relaxing host validation.
function scriptedRuntime(world, options = {}) {
  const f = { key: 'K'.repeat(43), host: 'https://native.example.test', now: Date.now(), frames: [], sockets: [], calls: 0,
    identity: { runtimeId: randomUUID(), generation: randomUUID(), accountEpoch: randomUUID(), version: '0.163.0',
      configuration: 'a'.repeat(64), workspace: 'b'.repeat(64) } };
  class Socket extends EventTarget {
    readyState = 0; bufferedAmount = 0;
    constructor() { super(); f.sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }); }
    receive(value) { this.dispatchEvent(new MessageEvent('message', { data: typeof value === 'string' ? value : JSON.stringify(value) })); }
    send(text) {
      const frame = JSON.parse(text); f.frames.push(frame);
      if (options.send?.(frame, this, f) === true) return;
      if (frame.type === 'pair') {
        const paired = { type: 'paired', profile: nativeRuntimeProfile, identity: f.identity, scope: f.scope, expiresAt: f.now + 10000 };
        const payload = options.paired ? options.paired(paired) : paired;
        queueMicrotask(() => this.receive(payload));
      } else if (frame.id && frame.method) queueMicrotask(() => this.receive({ id: frame.id,
        result: frame.method === 'account/read' ? { account: null, requiresOpenaiAuth: true } : {} }));
    }
    close() { if (this.readyState !== 3) { this.readyState = 3; this.dispatchEvent(new Event('close')); } }
  }
  f.runtime = { now: () => f.now, requestMs: 80, WebSocket: Socket, fetch: async (_url, init) => {
    f.calls++; f.scope = JSON.parse(init.body).scope;
    if (options.fetch) return options.fetch(f, init);
    return Response.json({ ticket: 'T'.repeat(43), expiresAt: f.now + 1000, identity: f.identity });
  } };
  f.broker = broker(world, f);
  f.check = (id = randomUUID(), signal, guard = async () => {}) => f.broker.check(id, f.host, f.key, 'c'.repeat(64), undefined, guard, signal);
  f.agent = (id = randomUUID(), events = { frame: () => false, closed() {} }, guard = async () => {}) =>
    f.broker.agent(id, f.host, f.key, 'c'.repeat(64), f.identity, guard, events);
  return f;
}

Then('native ticket parsing rejects malformed opaque and oversized responses before opening sockets', async function () {
  const responses = [
    () => new Response(null, { status: 403 }), () => new Response(null, { headers: { 'content-type': 'application/json' } }),
    () => new Response('{}', { headers: { 'content-type': 'text/plain' } }),
    () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    () => new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    () => Response.json({ padding: 'x'.repeat(8192) }),
    f => Response.json({ ticket: 'short', expiresAt: f.now + 1000, identity: f.identity }),
    f => Response.json({ ticket: 'T'.repeat(43), expiresAt: f.now, identity: f.identity }),
    f => Response.json({ ticket: 'T'.repeat(43), expiresAt: f.now + nativeRuntimeLimits.ticketMs + 1, identity: f.identity }),
    f => Response.json({ ticket: 'T'.repeat(43), expiresAt: f.now + 1000, identity: { ...f.identity, version: '0.164.0' } }),
  ];
  for (const fetch of responses) {
    const f = scriptedRuntime(this, { fetch }); await assert.rejects(f.check(), { code: 'AUTHORIZATION' }); assert.equal(f.sockets.length, 0);
  }
  const opaque = scriptedRuntime(this, { fetch() { throw new Error('private upstream detail'); } });
  await assert.rejects(opaque.check(), error => error.code === 'NETWORK' && !error.message.includes('private upstream'));
  const f = scriptedRuntime(this), cancel = new AbortController(); cancel.abort();
  await assert.rejects(f.check(randomUUID(), cancel.signal), { code: 'CANCELLED' });
  await assert.rejects(f.broker.check(randomUUID(), f.host, 'bad', 'c'.repeat(64), undefined, async () => {}), { code: 'INVALID' });
  assert.equal(f.calls, 0);
});

Then('native pairing rejects forged scope expiry and malformed socket messages and closes the peer', async function () {
  for (const paired of [
    value => ({ ...value, profile: 'unreviewed' }), value => ({ ...value, type: 'result' }),
    value => ({ ...value, identity: { ...value.identity, workspace: 'd'.repeat(64) } }),
    value => ({ ...value, scope: { ...value.scope, connectionId: randomUUID() } }),
    value => ({ ...value, scope: { ...value.scope, method: 'codex-workflow' } }),
    value => ({ ...value, scope: { ...value.scope, fingerprint: 'd'.repeat(64) } }),
    value => ({ ...value, expiresAt: 0 }), value => ({ ...value, expiresAt: Date.now() + nativeRuntimeLimits.sessionMs + 10000 }),
    () => '{', () => 'K'.repeat(43), () => 'x'.repeat(nativeRuntimeLimits.frame + 1),
  ]) {
    const f = scriptedRuntime(this, { paired }); await assert.rejects(f.check(), { code: 'AUTHORIZATION' });
    assert.equal(f.sockets[0].readyState, 3); assert.equal(f.frames.some(frame => frame.method === 'initialize'), false);
  }
  assert.throws(() => nativeScope({ connectionId: randomUUID(), method: 'account/read', fingerprint: 123 }));
});

Then('native broker limits concurrent owners and requests and revokes expired or disconnected work', async function () {
  const f = scriptedRuntime(this), id = randomUUID();
  const first = f.check(id); await assert.rejects(f.check(id), { code: 'CONFLICT' }); await first;
  assert.equal((await f.check(id)).accountType, 'none'); assert.equal(f.calls, 1, 'A current owner reuses its transport.');
  for (let index = 0; index < 3; index++) await f.check();
  await assert.rejects(f.check(), { code: 'LIMIT' }); await assert.rejects(f.agent(), { code: 'LIMIT' });
  f.broker.clear(); assert.ok(f.sockets.every(socket => socket.readyState === 3));
  const pending = scriptedRuntime(this, { send: frame => frame.method === 'thread/start' }), owner = randomUUID(), peer = await pending.agent(owner);
  assert.equal(await pending.agent(owner), peer, 'A workflow owner reuses matching authority.');
  const requests = Array.from({ length: nativeRuntimeLimits.pending }, () => peer.request('thread/start', {}));
  const failures = requests.map(request => assert.rejects(request, { code: 'NETWORK' }));
  await assert.rejects(peer.request('thread/start', {}), { code: 'LIMIT' }); pending.broker.close(owner); await Promise.all(failures);
  assert.equal(pending.broker.connected(owner), false);
  const expired = scriptedRuntime(this), expiredPeer = await expired.agent(); expired.now = expiredPeer.expiresAt;
  await assert.rejects(expiredPeer.request('thread/start', {}), { code: 'AUTHORIZATION' }); assert.equal(expiredPeer.socket.readyState, 3);
  const cancelled = scriptedRuntime(this), cancelledPeer = await cancelled.agent(), cancel = new AbortController(); cancel.abort();
  await assert.rejects(cancelledPeer.request('thread/start', {}, cancel.signal), { code: 'CANCELLED' });
});

Then('native broker rejects malformed account results and converts socket failures without leaking details', async function () {
  for (const result of [null, [], {}, { requiresOpenaiAuth: 'yes', account: null }, { requiresOpenaiAuth: true },
    { requiresOpenaiAuth: true, account: [] }, { requiresOpenaiAuth: true, account: { type: 'foreign' } }]) {
    const f = scriptedRuntime(this, { send(frame, socket) { if (frame.method !== 'account/read') return false;
      queueMicrotask(() => socket.receive({ id: frame.id, result })); return true; } });
    await assert.rejects(f.check(), { code: 'AUTHORIZATION' }); assert.equal(f.sockets[0].readyState, 3);
  }
  const rpcError = scriptedRuntime(this, { send(frame, socket) { if (frame.method !== 'thread/start') return false;
    queueMicrotask(() => socket.receive({ id: frame.id, error: { message: 'private upstream detail' } })); return true; } });
  const peer = await rpcError.agent(); await assert.rejects(peer.request('thread/start', {}), error => error.code === 'NATIVE_FAILED' && !error.message.includes('private upstream'));
  peer.socket.bufferedAmount = nativeRuntimeLimits.frame + 1;
  await assert.rejects(peer.request('thread/start', {}), { code: 'NETWORK' });
  const opaque = scriptedRuntime(this); let guards = 0;
  await assert.rejects(opaque.check(randomUUID(), undefined, async () => { if (++guards === 4) throw new Error('private guard detail'); }),
    error => error.code === 'NETWORK' && !error.message.includes('private guard'));
});

Then('native stalled pairing retries only tickets while malformed live frames revoke owned work', async function () {
  const retry = scriptedRuntime(this, { fetch: f => f.calls === 1 ? new Response(null, { status: 409 })
    : Response.json({ ticket: 'T'.repeat(43), expiresAt: f.now + 1000, identity: f.identity }) });
  retry.runtime.requestMs = 500; await retry.agent(); assert.equal(retry.calls, 2);
  assert.equal(retry.frames.filter(frame => frame.method === 'initialize').length, 1);
  const stalled = scriptedRuntime(this, { send: frame => frame.type === 'pair' });
  // The shared request deadline aborts the handshake before its socket timer.
  await assert.rejects(stalled.check(), { code: 'CANCELLED' }); assert.equal(stalled.sockets[0].readyState, 3);
  const cancel = new AbortController(), cancelled = scriptedRuntime(this, { send: frame => frame.type === 'pair' });
  const opening = cancelled.check(randomUUID(), cancel.signal), rejected = assert.rejects(opening, { code: 'CANCELLED' });
  await wait(() => cancelled.sockets.length); cancel.abort(); await rejected;
  const fetching = scriptedRuntime(this, { fetch: (_f, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('closed while opening')), { once: true });
  }) });
  const work = fetching.check(), closed = assert.rejects(work, { code: 'CANCELLED' });
  await wait(() => fetching.calls); fetching.broker.clear(); await closed; assert.deepEqual(fetching.sockets, []);
  for (const payload of ['binary', 'ambiguous', 'foreign', 'notification', 'expired', 'huge']) {
    const f = scriptedRuntime(this, { send: frame => frame.method === 'thread/start' }), peer = await f.agent();
    const result = peer.request('thread/start', {}), failure = assert.rejects(result, { code: 'NETWORK' });
    await wait(() => f.frames.some(frame => frame.method === 'thread/start'));
    const id = f.frames.find(frame => frame.method === 'thread/start').id;
    if (payload === 'binary') peer.socket.dispatchEvent(new MessageEvent('message', { data: new Uint8Array([1]) }));
    else if (payload === 'ambiguous') peer.socket.receive({ id, result: {}, error: {} });
    else if (payload === 'foreign') peer.socket.receive({ id: 'foreign', result: {} });
    else if (payload === 'notification') peer.socket.receive({ method: 'foreign', params: {} });
    else if (payload === 'huge') peer.socket.receive('x'.repeat(nativeRuntimeLimits.frame + 1));
    else { f.now = peer.expiresAt; peer.socket.receive({ id, result: {} }); }
    await failure; assert.equal(peer.socket.readyState, 3);
  }
  const failed = scriptedRuntime(this, { send(frame) { if (frame.type === 'pair') throw new Error('socket unavailable'); } });
  await assert.rejects(failed.check(), { code: 'AUTHORIZATION' });
});

Then('native saved authority rejects malformed bindings duplicate owners and removed profiles', async function () {
  const f = await fixture(this), v = await vault(f);
  try {
    await assert.rejects(v.session.pairNativeRuntime({ ...v.input, pairingKeyId: randomUUID() }, v.selection), { code: 'PERMISSION' });
    const saved = await v.session.pairNativeRuntime(v.input, v.selection), { connected: _connected, ...connection } = saved;
    for (const binding of [{ runtime: nativeReference(connection), fingerprint: 1 }, { runtime: nativeReference(connection), fingerprint: 'bad' },
      { runtime: { ...nativeReference(connection), revision: 0 }, fingerprint: 'a'.repeat(64) }]) assert.throws(() => validateNativeBinding(binding), { code: 'INVALID' });
    assert.deepEqual(validateNativeBinding({ runtime: nativeReference(connection), fingerprint: 'a'.repeat(64) }).runtime, nativeReference(connection));
    assert.throws(() => storedNativeConnections([{ id: randomUUID(), nativeConnections: [connection] }]), { code: 'INVALID' });
    assert.throws(() => storedNativeConnections([{ id: v.keyId, nativeConnections: [connection, connection] }]), { code: 'LIMIT' });
    await assert.rejects(v.session.disconnectNativeRuntime(nativeReference(connection), 'yes'), { code: 'INVALID' });
    await assert.rejects(v.session.disconnectNativeRuntime({ ...nativeReference(connection), revision: 2 }), { code: 'CONFLICT' });
    f.account = { type: 'apiKey' }; await assert.rejects(v.session.checkNativeRuntime(nativeReference(connection), v.selection), { code: 'AUTHORIZATION' });
    assert.deepEqual(await v.session.disconnectNativeRuntime(nativeReference(connection), true), []);
    await assert.rejects(v.session.checkNativeRuntime(nativeReference(connection), v.selection), { code: 'CONFLICT' });
  } finally { v.session.lock(); }
});

async function rewriteNativeRecord(v, snapshot, mutate) {
  v.session.lock();
  const context = item => ({ vaultId: snapshot.id, epoch: snapshot.epoch, kind: item.kind, id: item.id, revision: item.revision });
  const envelope = snapshot.envelopes.find(item => item.id === v.proof.methodId);
  const key = await unwrapVaultKey(envelope.wrappedKey, await recoveryKey(v.proof.secret, envelope.salt), context(envelope));
  const values = await Promise.all(snapshot.records.map(record => decryptJSON(key, record.ciphertext, context(record))));
  await mutate(values);
  const records = await Promise.all(snapshot.records.map(async (record, index) => ({ ...record, ciphertext: await encryptJSON(key, values[index], context(record)) })));
  v.storage.state.snapshot = await sealSnapshot({ id: snapshot.id, epoch: snapshot.epoch, revision: snapshot.revision, envelopes: snapshot.envelopes, records }, key);
  v.storage.state.revision++; v.storage.state.lockEpoch++;
  v.session = v.newSession(); await v.session.unlock(v.proof); return values;
}

Then('native encrypted records reject malformed collections altered fingerprints and excessive saved authority', async function () {
  const f = await fixture(this), v = await vault(f);
  try {
    const paired = await v.session.pairNativeRuntime(v.input, v.selection), selections = await v.workflowSelections();
    await v.session.enableNativeWorkflow(nativeReference(paired), selections);
    const snapshot = structuredClone(v.storage.state.snapshot);
    for (const mutate of [owner => owner.nativeConnections = {}, owner => owner.nativeConnections = Array(33).fill(owner.nativeConnections[0]),
      owner => owner.nativeConnections.push(owner.nativeConnections[0])]) {
      await rewriteNativeRecord(v, snapshot, values => mutate(values.find(value => value.id === v.keyId)));
      await assert.rejects(v.session.nativeConnections(), { code: 'LIMIT' });
    }
    await rewriteNativeRecord(v, snapshot, values => values.find(value => value.id === v.keyId).nativeConnections[0].pairingKeyId = randomUUID());
    await assert.rejects(v.session.nativeConnections(), { code: 'INVALID' });
    for (const mutate of [owner => owner.value = 'R'.repeat(43), owner => owner.nativeConnections[0].keyHash = 'd'.repeat(64),
      owner => owner.nativeConnections[0].modelFingerprint = 'd'.repeat(64), owner => owner.nativeConnections[0].fingerprint = 'd'.repeat(64)]) {
      const values = await rewriteNativeRecord(v, snapshot, records => mutate(records.find(value => value.id === v.keyId)));
      const connection = values.find(value => value.id === v.keyId).nativeConnections[0], reference = nativeReference(connection), before = f.requests.length;
      await assert.rejects(v.session.checkNativeRuntime(reference, v.selection), { code: 'AUTHORIZATION' });
      await assert.rejects(v.session.enableNativeWorkflow(reference, selections), { code: 'AUTHORIZATION' });
      assert.equal(f.requests.length, before, 'Altered encrypted authority cannot create a ticket.');
    }
    await rewriteNativeRecord(v, snapshot, values => {
      const owner = values.find(value => value.id === v.keyId), connection = owner.nativeConnections[0];
      owner.nativeConnections = Array.from({ length: 32 }, () => ({ ...connection, id: randomUUID() }));
    });
    await assert.rejects(v.session.pairNativeRuntime(v.input, v.selection), { code: 'LIMIT' });
    const other = await v.workflowSelections();
    await assert.rejects(v.session.pairNativeRuntime(v.input, other.find(value => value.operation.rpc.method === 'thread/start')), { code: 'PERMISSION' });
  } finally { v.session.lock(); }
});

Then('native runtime defaults retain TLS trust and changed peer authority forces a fresh check', async function () {
  const host = await fixture(this), defaults = new NativeRuntimeBroker({ fetch: host.fetch, WebSocket: host.Socket }); this.nativeBrokers.push(defaults);
  const id = randomUUID(); await defaults.check(id, host.publicOrigin, host.key, 'c'.repeat(64), undefined, async () => {});
  assert.equal(defaults.connected(id), true); defaults.close(id); await wait(() => host.stops === host.starts);
  const untrusted = new NativeRuntimeBroker({ fetch: host.fetch, requestMs: 300 }); this.nativeBrokers.push(untrusted);
  const before = host.starts; await assert.rejects(untrusted.check(randomUUID(), host.publicOrigin, host.key, 'c'.repeat(64), undefined, async () => {}));
  assert.equal(host.starts, before, 'Default browser sockets cannot bypass TLS and Origin checks.');
  const f = scriptedRuntime(this), owner = randomUUID(); await f.check(owner);
  await f.broker.check(owner, f.host, f.key, 'd'.repeat(64), undefined, async () => {});
  assert.equal(f.calls, 2); assert.equal(f.sockets[0].readyState, 3);
  f.key = 'Q'.repeat(43); await f.check(owner); assert.equal(f.calls, 3);
  f.identity.workspace = 'd'.repeat(64);
  await f.broker.check(owner, f.host, f.key, 'c'.repeat(64), f.identity, async () => {});
  assert.equal(f.calls, 4); assert.equal(f.broker.connected(owner), true);
  const foreign = scriptedRuntime(this);
  await assert.rejects(foreign.broker.agent(randomUUID(), foreign.host, foreign.key, 'c'.repeat(64), { ...foreign.identity, workspace: 'd'.repeat(64) },
    async () => {}, { frame: () => true, closed() {} }), { code: 'AUTHORIZATION' }); assert.deepEqual(foreign.sockets, []);
  const authority = scriptedRuntime(this), peer = await authority.agent(randomUUID(), { frame: () => true, closed() {} });
  peer.socket.receive({ type: 'authority', identity: { ...authority.identity, workspace: 'd'.repeat(64) } });
  assert.equal(peer.socket.readyState, 3, 'A consumer cannot accept changes to pinned runtime authority.');
});

Then('native cancellation and disconnect during asynchronous guards cannot publish a paired peer', async function () {
  for (const phase of [2, 3]) for (const mode of ['cancel', 'deadline', 'disconnect']) {
    if (phase === 2 && mode === 'disconnect') continue;
    const f = scriptedRuntime(this), cancel = new AbortController(); let calls = 0;
    await assert.rejects(f.check(randomUUID(), cancel.signal, async () => {
      if (++calls !== phase) return;
      if (mode === 'cancel') cancel.abort();
      else if (mode === 'disconnect') f.sockets[0].close();
      else await new Promise(resolve => setTimeout(resolve, 100));
    }), { code: mode === 'cancel' ? 'CANCELLED' : 'NETWORK' });
    assert.ok(f.sockets.every(socket => socket.readyState === 3));
  }
  const error = scriptedRuntime(this, { send(frame, socket) { if (frame.method !== 'initialize') return false;
    queueMicrotask(() => socket.receive({ id: frame.id, error: { message: 'private initialization detail' } })); return true; } });
  await assert.rejects(error.agent(), { code: 'NATIVE_FAILED' }); assert.equal(error.sockets[0].readyState, 3);
  const checking = scriptedRuntime(this, { send(frame, socket) { if (frame.method !== 'account/read') return false;
    queueMicrotask(() => socket.receive({ id: frame.id, error: { message: 'private account detail' } })); return true; } });
  await assert.rejects(checking.check(), { code: 'AUTHORIZATION' });
  const opening = scriptedRuntime(this, { fetch: (_f, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('closed during initialization')), { once: true });
  }) });
  const run = opening.agent(), failed = assert.rejects(run, { code: 'CANCELLED' });
  await wait(() => opening.calls); opening.broker.clear(); await failed; assert.deepEqual(opening.sockets, []);
});

Then('native handshake expiry closes an unacknowledged socket before the overall request deadline', { timeout: 10000 }, async function () {
  const f = scriptedRuntime(this, { send: frame => frame.type === 'pair' }); f.runtime.requestMs = 10000;
  await assert.rejects(f.check(), { code: 'NETWORK' }); assert.equal(f.sockets[0].readyState, 3);
  assert.equal(f.frames.some(frame => frame.method === 'initialize'), false);
});
