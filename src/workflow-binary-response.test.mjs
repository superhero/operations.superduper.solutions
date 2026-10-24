// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { catalogs } from './lib/catalog-registry.ts';
import { extractOperations, updateCatalogs } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { encodeWorkflowBinary, validateWorkflowBinary, workflowBinaryBlob, maxWorkflowUploadBytes } from './lib/workflow-binary.ts';
import { readWorkflowResponseBody, responseFileName, inspectResponseContent } from './lib/workflow-response-body.ts';
import { createWorkflowExecution, createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { createOperationGraph, isWorkflowConnection } from './lib/workflow-graph.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { parseWorkflowDocument } from './lib/workflow-document.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const origin = 'https://download.example.test', secret = 'synthetic-private-download-9182';
const credentialId = '86f57925-2311-4fb2-bb46-684186062c95';
const payload = Uint8Array.from({ length: 256 }, (_, index) => index);
const fileSchema = { type: 'string', format: 'binary' };
const source = privateMode => ({ openapi: '3.1.0', info: { title: 'Download fixtures', version: '1' }, servers: [{ url: origin }],
  ...(privateMode ? { components: { securitySchemes: { Key: { type: 'apiKey', in: 'header', name: 'X-Key' } } }, security: [{ Key: [] }] } : {}),
  paths: {
    '/download': { post: { operationId: 'download', responses: { 200: { description: 'File or JSON', content: {
      'application/json': { schema: { type: 'object' } }, 'application/pdf': { schema: fileSchema } } } } } },
    '/upload': { post: { operationId: 'upload', requestBody: { required: true, content: { 'application/pdf': { schema: fileSchema } } },
      responses: { 200: { description: 'Accepted', content: { 'application/json': { schema: { type: 'object' } } } } } } },
    '/ordinary': { get: { operationId: 'ordinary', responses: { 200: { description: 'JSON', content: { 'application/json': { schema: { type: 'object' } } } } } } },
  } });
const workflow = (nodes, edges) => ({ version: 3, id: 'download-test', name: 'Download test', nodes, edges,
  viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false });
const binaryReply = (bytes = payload, headers = {}) => new Response(bytes, { headers: { 'Content-Type': 'application/pdf',
  'Content-Disposition': 'attachment; filename="exact.pdf"', ...headers } });
async function fixture(mode, action) {
  const doc = source(mode === 'private'), models = extractOperations(doc, 'download');
  assert.deepEqual(inspectServiceSchema(doc, 'download').operations.map(model => model.responseContent), models.map(model => model.responseContent));
  const previous = [...catalogs];
  updateCatalogs([...previous, { id: 'download', name: 'Downloads', file: 'download.json', document: doc, groups: [], execution: { kind: 'http', origin } }]);
  const credentials = [{ id: credentialId, label: 'Private key', kind: 'secret', value: secret }];
  const binding = async operation => ({ alternative: 0, credentials: { Key: credentialId }, fingerprint: (await approvedOperation(operation, origin)).fingerprint });
  const execute = async (operation, fetchRequest, signal) => mode === 'private'
    ? executeCredentialed(await approvedOperation(operation, origin), {}, await binding(operation), credentials, { assertCurrent() {}, fetchRequest, signal })
    : createWorkflowRequestExecution(fetchRequest).execute(operation, {}, signal);
  try { return await action({ doc, models, credentials, binding, execute }); }
  finally { updateCatalogs(previous); }
}

Then('{string} responses preserve exact declared bytes through mapping and storage', async mode => {
  await fixture(mode, async ({ doc, models, credentials, binding, execute }) => {
    const model = models[0];
    assert.equal(model.responseMediaType, 'application/json', 'JSON is preferred, but must not override an actual permitted file.');
    for (const data of [payload, new Uint8Array(), new Uint8Array(maxWorkflowUploadBytes).fill(179)]) {
      const result = await execute(model, async (_url, init) => {
        assert.equal(new Headers(init.headers).get('X-Key'), mode === 'private' ? secret : null);
        return binaryReply(data);
      });
      assert.equal(result.response.bodyType, 'binary'); assert.equal(result.response.mediaType, 'application/pdf');
      const file = validateWorkflowBinary(result.response.body); assert.equal(file.name, 'exact.pdf');
      assert.deepEqual(new Uint8Array(await workflowBinaryBlob(file).arrayBuffer()), data);
      const stored = workflow([{ id: 'result', type: 'file', position: { x: 0, y: 0 }, data: { file: { name: file.name, format: 'binary', source: '', value: file,
        options: { delimiter: 'auto', header: 'auto', quote: 'auto' }, delimiter: '', header: false, encoding: 'binary' } } }], []);
      const loaded = parseWorkflowDocument(JSON.stringify(stored));
      assert.deepEqual(loaded.nodes[0].data.file.value, file);
    }
    const first = createOperationGraph(model, { x: 0, y: 0 }, 'get', doc), second = createOperationGraph(models[1], { x: 800, y: 0 }, 'send', doc);
    const panel = first.nodes.find(node => node.type === 'data' && node.data.fields.some(field => field.label === 'Response body' && field.type === 'Binary'));
    const input = second.nodes.find(node => node.type === 'data' && node.data.direction === 'inputs');
    assert.ok(panel); const output = panel.data.fields.find(field => field.type === 'Binary');
    const edge = { id: 'bytes', kind: 'mapping', source: panel.id, sourceHandle: output.id, target: input.id, targetHandle: input.data.fields[0].id };
    const nodes = [...first.nodes, ...second.nodes], edges = [...first.edges, ...second.edges];
    assert.equal(isWorkflowConnection(edge, nodes, edges), true); edges.push(edge);
    const saved = parseWorkflowDocument(JSON.stringify(workflow(nodes, edges)));
    let calls = 0;
    const fetchRequest = async (url, init) => {
      calls++;
      if (String(url).endsWith('/download')) return binaryReply();
      assert.deepEqual(new Uint8Array(await init.body.arrayBuffer()), payload); return Response.json({ accepted: true });
    };
    const executor = mode === 'private' ? createWorkflowExecution((approved, values, context, signal) => executeCredentialed(approved, values, context.binding, credentials,
      { signal, assertCurrent() {}, fetchRequest })) : createWorkflowRequestExecution(fetchRequest);
    const runner = createWorkflowRunner(saved, 'get', executor);
    assert.equal(runner.next().kind, 'operation');
    await runner.submit({}, mode === 'private' ? await binding(model) : undefined);
    const next = runner.next(); assert.equal(next.kind, 'operation'); assert.equal(next.operation.id, models[1].id);
    assert.deepEqual(JSON.parse(next.values['body:$']), encodeWorkflowBinary('exact.pdf', payload, 'application/pdf'));
    await runner.submit(next.values, mode === 'private' ? await binding(models[1]) : undefined);
    assert.equal(runner.next().kind, 'complete'); assert.equal(calls, 2);
  });
});

Then('{string} binary response handling rejects {string} without exposing a partial file', async (mode, kind) => {
  await fixture(mode, async ({ models, execute }) => {
    let cancelled = false, calls = 0;
    const controller = new AbortController();
    const stream = new ReadableStream({ start(c) {
      if (kind === 'oversized') { c.enqueue(new Uint8Array(500000)); c.enqueue(new Uint8Array(1)); }
      else if (kind === 'broken stream') c.error(new Error('synthetic read failure'));
      else if (kind !== 'aborted') c.enqueue(kind === 'stream json' ? new TextEncoder().encode('{"event":"value"}') : payload);
    }, pull(c) { if (kind === 'empty chunks') c.enqueue(new Uint8Array()); }, cancel() { cancelled = true; } });
    const media = kind === 'stream json' ? 'application/stream+json' : kind === 'events' ? 'text/event-stream' : kind === 'ndjson' ? 'application/x-ndjson' : kind === 'wrong media' ? 'image/png' : 'application/pdf';
    const model = ['undeclared binary', 'events', 'ndjson', 'stream json'].includes(kind) ? models[2] : models[0];
    const pending = execute(model, async () => { calls++; if (kind === 'aborted') queueMicrotask(() => controller.abort());
      return new Response(stream, { headers: { 'Content-Type': media, 'Content-Length': '1' } }); }, controller.signal);
    await assert.rejects(pending, error => {
      assert.ok(!JSON.stringify(error).includes('base64'));
      if (kind === 'oversized') assert.ok(error.code === 'LIMIT' || /size limit/.test(error.message));
      if (kind === 'aborted') assert.match(error.message, /cancelled/i);
      return true;
    });
    assert.equal(calls, 1);
    if (kind !== 'broken stream') assert.equal(cancelled, true);
  });
});

Then('credential echoes withhold the entire binary result and stop downstream operations', async () => {
  await fixture('private', async ({ doc, models, credentials, binding }) => {
    const graph = createOperationGraph(models[0], { x: 0, y: 0 }, 'get', doc);
    for (const encoding of ['utf8', 'utf16le', 'utf16be', 'filename', 'base64']) {
      credentials[0].value = encoding === 'base64' ? 'AAAA' : secret;
      const text = new TextEncoder().encode(secret);
      const bytes = encoding.startsWith('utf16') ? Uint8Array.from([...secret].flatMap(character => encoding==='utf16le' ? [character.charCodeAt(0), 0] : [0, character.charCodeAt(0)])) : text;
      let calls = 0;
      const execution = createWorkflowExecution((approved, values, context, signal) => executeCredentialed(approved, values, context.binding, credentials, { signal, assertCurrent() {},
        fetchRequest: async () => { calls++; return binaryReply(encoding==='base64' ? new Uint8Array(3) : encoding==='filename' ? payload : bytes, encoding==='filename' ? { 'Content-Disposition': `attachment; filename="${secret}.bin"` } : {}); } }));
      const runner = createWorkflowRunner(workflow(graph.nodes, graph.edges), 'get', execution);runner.next();
      const result = await runner.submit({}, await binding(models[0]));
      assert.equal(result.response.body, null);assert.equal(result.response.redacted, true);assert.equal(result.response.bodyType, undefined);
      assert.ok(!JSON.stringify(result).includes(secret)); assert.ok(!JSON.stringify(result).includes(btoa(secret)));
      assert.ok(!JSON.stringify(result).includes(credentials[0].value));
      assert.throws(() => runner.next(), /Sensitive response/);
      await assert.rejects(runner.submit({}, await binding(models[0])), /ready to run/); assert.equal(calls, 1);
    }
  });
});

Then('response media metadata preserves JSON text and bodyless compatibility and selects matching branches', async () => {
  await fixture('public', async ({ models }) => {
    const operation = models[0];
    const read = (response, method='GET') => readWorkflowResponseBody(response, operation, method, new AbortController().signal);
    assert.deepEqual((await read(Response.json({ exact: true }))).body, { exact: true });
    assert.equal((await read(new Response('{"bad":', { headers: { 'Content-Type': 'application/json' } }))).malformedJson, true);
    for (const [status, method] of [[204,'POST'],[205,'POST'],[200,'HEAD']]) assert.equal((await read(new Response(null,{status}),method)).body,null);
    const textOperation = { ...models[1], responseMediaType: 'application/json' };
    assert.equal((await readWorkflowResponseBody(new Response('actual text'), textOperation,'GET',new AbortController().signal)).body,'actual text');
    const untyped = new Response('{"fallback":true}');untyped.headers.delete('Content-Type');
    assert.deepEqual((await readWorkflowResponseBody(untyped,textOperation,'GET',new AbortController().signal)).body,{fallback:true});
    const range = { ...operation, responseContent: { '2XX': { 'application/pdf': 'binary' }, DEFAULT: { 'application/json': 'json' } } };
    assert.equal((await readWorkflowResponseBody(binaryReply(),range,'GET',new AbortController().signal)).bodyType,'binary');
    range.responseContent['200'] = { 'application/json': 'json' };
    await assert.rejects(readWorkflowResponseBody(binaryReply(),range,'GET',new AbortController().signal),/undeclared/);
    const generic = { ...operation, responseContent: { '200': { 'application/octet-stream': 'binary' } } };
    for (const type of ['application/json', 'text/plain']) {
      const exactText = '  {"bytes":true}\n';
      const downloaded = await readWorkflowResponseBody(new Response(exactText, { headers: { 'Content-Type': type } }), generic, 'GET', new AbortController().signal);
      assert.equal(downloaded.bodyType, 'binary');assert.equal(await workflowBinaryBlob(downloaded.body).text(), exactText);
    }
    assert.equal(inspectResponseContent({200:{content:{'application/json':{schema:{type:'object'}}}}},{}),undefined);
  });
});

Then('binary response filenames cannot supply paths or invalid envelopes', () => {
  for (const header of [null, 'attachment; filename="../../safe.pdf"', "attachment; filename*=UTF-8''f%C3%B6o.pdf", 'attachment; filename=".."', 'attachment; filename="bad\\path.pdf"',
    "attachment; filename*=UTF-8''%FF; filename=plain.pdf", 'attachment; filename="'+ 'x'.repeat(300) +'"'])
    assert.doesNotThrow(() => validateWorkflowBinary(encodeWorkflowBinary(responseFileName(header), payload)));
  assert.equal(responseFileName("attachment; filename*=UTF-8''f%C3%B6o.pdf"),'föo.pdf');
  assert.equal(responseFileName('attachment; filename="../../safe.pdf"'),'safe.pdf');
});

Then('the pinned OpenAI file download sends a private bearer and returns exact binary bytes', async () => {
  const { readServiceSchema } = await import('./lib/service-schema-packs.ts');
  const { createSchemaDiscovery } = await import('./lib/schema-index.ts');
  const { scopeOperationSchema } = await import('./lib/operation-report.ts');
  const { operations, publishPreparedCatalogs, operationSourceIdentity, installOperationModel } = await import('./lib/catalog.ts');
  const { createHash } = await import('node:crypto');
  const document = await readServiceSchema('openai'), inspected = inspectServiceSchema(document, 'openai');
  const revision = createHash('sha256').update(JSON.stringify(document)).digest('hex');
  const discovery = createSchemaDiscovery(inspected, revision);
  const catalog = { id: 'openai', file: 'openai.json', name: inspected.name, document: discovery.document, groups: discovery.groups,
    execution: { kind: 'http', origin: inspected.serverUrl } };
  const previous = catalogs.map(catalog => ({ catalog, operations: operations.filter(operation => operation.id.startsWith(`${catalog.id}:`)),
    sourceIdentity: operationSourceIdentity(`${catalog.id}:`) }));
  try {
    publishPreparedCatalogs([...previous.filter(item => item.catalog.id !== 'openai'), { catalog, operations: discovery.operations, sourceIdentity: revision }]);
    const selected = inspected.operations.find(operation => operation.id === 'openai:downloadFile');
    assert.equal(selected.unavailableReason, undefined);
    const scoped = scopeOperationSchema(document, selected.path, selected.method, true).schema;
    const operation = installOperationModel({ operation: selected, document: scoped, origin: inspected.serverUrl, sourceIdentity: revision, bytes: Buffer.byteLength(JSON.stringify(scoped)) });
    assert.equal(operation.responseContent['200']['application/octet-stream'], 'binary');
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, 'native-file', document);
    assert.ok(graph.nodes.some(node => node.type==='data' && node.data.fields.some(field => field.label==='Response body' && field.type==='Binary' && field.connectable)));
    const descriptor = await approvedOperation(operation, inspected.serverUrl), scheme = operation.security[0][0];
    assert.equal(scheme.kind, 'bearer');
    let calls = 0;
    const result = await executeCredentialed(descriptor, { 'path:file_id': 'file-test' }, { alternative: 0, credentials: { [scheme.name]: credentialId }, fingerprint: descriptor.fingerprint },
      [{ id: credentialId, label: 'Synthetic OpenAI key', kind: 'secret', value: secret }], { assertCurrent() {}, fetchRequest: async (url, init) => {
        calls++;assert.equal(String(url),'https://api.openai.com/v1/files/file-test/content');
        assert.equal(init.headers.get('Authorization'),`Bearer ${secret}`);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
        return binaryReply(payload, { 'Content-Type': 'image/png', 'Content-Disposition': 'attachment; filename="native.png"' });
      } });
    assert.equal(calls,1); assert.equal(result.response.bodyType,'binary');assert.equal(result.response.body.mediaType,'image/png');
    assert.deepEqual(new Uint8Array(await workflowBinaryBlob(result.response.body).arrayBuffer()),payload);
    assert.ok(!JSON.stringify(result).includes(secret));
  } finally { publishPreparedCatalogs(previous); }
});

Then('exact binary media mappings run once while the generic fallback stays inactive', async () => {
  await fixture('public', async ({ doc, models }) => {
    doc.paths['/download'].post.responses[200].content['application/octet-stream'] = { schema: fileSchema };
    updateCatalogs([...catalogs]);
    const operation = extractOperations(doc,'download')[0];
    const first = createOperationGraph(operation,{x:0,y:0},'get',doc);
    const nodes = [...first.nodes], edges = [...first.edges];
    for (const [media,id] of [['application/pdf','exact'],['application/octet-stream','generic']]) {
      const next = createOperationGraph(models[1],{x:800,y:0},id,doc);
      const output = first.nodes.find(node => node.type==='data' && node.data.fields.some(field => field.type==='Binary' && JSON.parse(decodeURIComponent(field.id))[0]===`response:200:${media}`));
      const input = next.nodes.find(node => node.type==='data' && node.data.direction==='inputs');
      nodes.push(...next.nodes);edges.push(...next.edges,{id:`map-${id}`,kind:'mapping',source:output.id,sourceHandle:output.data.fields.find(field=>field.type==='Binary').id,
        target:input.id,targetHandle:input.data.fields[0].id});
    }
    let calls=0;
    const runner=createWorkflowRunner(workflow(nodes,edges),'get',createWorkflowRequestExecution(async url=>{
      calls++;return String(url).endsWith('/download')?binaryReply():Response.json({accepted:true});
    }));
    runner.next();await runner.submit({});
    const next=runner.next();assert.equal(next.kind,'operation');
    await runner.submit(next.values);assert.equal(runner.next().kind,'complete');assert.equal(calls,2);
  });
});
