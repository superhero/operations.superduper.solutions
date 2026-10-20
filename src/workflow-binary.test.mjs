// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { encodeWorkflowBinary, validateWorkflowBinary, workflowBinaryBlob, fileMediaType, containsBinaryInput } from './lib/workflow-binary.ts';
import { readWorkflowFile, parseWorkflowFile, validateWorkflowFileData, defaultCsvOptions, fileValueType } from './lib/workflow-file.ts';
import { extractOperations, updateCatalogs } from './lib/catalog.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { prepareRequest, validateInputValue } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { createOperationGraph, createFileDataGraph, updateFileDataGraph, isWorkflowConnection, insertFileBinaryCast } from './lib/workflow-graph.ts';
import { isFileBinaryConnection, castValue } from './lib/workflow-utilities.ts';
import { parseWorkflowDocument } from './lib/workflow-document.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const binarySchema = { type: 'string', format: 'binary' };
const multipartSchema = { type: 'object', required: ['file'], properties: { file: binarySchema, caption: { type: 'string' }, count: { type: 'integer' } } };
const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
function document(content, { required = true, security = false } = {}) {
  return { openapi: '3.1.0', info: { title: 'File transport fixture', version: '1' }, servers: [{ url: 'https://files.example.test' }],
    ...(security ? { components: { securitySchemes: { Token: { type: 'http', scheme: 'bearer' } } }, security: [{ Token: [] }] } : {}),
    paths: { '/files': { post: { operationId: 'upload', requestBody: { required, content }, responses: { 200: { description: 'Accepted' } } } } } };
}
const content = (schema = binarySchema, mediaType = 'application/octet-stream') => ({ [mediaType]: { schema } });
const node = file => ({ id: 'file', type: 'file', position: { x: 0, y: 0 }, data: { file } });
const graphDocument = (nodes, edges) => ({ version: 3, id: 'binary-file', name: 'Files', nodes, edges,
  viewport: { x: 0, y: 0, zoom: 1 }, snap: true, curved: true, dashed: false });

Then('binary uploads retain exact bytes and validate persisted file envelopes', async () => {
  for (const [name, media, data] of [['sample.pdf', 'application/pdf', bytes], ['unknown', '', bytes], ['empty.bin', '', new Uint8Array()],
    ['image.png', 'image/png', Uint8Array.of(137, 80, 78, 71, 0, 255)]]) {
    const file = readWorkflowFile(name, data, media);
    assert.equal(fileValueType(file), 'Binary');
    assert.equal(file.source, '', 'Binary bytes are stored once, without a decoded text copy.');
    assert.deepEqual(new Uint8Array(await workflowBinaryBlob(file.value).arrayBuffer()), data);
    const stored = validateWorkflowFileData(JSON.parse(JSON.stringify({ file })));
    assert.deepEqual(stored, { file });
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(graphDocument([node(file)], []))).nodes[0].data, { file });
    assert.deepEqual(createFileDataGraph(node(file)), { nodes: [], edges: [] }, 'Do not expose envelope fields as workflow data.');
  }
  for (const [name, data] of [['rows.csv', Uint8Array.of(255, 254, 97, 0, 10, 0, 49, 0)],
    ['data.json', Uint8Array.of(239, 187, 191, 123, 125)]]) {
    const file = readWorkflowFile(name, data);
    assert.ok(['Array', 'Object'].includes(fileValueType(file)));
    assert.deepEqual(new Uint8Array(await workflowBinaryBlob(file.original).arrayBuffer()), data, 'BOM and encoding survive.');
    assert.deepEqual(validateWorkflowFileData({ file }).file, file);
  }
  assert.equal(fileMediaType('PHOTO.JPG'), 'image/jpeg');
  assert.equal(fileMediaType('unsafe.bin', 'bad\r\nHeader: injected'), 'application/octet-stream');
  assert.equal(fileMediaType('unknown', 'APPLICATION/PDF'), 'application/pdf');
  assert.equal(fileMediaType('notes.txt'), 'text/plain');
  for (const name of ['constructor', '__proto__']) assert.equal(fileMediaType(name), 'application/octet-stream');
  assert.equal(fileMediaType('unknown', `application/${'a'.repeat(256)}`), 'application/octet-stream');
  const file = encodeWorkflowBinary('sample.bin', bytes);
  const malformed = [null, {}, { ...file, kind: 'other' }, { ...file, version: 2 }, { ...file, name: 42 }, { ...file, name: '' }, { ...file, name: ' ' },
    { ...file, name: 'a'.repeat(256) }, { ...file, name: 'a/b' }, { ...file, name: 'a\\b' }, { ...file, name: 'a\n' },
    { ...file, mediaType: undefined }, { ...file, mediaType: `application/${'a'.repeat(256)}` }, { ...file, mediaType: 'image/png\r\nX: y' }, { ...file, size: -1 }, { ...file, size: 1.5 },
    { ...file, size: 500001 }, { ...file, base64: undefined }, { ...file, base64: 'A'.repeat(666669) },
    { ...file, base64: '!===' }, { ...file, size: 1 }, { ...file, base64: 'AB==', size: 1 }];
  for (const invalid of malformed) assert.throws(() => validateWorkflowBinary(invalid), /Invalid binary/);
  assert.throws(() => readWorkflowFile('large.bin', new Uint8Array(500001)), /500 kB/);
  assert.equal(encodeWorkflowBinary('limit.bin', new Uint8Array(500000)).size, 500000);
  assert.throws(() => readWorkflowFile('broken.json', new TextEncoder().encode('{')));
  const binary = readWorkflowFile('file.bin', bytes), parsed = readWorkflowFile('file.json', new TextEncoder().encode('{}'));
  for (const invalid of [{ ...binary, source: 'decoded' }, { ...binary, name: 'renamed.bin' }, { ...binary, original: file },
    { ...parsed, original: file }, { ...parsed, original: {} }]) assert.throws(() => validateWorkflowFileData({ file: invalid }));
});

Then('raw and multipart file schemas accept files without enabling unsupported transports', () => {
  for (const contents of [content(), content(binarySchema, 'application/pdf'), content(binarySchema, 'APPLICATION/PDF'), content(binarySchema, 'text/plain'),
    { 'image/png': { schema: binarySchema }, 'image/jpeg': { schema: binarySchema } }, content(multipartSchema, 'multipart/form-data')]) {
    const source = document(contents);
    for (const op of [extractOperations(source, 'binary')[0], inspectServiceSchema(source, 'binary').operations[0]]) {
      assert.equal(op.unavailableReason, undefined);
      const graph = createOperationGraph(op, { x: 400, y: 0 }, 'send', source);
      assert.ok(graph.nodes.some(n => n.type === 'data' && n.data.fields.some(f => f.type === 'Binary' && f.connectable)));
      const fallback = createOperationGraph(op, { x: 400, y: 0 }, 'send');
      assert.ok(fallback.nodes.some(n => n.type === 'data' && n.data.fields.some(f => f.type === 'Binary')));
      assert.ok(op.fields.some(f => f.format === 'binary'));
    }
  }
  const invalid = [content({ type: 'object', properties: {} }),
    content({ ...binarySchema, enum: ['file'] }), content({ ...binarySchema, nullable: true }),
    content(multipartSchema, 'application/x-www-form-urlencoded'), content({ type: 'object', properties: { nested: { type: 'object', properties: {} } } }, 'multipart/form-data'),
    { 'application/octet-stream': { schema: binarySchema }, 'application/pdf': { schema: { ...binarySchema, maxLength: 2 } } },
    content(binarySchema, 'application/pdf\r\nX-Injected: y'), content(binarySchema, `application/${'a'.repeat(256)}`)];
  for (const contents of invalid) {
    assert.throws(() => extractOperations(document(contents), 'binary'));
    assert.ok(inspectServiceSchema(document(contents), 'binary').operations[0].unavailableReason);
  }
  const encoded = content(multipartSchema, 'multipart/form-data'); encoded['multipart/form-data'].encoding = { file: { headers: { 'X-Custom': {} } } };
  assert.throws(() => extractOperations(document(encoded), 'binary'));
  assert.ok(inspectServiceSchema(document(encoded), 'binary').operations[0].unavailableReason);
  const rawEncoding = { 'application/octet-stream': { schema: binarySchema }, 'application/pdf': { schema: binarySchema, encoding: {} } };
  assert.throws(() => extractOperations(document(rawEncoding), 'binary'));
  assert.ok(inspectServiceSchema(document(rawEncoding), 'binary').operations[0].unavailableReason);
  const advanced = document(content({ ...binarySchema, allOf: [{ maxLength: 10 }] }));
  assert.throws(() => extractOperations(advanced, 'binary'));
  assert.ok(inspectServiceSchema(advanced, 'binary').operations[0].unavailableReason, 'Unsupported file rules cannot fall back to a JSON body.');
  const query = document(content()); query.paths['/files'].post.parameters = [{ in: 'query', name: 'file', schema: binarySchema }];
  assert.throws(() => extractOperations(query, 'binary'));
  assert.equal(inspectServiceSchema(query, 'binary').operations[0].fields.find(f => f.location === 'query').format, undefined);
  assert.ok(inspectServiceSchema(document(content({ ...binarySchema, pattern: '^file$' })), 'binary').operations[0].unavailableReason);
  const op = extractOperations(document(content()), 'binary')[0];
  const file = encodeWorkflowBinary('sample.pdf', bytes);
  assert.throws(() => prepareRequest(op, { 'body:$': 'plain text' }), /valid JSON/);
  for (const bad of ['{}', 'null', JSON.stringify({ ...file, size: 0 })]) assert.throws(() => prepareRequest(op, { 'body:$': bad }), /uploaded binary file/);
  assert.throws(() => prepareRequest(op, {}), /required/);
  assert.equal(prepareRequest(extractOperations(document(content(), { required: false }), 'binary')[0], {}).body, undefined);
  const pdf = extractOperations(document(content(binarySchema, 'application/pdf')), 'binary')[0];
  assert.throws(() => prepareRequest(pdf, { 'body:$': JSON.stringify(encodeWorkflowBinary('sample.png', bytes)) }), /does not accept image\/png/);
  assert.equal(prepareRequest(pdf, { 'body:$': JSON.stringify(file) }).contentType, 'application/pdf');
  const upper = extractOperations(document(content(binarySchema, 'APPLICATION/PDF')), 'binary')[0];
  assert.equal(prepareRequest(upper, { 'body:$': JSON.stringify(file) }).contentType, 'application/pdf');
  for (const constraint of [{ minLength: 257 }, { maxLength: 255 }]) assert.throws(() => validateInputValue({ ...op.fields[0], ...constraint }, file), /file size/);
  validateInputValue(op.fields[0], file);
  assert.equal(containsBinaryInput({ type: 'array', items: binarySchema }), true);
  assert.equal(containsBinaryInput({ type: 'object', additionalProperties: binarySchema }), true);
  assert.equal(containsBinaryInput({ type: 'object', additionalProperties: true }), false);
});

Then('file annotations outside raw and multipart bodies preserve service JSON and query strings', async () => {
  const base64 = encodeWorkflowBinary('data.pdf', bytes).base64;
  for (const [schema, value] of [[binarySchema, base64],
    [{ type: 'object', properties: { attachments: { type: 'array', items: { type: 'object', properties: { content: binarySchema, filename: { type: 'string' } } } } } }, { attachments: [{ content: base64, filename: 'data.pdf' }] }]]) {
    const source = document(content(schema, 'application/json'));
    const op = inspectServiceSchema(source, 'binary').operations[0];
    assert.equal(op.unavailableReason, undefined);
    const values = typeof value === 'string' ? { 'body:$': value } : { 'body:attachments': JSON.stringify(value.attachments) };
    assert.deepEqual(prepareRequest(op, values).body, value);
    const graph = createOperationGraph(op, { x: 0, y: 0 }, 'json', source);
    assert.ok(!graph.nodes.some(n => n.type === 'data' && n.data.fields.some(f => f.type === 'Binary')));
    assert.equal(requestBody(prepareRequest(op, values)), JSON.stringify(value));
    assert.throws(() => extractOperations(source, 'strict'), /binary fields require/);
  }
  const query = document(content()); query.paths['/files'].post.parameters = [{ name: 'optionalFile', in: 'query', schema: binarySchema }];
  const op = inspectServiceSchema(query, 'binary').operations[0];
  assert.equal(op.unavailableReason, undefined);
  assert.equal(op.fields.find(f => f.location === 'query').format, undefined);
  assert.deepEqual(prepareRequest(op, { 'body:$': JSON.stringify(encodeWorkflowBinary('data.pdf', bytes)), 'query:optionalFile': 'existing-text' }).query, { optionalFile: 'existing-text' });
  const graph = createOperationGraph(op, { x: 0, y: 0 }, 'query', query);
  assert.equal(graph.nodes.find(n => n.type === 'data' && n.data.label === 'Query parameters').data.fields[0].type, 'Text');
  // These actual bundled operations must retain their existing JSON/URL paths.
  const { readServiceSchema } = await import('./lib/service-schema-packs.ts');
  for (const [id, operationId] of [['openai', 'CreateContainerFile'], ['resend', 'emails/send'], ['trello', 'POST /cards/{id}/attachments']]) {
    const source = await readServiceSchema(id), catalog = inspectServiceSchema(source, id);
    const operation = catalog.operations.find(op => op.id === `${id}:${operationId}`);
    assert.equal(operation.unavailableReason, undefined, operationId);
    const graph = createOperationGraph(operation, { x: 0, y: 0 }, id, source);
    assert.ok(!graph.nodes.some(n => n.type === 'data' && n.data.direction === 'inputs' && n.data.fields.some(f => f.type === 'Binary')));
  }
});

Then('file connections infer binary or parsed output from their destination', async () => {
  const source = document(content());
  source.paths['/parsed'] = { post: { operationId: 'parsed', requestBody: { required: true, content: content({ type: 'object', required: ['number'], properties: { number: { type: 'integer' } } }, 'application/json') }, responses: { 200: { description: 'Accepted' } } } };
  const previous = [...catalogs];
  updateCatalogs([...previous, { id: 'binary', name: 'Files', file: 'files.json', document: source, groups: [], execution: { kind: 'http', origin: 'https://files.example.test' } }]);
  try {
    for (const [name, data] of [['numbers.json', ' { "number": 12 }\n'], ['numbers.csv', 'number\n12\n13']]) {
      const original = new TextEncoder().encode(data), file = node(readWorkflowFile(name, original));
      const [binaryOp, parsedOp] = extractOperations(source, 'binary');
      const binary = createOperationGraph(binaryOp, { x: 400, y: 0 }, 'send', source);
      const parsed = createOperationGraph(parsedOp, { x: 400, y: 400 }, 'parsed', source);
      const projections = createFileDataGraph(file);
      const target = binary.nodes.find(n => n.type === 'data' && n.data.direction === 'inputs');
      const edge = { id: 'file-binary', kind: 'mapping', source: file.id, sourceHandle: 'value', target: target.id, targetHandle: target.data.fields[0].id };
      const nodes = [file, ...projections.nodes, ...binary.nodes, ...parsed.nodes], edges = [...projections.edges, ...binary.edges, ...parsed.edges];
      assert.equal(isWorkflowConnection(edge, nodes, edges), true);
      assert.equal(isFileBinaryConnection(edge, nodes), true);
      const parsedTarget = parsed.nodes.find(n => n.type === 'data' && n.data.direction === 'inputs');
      const scalar = projections.nodes.find(n => n.data.fields.some(f => f.label === 'number'));
      const scalarEdge = { ...edge, id: 'parsed-field', source: scalar.id, sourceHandle: scalar.data.fields.find(f => f.label === 'number').id,
        target: parsedTarget.id, targetHandle: parsedTarget.data.fields[0].id };
      assert.equal(isWorkflowConnection(scalarEdge, nodes, edges), true);
      const binaryToText = { ...edge, target: parsedTarget.id, targetHandle: parsedTarget.data.fields[0].id };
      const rawFile = node(readWorkflowFile('bytes.bin', bytes));
      assert.equal(isWorkflowConnection(binaryToText, [rawFile, ...binary.nodes, ...parsed.nodes], edges), false);
      // The same uploaded source has both a byte mapping and a parsed mapping.
      const cast = insertFileBinaryCast(edge, nodes, [...edges, scalarEdge], 'binary-cast');
      assert.equal(cast.nodes.find(n => n.id === 'binary-cast').data.targetType, 'Binary');
      const saved = parseWorkflowDocument(JSON.stringify(graphDocument(cast.nodes, cast.edges)));
      let sent;
      const runner = createWorkflowRunner(saved, 'send', createWorkflowRequestExecution(async (_url, init) => { sent = new Uint8Array(await init.body.arrayBuffer()); return Response.json({}); }));
      assert.deepEqual(JSON.parse(runner.next().values['body:$']), file.data.file.original);
      await runner.submit(runner.next().values);
      assert.deepEqual(sent, original);
      const parsedRunner = createWorkflowRunner(saved, 'parsed', { execute(_op, values) { assert.equal(values['body:number'], '12'); return { request: prepareRequest(parsedOp, values), response: { status: 200, statusText: 'OK', headers: {}, body: {} } }; } });
      assert.equal(parsedRunner.next().values['body:number'], '12'); await parsedRunner.submit(parsedRunner.next().values);
      const changed = updateFileDataGraph(file.id, rawFile.data, nodes, [...edges, edge, scalarEdge]);
      assert.ok(changed.edges.some(e => e.id === edge.id));
      assert.ok(!changed.edges.some(e => e.id === scalarEdge.id));
      const legacy = { ...file, data: { file: parseWorkflowFile(name, data) } };
      assert.equal(isWorkflowConnection(edge, [legacy, ...binary.nodes], binary.edges), false, 'Legacy text cannot pretend it retained original bytes.');
    }
  } finally { updateCatalogs(previous); }
});

Then('binary casts encode text and JSON and automatic file casts remain ordinary workflow nodes', async () => {
  for (const value of ['hello\n世界', 12, 2.5, true, false, null, { key: 'value' }, [1, 2]]) {
    const file = castValue(value, 'Binary');
    assert.equal(await workflowBinaryBlob(file).text(), typeof value === 'string' ? value : JSON.stringify(value));
    assert.equal(file.mediaType, typeof value === 'string' ? 'text/plain' : 'application/json');
  }
  const envelope = encodeWorkflowBinary('source.pdf', bytes);
  assert.deepEqual(castValue(envelope, 'Binary'), envelope);
  for (const value of [undefined, Infinity, NaN, () => {}, Symbol('unsupported'), { value: undefined }, { value: Infinity }, { ...envelope, size: 0 }])
    assert.throws(() => castValue(value, 'Binary'));
  assert.throws(() => castValue('x'.repeat(500001), 'Binary'), /500 kB/);
  const source = document(content()), op = extractOperations(source, 'binary')[0];
  const graph = createOperationGraph(op, { x: 800, y: 0 }, 'send', source);
  const target = graph.nodes.find(n => n.type === 'data' && n.data.direction === 'inputs');
  const file = node(readWorkflowFile('source.pdf', bytes));
  const edge = { id: 'file-binary', kind: 'mapping', source: file.id, sourceHandle: 'value', target: target.id, targetHandle: target.data.fields[0].id };
  const automatic = insertFileBinaryCast(edge, [file, ...graph.nodes], graph.edges, 'cast');
  const cast = automatic.nodes.find(n => n.id === 'cast');
  assert.equal(cast.data.targetType, 'Binary');
  assert.ok(automatic.edges.some(e => e.source === file.id && e.target === cast.id));
  assert.ok(automatic.edges.some(e => e.source === cast.id && e.target === target.id));
  for (const connection of automatic.edges.filter(e => e.kind === 'mapping')) assert.equal(isWorkflowConnection(connection, automatic.nodes, automatic.edges.filter(e => e.id !== connection.id)), true);
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(graphDocument(automatic.nodes, automatic.edges))).nodes.find(n => n.id === 'cast'), cast);
  assert.equal(insertFileBinaryCast({ ...edge, target: 'missing' }, automatic.nodes, automatic.edges, 'unused'), undefined);
  assert.equal(insertFileBinaryCast({ ...edge, source: 'not-a-file' }, [file, ...graph.nodes], graph.edges, 'unused'), undefined);
  assert.throws(() => insertFileBinaryCast(edge, Array(500).fill(file).concat(graph.nodes), graph.edges, 'cast'), /limit/);
  assert.throws(() => insertFileBinaryCast(edge, [file, ...graph.nodes], Array(999).fill(edge), 'cast'), /limit/);
  assert.throws(() => insertFileBinaryCast(edge, automatic.nodes, graph.edges, 'cast'), /unique/);
  assert.throws(() => insertFileBinaryCast(edge, [file, ...graph.nodes], [edge], 'cast'), /unique/);
  assert.throws(() => insertFileBinaryCast(edge, [file, ...graph.nodes], [{ ...edge, id: 'cast:input' }], 'cast'), /unique/);
  // Manual JSON-to-binary casts use the normal editable utility node too.
  const parsed = node(readWorkflowFile('source.json', new TextEncoder().encode('{"key":"value"}')));
  delete parsed.data.file.original;
  assert.equal(isWorkflowConnection({ source: file.id, sourceHandle: 'value', target: cast.id, targetHandle: 'value' }, [parsed, cast], []), true);
  const previous = [...catalogs];
  updateCatalogs([...previous, { id: 'binary', name: 'Files', file: 'files.json', document: source, groups: [], execution: { kind: 'http', origin: 'https://files.example.test' } }]);
  try {
    for (const [input, expected] of [[file, bytes], [parsed, new TextEncoder().encode('{"key":"value"}')]]) {
      let sent;
      const nodes = automatic.nodes.map(n => n.id === input.id ? input : n);
      const run = createWorkflowRunner(graphDocument(nodes, automatic.edges), 'send', createWorkflowRequestExecution(async (_url, init) => {
        sent = new Uint8Array(await init.body.arrayBuffer()); return Response.json({ accepted: true });
      }));
      const visit = run.next(); assert.equal(visit.kind, 'operation');
      await run.submit(visit.values); assert.deepEqual(sent, expected);
      assert.equal(run.next().kind, 'complete');
    }
  } finally { updateCatalogs(previous); }
});

Then('both HTTP executors send exact raw and multipart file bodies', async () => {
  for (const media of ['application/octet-stream', 'multipart/form-data']) for (const authenticated of [false, true]) {
    const source = document(content(media === 'multipart/form-data' ? multipartSchema : binarySchema, media), { security: authenticated });
    const op = extractOperations(source, 'binary')[0];
    const file = encodeWorkflowBinary('sample.pdf', bytes), token = 'synthetic-file-token';
    const values = media === 'multipart/form-data' ? { 'body:file': JSON.stringify(file), 'body:caption': 'File caption', 'body:count': '2' } : { 'body:$': JSON.stringify(file) };
    const previous = [...catalogs];
    updateCatalogs([...previous, { id: 'binary', name: 'Files', file: 'files.json', document: source, groups: [], execution: { kind: 'http', origin: 'https://files.example.test' } }]);
    try {
      let calls = 0;
      const fetchRequest = async (url, init) => {
        calls++;
        const headers = new Headers(init.headers);
        assert.equal(String(url), 'https://files.example.test/files');
        assert.equal(headers.get('Authorization'), authenticated ? `Bearer ${token}` : null);
        if (media === 'multipart/form-data') {
          assert.ok(init.body instanceof FormData);
          assert.equal(headers.get('Content-Type'), null, 'Fetch supplies the multipart boundary.');
          const part = init.body.get('file');
          assert.equal(part.name, 'sample.pdf'); assert.equal(part.type, 'application/pdf');
          assert.deepEqual(new Uint8Array(await part.arrayBuffer()), bytes);
          assert.equal(init.body.get('caption'), 'File caption'); assert.equal(init.body.get('count'), '2');
          const serialized = new Request(String(url), init);
          assert.match(serialized.headers.get('Content-Type'), /multipart\/form-data; boundary=/);
          assert.deepEqual(new Uint8Array(await (await serialized.formData()).get('file').arrayBuffer()), bytes);
        } else {
          assert.ok(init.body instanceof Blob); assert.equal(headers.get('Content-Type'), 'application/pdf');
          assert.deepEqual(new Uint8Array(await init.body.arrayBuffer()), bytes);
        }
        return Response.json({ accepted: true });
      };
      let result;
      if (authenticated) {
        const descriptor = await approvedOperation(op, 'https://files.example.test');
        const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { Token: 'token' } };
        const options = { assertCurrent() {}, fetchRequest };
        await assert.rejects(() => executeCredentialed(descriptor, values, binding, [], options));
        assert.equal(calls, 0);
        result = await executeCredentialed(descriptor, values, binding, [{ id: 'token', label: 'Token', kind: 'secret', value: token }], options);
        assert.ok(!JSON.stringify(result).includes(token));
        const altered = { ...op, binaryMediaTypes: ['application/pdf'] };
        if (media !== 'multipart/form-data') assert.notEqual((await approvedOperation(altered, 'https://files.example.test')).fingerprint, descriptor.fingerprint);
      } else result = await createWorkflowRequestExecution(fetchRequest).execute(op, values);
      assert.deepEqual(result.response.body, { accepted: true }); assert.equal(calls, 1);
      assert.throws(() => prepareRequest(op, { ...values, [media === 'multipart/form-data' ? 'body:file' : 'body:$']: '{}' }));
      assert.equal(calls, 1);
    } finally { updateCatalogs(previous); }
  }
  const ordinary = { method: 'POST', path: '/', query: {} };
  assert.equal(requestBody(ordinary), null);
  assert.equal(requestBody({ ...ordinary, body: 'hello', contentType: 'text/plain' }), 'hello');
  assert.equal(requestBody({ ...ordinary, body: { value: 'a&b' }, contentType: 'application/x-www-form-urlencoded' }).toString(), 'value=a%26b');
  const envelope = encodeWorkflowBinary('file.bin', bytes);
  assert.equal(requestBody({ ...ordinary, body: envelope }), JSON.stringify(envelope), 'JSON never auto-decodes objects that resemble files.');
  assert.throws(() => requestBody({ ...ordinary, contentType: 'multipart/form-data', body: { file: {} } }), /Invalid binary/);
});
