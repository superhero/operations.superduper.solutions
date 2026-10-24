// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { extractOperations, updateCatalogs } from './lib/catalog.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { validateSchemaDocument, operationServerUrl } from './lib/schema-documents.ts';
import { telegramBotOrigin, telegramBotTemplate, serverUrlHasPlaceholder } from './lib/server-url.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { createHttpConnection, httpConnectionReference } from './lib/secrets/http-connections.ts';
import { telegramPrivateUrl, privateUrlRedactions } from './lib/secrets/telegram-path.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { createWorkflowExecution, createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { encodeWorkflowBinary } from './lib/workflow-binary.ts';
import { applySchemaPatches, telegramPrivatePath, telegramPrivatePathSourceSha256 } from './lib/schema-patches.ts';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { portableWorkflowDocument, validateWorkflowDocument } from './lib/workflow-document.ts';

const token = '123456789:TELEGRAM_PRIVATE_canary_5729', encoder = new TextEncoder();
const annotation = { 'x-operations-private-path': 'telegram-bot' };
const responses = { 200: { description: 'Result', content: { 'application/json': { schema: { type: 'object' } } } },
  default: { description: 'Error', content: { 'application/json': { schema: { type: 'object' } } } } };
function document() {
  const request = media => ({ required: true, content: { [media]: { schema: { type: 'object', required: ['chat_id', media === 'application/json' ? 'text' : 'document'],
    properties: { chat_id: { type: 'integer' }, ...(media === 'application/json' ? { text: { type: 'string' } } : { document: { type: 'string', format: 'binary' } }) } } } } });
  return { openapi: '3.1.0', info: { title: 'Private Telegram fixture', version: '1' },
    servers: [{ url: telegramBotTemplate, variables: { botToken: { default: '<bot_token>' } } }],
    paths: { '/getMe': { post: { ...annotation, operationId: 'getMe', responses } },
      '/sendMessage': { post: { ...annotation, operationId: 'sendMessage', requestBody: request('application/json'), responses } },
      '/sendDocument': { post: { ...annotation, operationId: 'sendDocument', requestBody: request('multipart/form-data'), responses } } } };
}
function key(value = token) { return { id: crypto.randomUUID(), label: 'Bot credential', kind: 'secret', value, grants: [] }; }
async function connection(operation, credential = key()) {
  const descriptor = await approvedOperation(operation, telegramBotOrigin);
  const manual = { alternative: 0, credentials: { 'Bot token': credential.id }, fingerprint: descriptor.fingerprint };
  const profile = await createHttpConnection({ label: 'Bot connection', account: 'Test bot', format: 'schema' }, descriptor, manual, [credential]);
  credential.connections = [profile];
  return { descriptor, credential, profile, manual, binding: { alternative: 0, credentials: {}, fingerprint: descriptor.fingerprint, connection: httpConnectionReference(profile) } };
}
const tokenForms = [token, ...['%3A', '%3a', '%253A', '%253a'].map(colon => token.replace(':', colon))];
const safe = value => { for (const secret of tokenForms) assert.ok(!JSON.stringify(value).includes(secret), 'A private URL token escaped its boundary'); };
async function fixture(action) {
  const doc = document(), models = extractOperations(doc, 'telegram-fixture'), previous = [...catalogs];
  updateCatalogs([...previous, { id: 'telegram-fixture', name: 'Telegram fixture', file: 'telegram-fixture.json', document: doc, groups: [], execution: { kind: 'http', origin: telegramBotOrigin } }]);
  try { return await action({ doc, models }); } finally { updateCatalogs(previous); }
}

Then('the reviewed Telegram correction retains native bytes and qualifies only its fixed private template', async () => {
  const raw = await readServiceSchemaUpstream('telegram'), doc = await readServiceSchema('telegram');
  assert.equal(createHash('sha256').update(JSON.stringify(raw)).digest('hex'), telegramPrivatePathSourceSha256);
  assert.deepEqual(serviceSchemaDescriptors.find(item => item.id === 'telegram').patches, [telegramPrivatePath]);
  assert.deepEqual(doc.servers, raw.servers); assert.deepEqual(applySchemaPatches(doc, [telegramPrivatePath]), doc);
  const inspected = inspectServiceSchema(doc, 'telegram'); assert.equal(inspected.operations.length, 180);
  assert.equal(inspected.operations.find(item => item.id === 'telegram:getMe').unavailableReason, undefined);
  assert.ok(inspected.operations.every(item => item.privatePath === 'telegram-bot'));
  assert.ok(inspected.operations.filter(item => !item.unavailableReason).length > 0);
  for (const mutate of [doc => { doc.servers[0].url = 'https://evil.example.test/bot{botToken}'; }, doc => { doc.servers[0].variables.botToken.default = token; },
    doc => { doc.paths['/getMe'].post.servers = [{ url: telegramBotOrigin }]; }]) {
    const changed = structuredClone(raw); mutate(changed); assert.throws(() => applySchemaPatches(changed, [telegramPrivatePath]), /reviewed|unreviewed/);
  }
  console.log('Telegram qualification: '+JSON.stringify({ methods: inspected.operations.length, available: inspected.operations.filter(item => !item.unavailableReason).length,
    unavailable: inspected.operations.filter(item => item.unavailableReason).map(item => ({ id: item.id, reason: item.unavailableReason })) }));
});

Then('one saved connection supplies getMe JSON and multipart private Telegram URLs without publishing the token', async () => {
  await fixture(async ({ models, doc }) => {
    validateSchemaDocument(doc, 'telegram-fixture'); const f = await connection(models[0]); let calls = 0;
    const binary = Uint8Array.of(0, 255, 13, 10);
    const executor = createWorkflowExecution((descriptor, values, context, signal) => executeCredentialed(descriptor, values, context.binding, [f.credential], {
      signal, assertCurrent() {}, fetchRequest: async (url, init) => {
        calls++; assert.equal(String(url), telegramBotOrigin+'/bot'+token+descriptor.operation.path);
        assert.equal(init.headers.get('Authorization'), null); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
        if (descriptor.operation.path === '/sendMessage') assert.deepEqual(JSON.parse(init.body), { chat_id: 42, text: 'Hello' });
        if (descriptor.operation.path === '/sendDocument') {
          assert.ok(init.body instanceof FormData); assert.equal(init.body.get('chat_id'), '42');
          assert.deepEqual(new Uint8Array(await init.body.get('document').arrayBuffer()), binary); assert.equal(init.headers.has('Content-Type'), false);
        }
        return Response.json({ ok: true, result: {} });
      } }));
    for (const operation of models) {
      const descriptor = await approvedOperation(operation, telegramBotOrigin), binding = { ...f.binding, fingerprint: descriptor.fingerprint };
      const values = operation.path === '/getMe' ? {} : operation.path === '/sendMessage' ? { 'body:chat_id': '42', 'body:text': 'Hello' }
        : { 'body:chat_id': '42', 'body:document': JSON.stringify(encodeWorkflowBinary('bytes.bin', binary)) };
      const result = await executor.execute(operation, values, undefined, { binding, runId: crypto.randomUUID(), nodeId: 'telegram' });
      safe(result); assert.equal(result.request.path, operation.path); assert.equal(result.response.status, 200);
    }
    assert.equal(calls, 3); safe(doc);
  });
});

Then('native Telegram getMe JSON messages and sticker files dispatch through saved private token references', async () => {
  const doc = await readServiceSchema('telegram'), models = inspectServiceSchema(doc, 'telegram').operations;
  const f = await connection(models.find(item => item.id === 'telegram:getMe')); let calls = 0;
  for (const name of ['getMe', 'sendMessage', 'uploadStickerFile']) {
    const model = models.find(item => item.id === 'telegram:'+name); assert.equal(model.unavailableReason, undefined);
    const descriptor = await approvedOperation(model, operationServerUrl(doc, model));
    const values = name === 'getMe' ? {} : name === 'sendMessage' ? { 'body:chat_id': '42', 'body:text': 'Hello' }
      : { 'body:user_id': '42', 'body:sticker_format': 'static', 'body:sticker': JSON.stringify(encodeWorkflowBinary('sticker.webp', Uint8Array.of(0, 255, 1, 2))) };
    const result = await executeCredentialed(descriptor, values,
      { ...f.binding, fingerprint: descriptor.fingerprint }, [f.credential], { assertCurrent() {}, fetchRequest: async (url, init) => {
        calls++; assert.equal(String(url), telegramBotOrigin+'/bot'+token+'/'+name);
        if (name === 'uploadStickerFile') {
          assert.ok(init.body instanceof FormData); assert.equal(init.body.get('user_id'), '42'); assert.equal(init.body.get('sticker_format'), 'static');
          assert.deepEqual(new Uint8Array(await init.body.get('sticker').arrayBuffer()), Uint8Array.of(0, 255, 1, 2));
        }
        return Response.json({ ok: true, result: {} });
      } }); safe(result);
  }
  assert.equal(calls, 3);
});

Then('raw encoded and double encoded Telegram URL echoes never escape private results or errors', async () => {
  const model = extractOperations(document(), 'telegram-fixture')[0], f = await connection(model), url = telegramBotOrigin+'/bot'+token+'/getMe';
  const echoes = [...tokenForms, url, encodeURIComponent(url), encodeURIComponent(encodeURIComponent(url)), ...privateUrlRedactions(url)];
  for (const status of [200, 400, 401, 429]) {
    let calls = 0;
    try {
      const result = await executeCredentialed(f.descriptor, {}, f.binding, [f.credential], { assertCurrent() {}, fetchRequest: async () => {
        calls++; return new Response(JSON.stringify({ echoes }), { status, statusText: 'Result '+token, headers: { 'Content-Type': 'application/json', 'X-URL': echoes.at(-1) } });
      } }); assert.equal(status, 200); safe(result); assert.equal(result.response.redacted, true);
    } catch (error) { assert.notEqual(status, 200); assert.equal(error.response.status, status); safe(error.response); safe(error.message); }
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(executeCredentialed(f.descriptor, {}, f.binding, [f.credential], { assertCurrent() {}, fetchRequest: async () => {
    calls++; throw Object.assign(new TypeError('Failed '+url), { cause: new Error(url) });
  } }), error => { safe(error.message); assert.equal(error.code, 'NETWORK'); assert.equal(error.cause, undefined); return true; });
  assert.equal(calls, 1);
});

Then('malformed missing cross origin stale and traversal Telegram bindings fail before any request', async () => {
  const model = extractOperations(document(), 'telegram-fixture')[0], f = await connection(model); let calls = 0;
  const options = { assertCurrent() {}, fetchRequest: async () => { calls++; return Response.json({ ok: true }); } };
  const invalid = ['no-token', '123:a/b', '123:../evil', '123:abc?redirect=evil', '123:abc#x', '123:abc%2fgetMe', '123:abc%253F', '123:abc\\x', '123:ab c', '123:abc\u0000', 'https://evil.example.test', '123:'+"a".repeat(257)];
  for (const value of invalid) await assert.rejects(executeCredentialed(f.descriptor, {}, f.binding, [{ ...f.credential, value }], options));
  for (const binding of [f.manual, { ...f.binding, connection: { ...f.binding.connection, revision: 2 } }, { ...f.binding, connection: { ...f.binding.connection, id: crypto.randomUUID() } }, { ...f.binding, fingerprint: '0'.repeat(64) }])
    await assert.rejects(executeCredentialed(f.descriptor, {}, binding, [f.credential], options));
  await assert.rejects(executeCredentialed(f.descriptor, {}, f.binding, [], options));
  for (const path of ['/getMe/../sendMessage', '//evil.example', '/getMe%2FsendMessage', '/%2e%2e', '/getMe?x=1'])
    await assert.rejects(approvedOperation({ ...model, path }, telegramBotOrigin));
  for (const endpoint of ['https://evil.example.test', telegramBotOrigin+'.evil.example', telegramBotOrigin+'/extra', 'http://api.telegram.org', telegramBotOrigin+'/bot'+token])
    await assert.rejects(approvedOperation(model, endpoint));
  assert.throws(() => telegramPrivateUrl(f.descriptor, '/other', token));
  assert.equal(calls, 0);
});

Then('unreviewed Telegram and unrelated server placeholders cannot enter public execution', async () => {
  const doc = document(); delete doc.paths['/getMe'].post['x-operations-private-path'];
  assert.throws(() => operationServerUrl(doc, { path: '/getMe', method: 'POST' }), /placeholder/);
  for (const server of ['https://{account}.example.test', 'https://api.telegram.org/bot{other}', 'https://api.telegram.org/bot%7BbotToken%7D']) {
    const changed = document(); changed.servers[0].url = server;
    assert.throws(() => validateSchemaDocument(changed, 'telegram-fixture'));
  }
  assert.equal(serverUrlHasPlaceholder(telegramBotTemplate), true);
  const literal = document();
  for (const item of Object.values(literal.paths)) delete item.post['x-operations-private-path'];
  literal.servers[0].variables.botToken.default = token;
  assert.throws(() => validateSchemaDocument(literal, 'telegram-fixture'), /private bot token connection/);
  await fixture(async ({ models }) => {
    const f = await connection(models[0]); let calls = 0;
    await assert.rejects(createWorkflowRequestExecution(async () => { calls++; return Response.json({ ok: true }); }).execute(models[0], {}, undefined,
      { binding: f.binding, runId: crypto.randomUUID(), nodeId: 'telegram' }));
    assert.equal(calls, 0);
  });
});

Then('Telegram connection previews schemas history and portable documents contain no token values', async () => {
  const doc = document(), model = extractOperations(doc, 'telegram-fixture')[0], f = await connection(model);
  const workflow = validateWorkflowDocument({ version: 3, id: 'telegram', name: 'Telegram', nodes: [{ id: 'telegram-op', type: 'operation', position: { x: 0, y: 0 },
    data: { operationId: model.id, name: model.name, description: '', method: 'POST', path: '/getMe', credentialBinding: f.binding } }], edges: [],
    viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: false, dashed: false });
  for (const value of [doc, f.descriptor, f.profile, workflow, prepareRequest(model, {}), portableWorkflowDocument(workflow)]) safe(value);
  assert.ok(!JSON.stringify(portableWorkflowDocument(workflow)).includes(f.profile.id));
  assert.deepEqual(validateWorkflowDocument(JSON.parse(JSON.stringify(workflow))).nodes[0].data.credentialBinding, f.binding);
});
