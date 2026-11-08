// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { gzipSync } from 'node:zlib';
import { Then } from '@cucumber/cucumber';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperations } from './lib/catalog.ts';
import { adaptGithubArchives, githubArchiveProfile, githubArchiveContracts, isGithubArchive } from './lib/github-archive.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed, CredentialResponseError } from './lib/secrets/execution.ts';
import { fetchGithubArchive } from './lib/secrets/github-archive.ts';
import { createHttpConnection, connectionCredentialIds, httpConnectionMatches, httpConnectionReference } from './lib/secrets/http-connections.ts';
import { encodeWorkflowBinary } from './lib/workflow-binary.ts';
import { VaultSession } from './lib/secrets/session.ts';
import { privateVault, noSecrets } from '../tests/credential-results/fixture.mjs';
import { forwardGithubArchive, createGithubArchiveCompanion } from '../companions/github-archive/host.mjs';

const host = 'https://archive-companion.example.test', storage = 'https://migration-storage.example.test';
const signed = storage + '/private/migration.tar.gz?signature=synthetic-private-archive-signature';
const pairing = 'A'.repeat(43), token = 'synthetic-archive-classic-user-token';
const archive = gzipSync(Buffer.from('Synthetic tar archive content, without account data.'));
let pending;
async function models() {
  return pending ??= (async () => {
    const corrected = await readServiceSchema('github'), published = await readServiceSchemaUpstream('github');
    const subset = { ...corrected, paths: Object.fromEntries(githubArchiveContracts.map(row => [row.path, { get: corrected.paths[row.path].get }])) };
    return { corrected, published, models: inspectServiceSchema(subset, 'github').operations, strict: extractOperations(subset, 'github') };
  })();
}
async function fixture(index = 0) {
  const operation = (await models()).models[index], descriptor = await approvedOperation(operation, 'https://api.github.com');
  const records = [{ id: crypto.randomUUID(), label: 'Archive token', kind: 'secret', value: token, grants: [] },
    { id: crypto.randomUUID(), label: 'Archive pairing', kind: 'secret', value: pairing, grants: [] }];
  const manual = { alternative: 0, fingerprint: descriptor.fingerprint, credentials: { GitHubClassicUserToken: records[0].id } };
  const connection = await createHttpConnection({ label: 'Archive fixture', account: 'Owner', format: 'schema',
    relay: { host, pairingKeyId: records[1].id } }, descriptor, manual, records);
  records.find(record => record.id === connectionCredentialIds(connection)[0]).connections = [connection];
  return { operation, descriptor, manual, records, connection, binding: { alternative: 0, fingerprint: descriptor.fingerprint,
    credentials: {}, connection: httpConnectionReference(connection) }, values: { 'path:migration_id': '79', ...(index ? { 'path:org': 'fixture-org' } : {}) } };
}
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port));
});
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
function localFetch(address, init) {
  return new Promise((resolve, reject) => {
    const call = httpRequest(address, { method: init.method, headers: Object.fromEntries(new Headers(init.headers)), signal: init.signal }, response => {
      const parts = []; response.on('data', part => parts.push(part)); response.on('error', reject);
      response.on('end', () => resolve(new Response(Buffer.concat(parts), { status: response.statusCode, headers: response.headers })));
    });
    call.on('error', reject); call.end(init.body);
  });
}
const input = address => ({ profile: githubArchiveProfile, fingerprint: 'a'.repeat(64), address,
  authorization: 'Bearer ' + token });
const userAddress = 'https://api.github.com/user/migrations/79/archive';

Then('both archive models preserve native302 contracts and require the qualified companion', async () => {
  const f = await models();
  for (const [index, contract] of githubArchiveContracts.entries()) {
    const operation = f.models[index];
    assert.equal(operation.id, contract.id); assert.equal(operation.unavailableReason, undefined);
    assert.equal(isGithubArchive(operation), true); assert.equal(isGithubArchive(f.strict[index]), true);
    assert.deepEqual(operation.fields.map(field => [field.key, field.type, field.required]), f.strict[index].fields.map(field => [field.key, field.type, field.required]));
    assert.deepEqual(f.corrected.paths[contract.path].get.responses, f.published.paths[contract.path].get.responses);
    assert.equal(f.corrected.paths[contract.path].get['x-operations-github-archive'], githubArchiveProfile);
    assert.equal(f.published.paths[contract.path].get['x-operations-github-archive'], undefined);
    for (const mutate of [op => { delete op.githubArchive; }, op => { op.githubArchive = 'unreviewed'; },
      op => { op.path = '/user/migrations'; }, op => { op.method = 'POST'; }, op => { op.responseContent['200']['application/gzip'] = 'text'; },
      op => { op.security[0][0].name = 'GitHubInstallationToken'; }]) {
      const changed = structuredClone(operation); mutate(changed);
      await assert.rejects(approvedOperation(changed, 'https://api.github.com'));
    }
    await assert.rejects(approvedOperation(operation, 'https://other.example.test'));
    for (const mutate of [source => { source.responses['302'].description += ' changed'; }, source => { source.parameters = []; },
      source => { source.operationId = 'changed'; }]) {
      const source = structuredClone(f.published); mutate(source.paths[contract.path].get);
      assert.throws(() => adaptGithubArchives(source));
    }
    const call = await fixture(index); let calls = 0;
    await assert.rejects(executeCredentialed(call.descriptor, call.values, call.manual, call.records,
      { assertCurrent() {}, async fetchRequest() { calls++; assert.fail('No direct browser redirect request'); } }), { code: 'GITHUB_ARCHIVE_TRANSPORT' });
    assert.equal(calls, 0);
  }
});

Then('both private archive requests follow one302 and preserve exact compressed bytes without forwarding credentials', async () => {
  const hops = [];
  const upstream = createServer((req, res) => {
    req.resume(); hops.push({ path: req.url, headers: req.headers, method: req.method });
    if (req.url.startsWith('/private/')) { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'x-private-location': signed }); res.end(archive); }
    else { res.writeHead(302, { Location: signed, 'x-private-token': token }); res.end(); }
  });
  const local = await listen(upstream);
  const companion = createGithubArchiveCompanion({ publicOrigin: host, pairingKey: pairing,
    allowedOrigins: ['https://operations.example.test'], storageOrigins: [storage] }, {
    request(address, options, callback) {
      assert.equal(options.rejectUnauthorized, true); assert.equal(options.method, 'GET');
      const url = new URL(address); assert.ok(['https://api.github.com', storage].includes(url.origin));
      return httpRequest(local + url.pathname + url.search, options, callback);
    },
  });
  const server = createServer((req, res) => { void companion.handle(req, res); }), base = await listen(server);
  let transportStatus = 0;
  const transport = async (address, init) => {
    assert.equal(address, host + '/v1/github/migration-archive');
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + pairing);
    const reply = await localFetch(base + '/v1/github/migration-archive', { ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers)), Host: new URL(host).host, Origin: 'https://operations.example.test' } });
    transportStatus = reply.status;
    return reply;
  };
  try {
    for (let index = 0; index < 2; index++) {
      const f = await fixture(index), result = await executeCredentialed(f.descriptor, f.values, f.binding, f.records,
        { assertCurrent() {}, fetchRequest: transport }).catch(error => {
          error.message += ` (fixture companion HTTP${transportStatus}; upstream hops${hops.length})`; throw error;
        });
      assert.equal(result.response.status, 200); assert.equal(result.response.bodyType, 'binary');
      assert.equal(result.response.headers['x-operations-source-status'], '302');
      assert.deepEqual(Buffer.from(result.response.body.base64, 'base64'), archive);
      noSecrets(result, [token, pairing, signed, 'synthetic-private-archive-signature']);
      const [api, file] = hops.slice(index * 2);
      assert.equal(api.path, index ? '/orgs/fixture-org/migrations/79/archive' : '/user/migrations/79/archive');
      assert.equal(api.headers.authorization, 'Bearer ' + token);
      assert.equal(file.path, '/private/migration.tar.gz?signature=synthetic-private-archive-signature');
      for (const name of ['authorization', 'proxy-authorization', 'cookie', 'referer']) assert.equal(file.headers[name], undefined);
      assert.equal(file.method, 'GET');
    }
    assert.equal(hops.length, 4);
    for (const [origin, key, path, expected] of [['https://wrong.example.test', pairing, '/v1/github/migration-archive', 403],
      ['https://operations.example.test', 'wrong', '/v1/github/migration-archive', 401],
      ['https://operations.example.test', pairing, '/proxy', 403]]) {
      const response = await localFetch(base + path, { method: 'POST', body: '{}', headers: {
        Host: new URL(host).host, Origin: origin, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } });
      assert.equal(response.status, expected);
    }
    assert.equal(hops.length, 4);
  } finally { companion.close(); await close(server); await close(upstream); }
});

Then('the archive host rejects unapproved locations extra redirects oversized bytes and cancelled requests', async () => {
  let mode = 'unlisted', calls = 0, second = 0;
  const upstream = createServer((req, res) => {
    req.resume(); calls++;
    if (req.url.startsWith('/private/')) {
      second++;
      if (mode === 'redirect') { res.writeHead(302, { Location: 'https://other.example.test/private' }); res.end(); }
      else if (mode === 'large') { res.writeHead(200, { 'Content-Type': 'application/gzip' }); res.end(Buffer.concat([archive, Buffer.alloc(500001)])); }
      else if (mode === 'chunked') { res.writeHead(200, { 'Content-Type': 'application/gzip' }); res.write(archive); res.end(Buffer.alloc(500001)); }
      else if (mode === 'invalid') { res.writeHead(200, { 'Content-Type': 'application/gzip' }); res.end('not gzip'); }
      else if (mode === 'media') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(archive); }
      else { res.writeHead(403, { 'Content-Type': 'text/plain', 'x-private-location': signed }); res.end(token + signed); }
    } else if (mode === 'denial') { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end(token + signed); }
    else { res.writeHead(302, { Location: mode === 'unlisted' ? 'https://other.example.test/private' : mode === 'http' ? signed.replace('https:', 'http:')
      : mode === 'credentials' ? signed.replace('https://', 'https://user:password@') : mode === 'fragment' ? signed + '#fragment' : signed }); res.end(); }
  }), local = await listen(upstream);
  const runtime = { request(address, options, callback) { const url = new URL(address); return httpRequest(local + (url.origin === storage ? url.pathname + url.search : '/api'), options, callback); } };
  try {
    const noDispatch = { request() { assert.fail('Invalid archive request must not open a socket'); } };
    for (const altered of [{ ...input(userAddress), address: 'http://127.0.0.1/private' }, { ...input(userAddress), address: userAddress + '?x=1' },
      { ...input(userAddress), address: userAddress.replace('/79/', '/%2e%2e/') }, { ...input(userAddress), authorization: 'Bearer bad\r\nCookie: x' },
      { ...input(userAddress), extra: true }]) await assert.rejects(forwardGithubArchive(altered, [storage], undefined, noDispatch));
    for (const selected of ['unlisted', 'http', 'credentials', 'fragment', 'redirect', 'large', 'chunked', 'invalid', 'media']) {
      mode = selected; const before = second;
      await assert.rejects(forwardGithubArchive(input(userAddress), [storage], undefined, runtime));
      assert.equal(second - before, ['unlisted', 'http', 'credentials', 'fragment'].includes(mode) ? 0 : 1);
    }
    mode = 'denial'; const denial = await forwardGithubArchive(input(userAddress), [storage], undefined, runtime);
    assert.equal(denial.status, 403); assert.equal(denial.body, null); noSecrets(denial, [token, signed]);
    mode = 'storage-denial'; const expired = await forwardGithubArchive(input(userAddress), [storage], undefined, runtime);
    assert.equal(expired.status, 403); assert.equal(expired.body, null); noSecrets(expired, [token, signed]);
    const controller = new AbortController(); controller.abort(); const before = calls;
    await assert.rejects(forwardGithubArchive(input(userAddress), [storage], controller.signal, runtime)); assert.equal(calls, before);
  } finally { await close(upstream); }
});

Then('archive pairing references survive encrypted reload and invalidate on rotation or removal', async () => {
  const f = await fixture(), vault = await privateVault(), ids = [];
  for (const [label, value] of [['Archive token', token], ['Archive pairing', pairing]])
    ids.push((await vault.session.put(null, { label, kind: 'secret', value })).find(item => item.label === label).id);
  const manual = { ...f.manual, credentials: { GitHubClassicUserToken: ids[0] } };
  const connection = await vault.session.putConnection({ label: 'Private archive', account: 'Owner', format: 'schema',
    relay: { host, pairingKeyId: ids[1] } }, f.descriptor, manual);
  noSecrets(await vault.session.backup(), [token, pairing, host, connection.label]);
  vault.session.lock(); await assert.rejects(vault.session.connections(), { code: 'LOCKED' });
  const reloaded = new VaultSession(vault.storage); await reloaded.unlock(vault.proof);
  assert.deepEqual(await reloaded.connections(), [connection]);
  assert.ok(await reloaded.connectionBinding(httpConnectionReference(connection), f.descriptor));
  const other = await approvedOperation((await models()).models[1], 'https://api.github.com');
  assert.equal(httpConnectionMatches(connection, other), true);
  await reloaded.put(vault.proof, { id: ids[1], label: 'Archive pairing', kind: 'secret', value: 'B'.repeat(43) });
  const rotated = (await reloaded.connections())[0]; assert.equal(rotated.revision, connection.revision + 1);
  await assert.rejects(reloaded.connectionBinding(httpConnectionReference(connection), f.descriptor), { code: 'PERMISSION' });
  await assert.rejects(reloaded.connectionBinding(httpConnectionReference(rotated), f.descriptor), { code: 'PERMISSION' });
  await reloaded.remove(vault.proof, ids[1]); assert.deepEqual(await reloaded.connections(), []); reloaded.lock();
});

Then('malformed archive replies changed guards and permission failures expose no private response material', async () => {
  const f = await fixture(), file = encodeWorkflowBinary('migration.tar.gz', archive, 'application/gzip');
  const valid = { profile: githubArchiveProfile, fingerprint: f.descriptor.fingerprint, status: 200, body: file };
  const init = { method: 'GET', headers: { Authorization: 'Bearer ' + token }, body: null };
  for (const reply of [{ ...valid, fingerprint: 'b'.repeat(64) }, { ...valid, location: signed },
    { ...valid, status: 302 }, { ...valid, status: 403, body: token + signed },
    { ...valid, body: { ...file, name: 'private-' + token } }, { ...valid, body: { ...file, size: file.size + 1 } }]) {
    await assert.rejects(fetchGithubArchive(f.descriptor, f.connection.relay, f.records, userAddress, init,
      async () => Response.json(reply), () => {}));
  }
  let guards = 0;
  await assert.rejects(fetchGithubArchive(f.descriptor, f.connection.relay, f.records, userAddress, init,
    async () => Response.json(valid), () => { if (++guards === 2) throw Object.assign(new Error('Changed vault'), { code: 'PERMISSION' }); }), { code: 'PERMISSION' });
  let calls = 0;
  await assert.rejects(executeCredentialed(f.descriptor, f.values, f.binding, f.records, { assertCurrent() {}, async fetchRequest() {
    calls++; return Response.json({ ...valid, status: 403, body: null });
  } }), error => error instanceof CredentialResponseError && error.response.status === 403 && !JSON.stringify(error.response).includes(token));
  assert.equal(calls, 1);
});
