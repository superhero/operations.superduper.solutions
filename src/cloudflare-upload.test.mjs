// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { CloudflareUploadSessions } from './lib/secrets/cloudflare-upload.ts';
import { cloudflareOrigin, cloudflareUploadContracts, uploadSessionConsumer } from './lib/cloudflare-upload.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { VaultError } from './lib/secrets/types.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { extractOperations, updateCatalogs } from './lib/catalog.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { applySchemaPatches, cloudflarePrivateUpload, cloudflarePrivateUploadSourceSha256 } from './lib/schema-patches.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { encodeWorkflowBinary } from './lib/workflow-binary.ts';
import { createWorkflowExecution, createWorkflowRequestExecution } from './lib/workflow-execution.ts';

const account = 'a'.repeat(32), hashA = 'a'.repeat(32), hashB = 'b'.repeat(32);
const fileA = encodeWorkflowBinary('a.bin', Uint8Array.of(0, 255, 13, 10)), fileB = encodeWorkflowBinary('b.txt', new TextEncoder().encode('second'), 'text/plain');
const apiToken = 'CF_ACCOUNT_TOKEN_canary_5729';
const b64url = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (label, expiry = Math.floor(Date.now()/1000)+3600) => b64url({ alg: 'HS256', typ: 'JWT' })+'.'+b64url({ exp: expiry, label })+'.c3ludGhldGlj';
function document() {
  const paths = {};
  for (const [profile, [method, path]] of Object.entries(cloudflareUploadContracts)) {
    paths[path] ??= {};
    const temporary = uploadSessionConsumer(profile), kind = profile === 'workers-upload' ? 'workers' : 'pages';
    paths[path][method.toLowerCase()] = { operationId: profile, summary: profile, 'x-operations-cloudflare-upload': profile,
      security: temporary ? [{ [kind === 'workers' ? 'assets_jwt' : 'pages_upload_token']: [] }] : [{ api_token: [] }],
      responses: { 200: { description: 'Safe result', content: { 'application/json': { schema: { type: 'object' } } } } } };
  }
  return { openapi: '3.0.3', info: { title: 'Cloudflare upload fixture', version: '1' }, servers: [{ url: cloudflareOrigin }], paths,
    components: { securitySchemes: { api_token: { type: 'http', scheme: 'bearer' },
      assets_jwt: { type: 'http', scheme: 'bearer', 'x-operations-cloudflare-upload-token': 'workers' },
      pages_upload_token: { type: 'http', scheme: 'bearer', 'x-operations-cloudflare-upload-token': 'pages' } } } };
}
function fixture() {
  let now = Date.now(); const manager = new CloudflareUploadSessions(() => now), doc = document(), models = extractOperations(doc, 'cf-fixture');
  const record = { id: crypto.randomUUID(), label: 'Account token', kind: 'bearer', value: apiToken, grants: [] }, calls = [];
  const uploadToken = jwt('CF_UPLOAD_PRIVATE_5729'), completionToken = jwt('CF_COMPLETION_PRIVATE_5729'), pagesToken = jwt('CF_PAGES_PRIVATE_5729');
  const model = profile => models.find(item => item.cloudflareUpload === profile);
  const descriptors = new Map();
  async function descriptor(profile) {
    if (!descriptors.has(profile)) descriptors.set(profile, await approvedOperation(model(profile), cloudflareOrigin)); return descriptors.get(profile);
  }
  async function run(profile, values, reference, responder, extra = {}) {
    const d = await descriptor(profile), security = d.operation.security[0];
    const binding = { alternative: 0, fingerprint: d.fingerprint, credentials: { [security[0].name]: reference ?? record.id } };
    return executeCredentialed(d, values, binding, [record], { uploadSessions: manager, assertCurrent() {}, ...extra,
      fetchRequest: async (url, init) => { const call = { url: String(url), init, profile }; calls.push(call); return responder ? responder(call) : response(profile); } });
  }
  function response(profile) {
    const result = profile === 'workers-session' || profile === 'platform-session' ? { jwt: uploadToken, buckets: [[hashA], [hashB]] }
      : profile === 'pages-session' ? { jwt: pagesToken } : profile === 'workers-upload' ? { jwt: completionToken }
      : profile === 'pages-check' ? [hashA] : { id: 'safe-version-id' };
    return Response.json({ success: true, result }, { status: profile === 'workers-upload' ? 201 : 200 });
  }
  return { manager, doc, model, models, descriptor, record, calls, run, response, uploadToken, completionToken, pagesToken, advance(ms) { now += ms; } };
}
const pathValues = { 'path:account_id': account, 'path:script_name': 'test-worker', 'path:dispatch_namespace': 'test-namespace', 'path:project_name': 'test-project' };
const manifest = { '/a.bin': { hash: hashA, size: fileA.size }, '/b.txt': { hash: hashB, size: fileB.size } };
const initial = { ...pathValues, 'body:manifest': JSON.stringify(manifest) };
const upload = files => ({ 'path:account_id': account, 'query:base64': 'true', 'body:files': JSON.stringify(files) });
const complete = reference => ({ ...pathValues, 'body:metadata': JSON.stringify({ main_module: 'main.js', assets: { jwt: reference }, compatibility_date: '2026-01-01' }),
  'body:files': JSON.stringify({ 'main.js': encodeWorkflowBinary('main.js', new TextEncoder().encode('export default {}'), 'application/javascript') }) });
const reference = result => result.response.body.result.session;
const refused = error => error instanceof VaultError;
function safe(f, result) {
  for (const token of [apiToken, f.uploadToken, f.completionToken, f.pagesToken])
    for (const form of [token, encodeURIComponent(token), btoa(token)]) assert.ok(!JSON.stringify(result).includes(form), 'Private upload material crossed the public boundary');
}
async function acquire(f, empty = false) {
  const result = await f.run('workers-session', initial, undefined, empty ? () => Response.json({ success: true, result: { jwt: f.completionToken, buckets: [] } }) : undefined);
  safe(f, result); return reference(result);
}
async function oneFileSession(f) {
  const result = await f.run('workers-session', { ...initial, 'body:manifest': JSON.stringify({ '/a.bin': manifest['/a.bin'] }) }, undefined,
    () => Response.json({ success: true, result: { jwt: f.uploadToken, buckets: [[hashA]] } }));
  return reference(result);
}

Then('the pinned Cloudflare upload correction preserves native bytes and unrelated contracts', async () => {
  const raw = await readServiceSchemaUpstream('cloudflare'), patched = await readServiceSchema('cloudflare');
  assert.equal(createHash('sha256').update(JSON.stringify(raw)).digest('hex'), cloudflarePrivateUploadSourceSha256);
  assert.deepEqual(serviceSchemaDescriptors.find(item => item.id === 'cloudflare').patches, [cloudflarePrivateUpload]);
  assert.deepEqual(applySchemaPatches(patched, [cloudflarePrivateUpload]), patched);
  const changed = structuredClone(patched); delete changed.components.securitySchemes.assets_jwt; delete changed.components.securitySchemes.pages_upload_token;
  const selected = new Set();
  for (const [profile, [method, path]] of Object.entries(cloudflareUploadContracts)) {
    const original = raw.paths[path][method.toLowerCase()], adapted = changed.paths[path][method.toLowerCase()];
    assert.equal(adapted.operationId, original.operationId); assert.deepEqual(adapted.security, original.security);
    assert.equal(adapted['x-operations-cloudflare-upload'], profile);
    assert.ok(!JSON.stringify(adapted.responses).includes('"jwt"'));
    delete adapted['x-operations-cloudflare-upload']; adapted.responses = original.responses; selected.add('cloudflare:'+original.operationId);
  }
  assert.deepEqual(changed, raw);
  const models = inspectServiceSchema(patched, 'cloudflare', selected).operations;
  assert.equal(models.length, 10); assert.deepEqual(models.filter(item => item.unavailableReason).map(item => [item.id, item.unavailableReason]), []);
  assert.equal(models.filter(item => item.security?.[0]?.[0]?.kind === 'cloudflare-upload').length, 4);
  const evil = structuredClone(raw); evil.servers[0].url = 'https://evil.example.test'; assert.throws(() => applySchemaPatches(evil, [cloudflarePrivateUpload]), /reviewed/);
  console.log('Cloudflare upload qualification:10 reviewed models,4 temporary-token consumers;3761 native methods retained');
});

Then('a Workers upload session sends base64 file parts and consumes its private completion token', async () => {
  const f = fixture(), session = await acquire(f);
  const first = await f.run('workers-upload', upload({ [hashA]: fileA }), session, async call => {
    assert.equal(call.init.headers.get('Authorization'), 'Bearer '+f.uploadToken); assert.ok(call.init.body instanceof FormData);
    const part = call.init.body.get(hashA); assert.equal(await part.text(), fileA.base64); assert.equal(part.type, fileA.mediaType);
    assert.equal(call.init.headers.has('Content-Type'), false); assert.ok(call.url.endsWith('/workers/assets/upload?base64=true'));
    return Response.json({ success: true, result: {} }, { status: 202 });
  });
  assert.equal(reference(first), session); assert.deepEqual(first.response.body.result.buckets, [[hashB]]); safe(f, first);
  const second = await f.run('workers-upload', upload({ [hashB]: fileB }), session, async call => {
    assert.equal(await call.init.body.get(hashB).text(), fileB.base64); return f.response('workers-upload');
  });
  const completion = reference(second); assert.notEqual(completion, session); assert.equal(second.response.body.result.phase, 'completion'); safe(f, second);
  const finished = await f.run('workers-version', complete(completion), undefined, async call => {
    assert.equal(call.init.headers.get('Authorization'), 'Bearer '+apiToken);
    const metadata = JSON.parse(await call.init.body.get('metadata').text()); assert.equal(metadata.assets.jwt, f.completionToken);
    assert.equal(await call.init.body.get('main.js').text(), 'export default {}'); assert.equal(call.init.body.get('main.js').type, 'application/javascript');
    assert.equal(call.init.credentials, 'omit'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.referrerPolicy, 'no-referrer');
    return f.response('workers-version');
  });
  assert.equal(finished.response.body.result.completed, true); assert.equal(finished.response.body.result.id, 'safe-version-id'); safe(f, finished);
  assert.equal(f.calls.length, 4); assert.equal(f.calls[0].init.headers.get('Authorization'), 'Bearer '+apiToken);
  await assert.rejects(f.run('workers-version', complete(completion)), refused); assert.equal(f.calls.length, 4);
});

Then('an empty Workers upload bucket becomes a completion reference without an upload request', async () => {
  const f = fixture(), session = await acquire(f, true);
  await f.run('workers-version', complete(session), undefined, async call => {
    assert.equal(JSON.parse(await call.init.body.get('metadata').text()).assets.jwt, f.completionToken); return f.response('workers-version');
  });
  assert.deepEqual(f.calls.map(item => item.profile), ['workers-session', 'workers-version']);
});

Then('Pages checks uploads and registers hashes with its private short lived token', async () => {
  const f = fixture(), acquired = await f.run('pages-session', pathValues), session = reference(acquired); safe(f, acquired);
  const call = async (profile, body) => {
    const result = await f.run(profile, body, session, request => {
      assert.equal(request.init.headers.get('Authorization'), 'Bearer '+f.pagesToken); return f.response(profile);
    }); safe(f, result); return result;
  };
  const missing = await call('pages-check', { 'body:hashes': JSON.stringify([hashA, hashB]) });
  assert.deepEqual(missing.response.body.result.missing, [hashA]);
  await call('pages-upload', { 'body:$': JSON.stringify([{ key: hashA, value: fileA.base64, base64: true, metadata: { contentType: fileA.mediaType } }]) });
  const result = await call('pages-complete', { 'body:hashes': JSON.stringify([hashA, hashB]) });
  assert.equal(result.response.body.result.completed, true); assert.equal(f.calls.length, 4);
  await assert.rejects(call('pages-check', { 'body:hashes': '[]' }), refused); assert.equal(f.calls.length, 4);
});

Then('a workflow upload reference selects private transport without exposing or persisting its JWT', async () => {
  const f = fixture(), session = await oneFileSession(f), previous = [...catalogs];
  updateCatalogs([...previous, { id: 'cf-fixture', name: 'Cloudflare fixture', file: 'cf.json', document: f.doc, groups: [], execution: { kind: 'http', origin: cloudflareOrigin } }]);
  try {
    let seen = 0;
    const executor = createWorkflowExecution((descriptor, values, context) => executeCredentialed(descriptor, values, context.binding, [f.record], {
      uploadSessions: f.manager, assertCurrent() {}, fetchRequest: async (_url, init) => {
        seen++; assert.equal(init.headers.get('Authorization'), 'Bearer '+f.uploadToken); return f.response('workers-upload');
      },
    }));
    const result = await executor.execute(f.model('workers-upload'), { ...upload({ [hashA]: fileA }), 'header:Authorization': session });
    assert.equal(result.response.body.result.phase, 'completion'); assert.equal(seen, 1); safe(f, result);
    assert.ok(!JSON.stringify(f.record).includes(f.uploadToken));
  } finally { updateCatalogs(previous); }
});

Then('Cloudflare upload references reject expiry tenant changes schema changes wrong phases and cleared sessions', async () => {
  for (const mode of ['expired', 'account', 'schema', 'completion', 'cleared', 'forged', 'owner']) {
    const f = fixture(), session = await oneFileSession(f); let d = await f.descriptor('workers-upload'), input = upload({ [hashA]: fileA }), id = session;
    if (mode === 'expired') f.advance(3600001);
    if (mode === 'account') input['path:account_id'] = 'c'.repeat(32);
    if (mode === 'schema') d = await approvedOperation({ ...d.operation, id: 'other:upload' }, cloudflareOrigin);
    if (mode === 'cleared') f.manager.clear();
    if (mode === 'forged') id = crypto.randomUUID();
    if (mode === 'completion') { await assert.rejects(f.run('workers-version', complete(session)), refused); assert.equal(f.calls.length, 1); continue; }
    if (mode === 'owner') {
      const completion = await acquire(f, true); f.record.id = crypto.randomUUID();
      await assert.rejects(f.run('workers-version', complete(completion)), refused); assert.equal(f.calls.length, 2); continue;
    }
    await assert.rejects(executeCredentialed(d, input, { alternative: 0, fingerprint: d.fingerprint, credentials: { assets_jwt: id } }, [f.record], {
      uploadSessions: f.manager, assertCurrent() {}, fetchRequest: async () => { assert.fail('Invalid reference dispatched'); },
    }), refused);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(); await assert.rejects(approvedOperation(f.model('workers-session'), 'https://evil.example.test'), refused);
});

Then('Cloudflare validates manifest sizes bucket membership base64 mode and completion module parts', async () => {
  for (const mode of ['size', 'hash', 'base64', 'combined', 'header']) {
    const f = fixture(), session = await acquire(f), input = upload({ [hashA]: fileA });
    if (mode === 'size') input['body:files'] = JSON.stringify({ [hashA]: fileB });
    if (mode === 'hash') input['body:files'] = JSON.stringify({ ['c'.repeat(32)]: fileA });
    if (mode === 'base64') input['query:base64'] = 'false';
    if (mode === 'combined') input['body:files'] = JSON.stringify({ [hashA]: fileA, [hashB]: fileB });
    if (mode === 'header') input['header:Authorization'] = crypto.randomUUID();
    await assert.rejects(f.run('workers-upload', input, session)); assert.equal(f.calls.length, 1);
  }
  const f = fixture(), session = await acquire(f, true), input = complete(session); input['body:files'] = '{}';
  await assert.rejects(f.run('workers-version', input), refused); assert.equal(f.calls.length, 1);
  const bad = fixture(); await assert.rejects(bad.run('workers-session', { ...initial, 'body:manifest': JSON.stringify({ 'bad\\path': manifest['/a.bin'] }) }), refused);
  assert.equal(bad.calls.length, 0);
});

Then('Cloudflare failure cancellation malformed responses and token echoes stay private and invalidate references', async () => {
  for (const mode of ['http', 'network', 'malformed', 'expired', 'cancel', 'authority']) {
    const f = fixture(), session = await oneFileSession(f), controller = new AbortController(); let checks = 0;
    const result = await f.run('workers-upload', upload({ [hashA]: fileA }), session, () => {
      if (mode === 'network') throw new Error(f.uploadToken);
      if (mode === 'cancel') { controller.abort(); throw new Error(f.uploadToken); }
      if (mode === 'malformed') return new Response(f.completionToken, { headers: { 'Content-Type': 'application/json' } });
      if (mode === 'expired') return Response.json({ success: true, result: { jwt: jwt('EXPIRED', 1) } }, { status: 201 });
      if (mode === 'http') return Response.json({ success: false, result: { jwt: f.completionToken }, errors: [{ message: f.uploadToken }] }, { status: 403 });
      return f.response('workers-upload');
    }, { signal: controller.signal, assertCurrent() { if (mode === 'authority' && ++checks > 1) throw new VaultError('PERMISSION'); } }).catch(error => error);
    assert.ok(result instanceof Error); assert.equal(result.cause, undefined); safe(f, result);
    const count = f.calls.length; await assert.rejects(f.run('workers-upload', upload({ [hashA]: fileA }), session), refused); assert.equal(f.calls.length, count);
  }
  const f = fixture(), session = await oneFileSession(f);
  const result = await f.run('workers-upload', upload({ [hashA]: fileA }), session, () => Response.json({ success: true,
    result: { jwt: f.completionToken, echo: f.uploadToken } }, { status: 201, headers: { 'X-Echo': f.completionToken } }));
  assert.equal(result.response.headers['x-echo'], undefined); assert.equal(result.response.body.result.phase, 'completion'); safe(f, result);
});

Then('Cloudflare custom base64 encoding leaves ordinary binary multipart and account token requests unchanged', async () => {
  const generic = { method: 'POST', path: '/ordinary', query: {}, contentType: 'multipart/form-data', body: { file: fileA } };
  const form = requestBody(generic); assert.ok(form instanceof FormData);
  assert.deepEqual(new Uint8Array(await form.get('file').arrayBuffer()), Uint8Array.of(0, 255, 13, 10));
  const f = fixture(), operation = { id: 'cf-fixture:ordinary', name: 'Ordinary', group: 'Cloudflare', description: '', method: 'GET', path: '/user', fields: [],
    bodyRequired: false, responseMediaType: 'application/json', security: [[{ name: 'api_token', kind: 'bearer', header: 'Authorization' }]] };
  const d = await approvedOperation(operation, cloudflareOrigin);
  const result = await executeCredentialed(d, {}, { alternative: 0, fingerprint: d.fingerprint, credentials: { api_token: f.record.id } }, [f.record], {
    assertCurrent() {}, fetchRequest: async (_url, init) => { assert.equal(init.headers.get('Authorization'), 'Bearer '+apiToken); return Response.json({ success: true, result: { id: 'user' } }); },
  }); safe(f, result);
});

Then('Cloudflare private profiles reject anonymous authority altered wire models and public dispatch', async () => {
  const f = fixture(), previous = [...catalogs];
  updateCatalogs([...previous, { id: 'cf-fixture', name: 'Cloudflare fixture', file: 'cf.json', document: f.doc, groups: [], execution: { kind: 'http', origin: cloudflareOrigin } }]);
  try {
    const publicExecutor = createWorkflowRequestExecution(async () => { assert.fail('Private profile used public transport'); });
    for (const profile of ['workers-session', 'workers-upload', 'workers-version']) {
      const model = f.model(profile);
      await assert.rejects(publicExecutor.execute(model, profile === 'workers-session' ? initial : profile === 'workers-upload' ? upload({ [hashA]: fileA }) : complete(crypto.randomUUID())), refused);
    }
    const model = f.model('workers-session');
    for (const changed of [{ ...model, security: [] }, { ...model, bodyValue: true }, { ...model, responseMediaType: 'text/plain' }])
      await assert.rejects(approvedOperation(changed, cloudflareOrigin), refused);
  } finally { updateCatalogs(previous); }
});

Then('a platform asset session completes only for its original Worker namespace and account', async () => {
  const f = fixture(), started = await f.run('platform-session', initial), session = reference(started);
  const first = await f.run('workers-upload', upload({ [hashA]: fileA }), session, () => Response.json({ success: true, result: {} }, { status: 202 }));
  const uploaded = await f.run('workers-upload', upload({ [hashB]: fileB }), reference(first));
  const result = await f.run('platform-module', complete(reference(uploaded)), undefined, async call => {
    assert.ok(call.url.includes('/dispatch/namespaces/test-namespace/scripts/test-worker'));
    assert.equal(JSON.parse(await call.init.body.get('metadata').text()).assets.jwt, f.completionToken); return f.response('platform-module');
  });
  assert.equal(result.response.body.result.completed, true); assert.equal(f.calls.length, 4); safe(f, result);
  const other = fixture(), cached = await other.run('platform-session', initial, undefined, () => Response.json({ success: true, result: { jwt: other.completionToken, buckets: [] } }));
  await assert.rejects(other.run('platform-module', { ...complete(reference(cached)), 'path:dispatch_namespace': 'other-namespace' }), refused);
  assert.equal(other.calls.length, 1);
});
