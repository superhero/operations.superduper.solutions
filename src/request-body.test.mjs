// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { extractOperations, updateCatalogs } from './lib/catalog.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { encodeWorkflowBinary } from './lib/workflow-binary.ts';
import { createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

function document(media, schema, authenticated = false) {
  return { openapi: '3.1.0', info: { title: 'Repeated forms', version: '1' }, servers: [{ url: 'https://forms.example.test' }],
    ...(authenticated ? { components: { securitySchemes: { Token: { type: 'http', scheme: 'bearer' } } }, security: [{ Token: [] }] } : {}),
    paths: { '/forms': { post: { operationId: 'send', requestBody: { required: true, content: { [media]: { schema } } },
      responses: { 200: { description: 'Accepted' } } } } } };
}
const array = (items, limits = {}) => ({ type: 'array', items, ...limits });
const text = { type: 'string' };
const textValues = ['a,b & c', 'a,b & c', 'Ω+/\n'];

Then('repeated primitive fields preserve {string} values and file parts through both HTTP executors', async media => {
  const multipart = media === 'multipart/form-data';
  const schema = { type: 'object', required: ['text', 'numbers', 'flags'], properties: {
    text: array(text, { minItems: 2, maxItems: 3 }), numbers: array({ type: 'integer', minimum: -1, maximum: 2 }),
    flags: array({ type: 'boolean' }), empty: array(text), caption: text,
    ...(multipart ? { file: { type: 'string', format: 'binary' } } : {}),
  } };
  const bytes = Uint8Array.of(0, 255, 13, 10);
  const values = { 'body:text': JSON.stringify(textValues), 'body:numbers': '[0,-1]', 'body:flags': '[true,false]',
    'body:empty': '[]', 'body:caption': 'hello', ...(multipart ? { 'body:file': JSON.stringify(encodeWorkflowBinary('data.bin', bytes)) } : {}) };
  for (const authenticated of [false, true]) {
    const source = document(media, schema, authenticated), original = JSON.stringify(source);
    const op = extractOperations(source, 'forms')[0], inspected = inspectServiceSchema(source, 'forms').operations[0];
    assert.equal(inspected.unavailableReason, undefined);
    assert.deepEqual(prepareRequest(inspected, values), prepareRequest(op, values));
    const previous = [...catalogs];
    updateCatalogs([...previous, { id: 'forms', name: 'Forms', file: 'forms.json', document: source, groups: [],
      execution: { kind: 'http', origin: 'https://forms.example.test' } }]);
    try {
      let calls = 0, fetchError;
      const fetchRequest = async (url, init) => {
        try {
          calls++;
          const headers = new Headers(init.headers);
          assert.equal(String(url), 'https://forms.example.test/forms');
          assert.equal(headers.get('Authorization'), authenticated ? 'Bearer synthetic-form-token' : null);
          assert.equal(headers.get('Content-Type'), multipart ? null : media);
          assert.deepEqual(init.body.getAll('text'), textValues);
          assert.deepEqual(init.body.getAll('numbers'), ['0', '-1']);
          assert.deepEqual(init.body.getAll('flags'), ['true', 'false']);
          assert.equal(init.body.has('empty'), false);
          assert.equal(init.body.get('caption'), 'hello');
          if (multipart) {
            const wire = new Request(String(url), init);
            assert.match(wire.headers.get('Content-Type'), /multipart\/form-data; boundary=/);
            const decoded = await wire.formData();
            assert.deepEqual(decoded.getAll('text'), ['a,b & c', 'a,b & c', 'Ω+/\r\n'], 'Fetch normalizes multipart text line endings.');
            assert.equal(decoded.get('file').name, 'data.bin');
            assert.equal(decoded.get('file').type, 'application/octet-stream');
            assert.deepEqual(new Uint8Array(await decoded.get('file').arrayBuffer()), bytes);
          } else assert.equal(init.body.toString(), 'text=a%2Cb+%26+c&text=a%2Cb+%26+c&text=%CE%A9%2B%2F%0A&numbers=0&numbers=-1&flags=true&flags=false&caption=hello');
          return Response.json({ accepted: true });
        } catch (error) { fetchError = error; throw error; }
      };
      let execute;
      if (authenticated) {
        const descriptor = await approvedOperation(op, 'https://forms.example.test');
        const binding = { fingerprint: descriptor.fingerprint, alternative: 0, credentials: { Token: 'token' } };
        execute = input => executeCredentialed(descriptor, input, binding,
          [{ id: 'token', label: 'Token', kind: 'secret', value: 'synthetic-form-token' }], { assertCurrent() {}, fetchRequest });
      } else execute = input => createWorkflowRequestExecution(fetchRequest).execute(op, input);
      const result = await execute(values).catch(error => { throw fetchError ?? error; });
      assert.deepEqual(result.response.body, { accepted: true });
      for (const invalid of ['[null]', '[{}]', '[1]', '[]', '["a","b","c","d"]'])
        await assert.rejects(() => execute({ ...values, 'body:text': invalid }));
      await assert.rejects(() => execute({ ...values, 'body:numbers': '[3]' }));
      assert.equal(calls, 1, 'Invalid arrays fail before sending.');
      assert.equal(JSON.stringify(source), original);
    } finally { updateCatalogs(previous); }
  }
});

Then('form arrays retain item constraints and reject unqualified structures before dispatch', () => {
  for (const media of ['application/x-www-form-urlencoded', 'multipart/form-data']) {
    const invalid = [{ type: 'object', properties: {} }, array(array(text)), array({ type: 'object', properties: {} }),
      array({}), array({ type: 'null' }), array({ ...text, nullable: true }), { ...array(text), nullable: true },
      array({ type: 'string', format: 'binary' })];
    for (const field of invalid) {
      const source = document(media, { type: 'object', properties: { field } });
      assert.throws(() => extractOperations(source, 'forms'));
      assert.ok(inspectServiceSchema(source, 'forms').operations[0].unavailableReason);
    }
    for (const encoding of [{}, { field: { style: 'form', explode: false } }, { '*': { contentType: '*/*' } }]) {
      const source = document(media, { type: 'object', properties: { field: array(text) } });
      source.paths['/forms'].post.requestBody.content[media].encoding = encoding;
      assert.throws(() => extractOperations(source, 'forms'));
      assert.match(inspectServiceSchema(source, 'forms').operations[0].unavailableReason, /encoding/);
    }
    for (const value of [null, [null], [[1]], [{ value: 'x' }], [Infinity], { value: 'x' }])
      assert.throws(() => requestBody({ method: 'POST', path: '/', query: {}, contentType: media, body: { field: value } }));
    const op = extractOperations(document(media, { type: 'object', properties: { field: array({ type: 'string', enum: ['one', 'two'] }) } }), 'forms')[0];
    assert.deepEqual(requestBody(prepareRequest(op, { 'body:field': '["two","one","two"]' })).getAll('field'), ['two', 'one', 'two']);
    assert.throws(() => prepareRequest(op, { 'body:field': '["three"]' }), /allowed values/);
    const blanks = { ...op, fields: [{ ...op.fields[0], schema: array(text) }], bodySchema: { type: 'object', properties: { field: array(text) } } };
    assert.deepEqual(requestBody(prepareRequest(blanks, { 'body:field': '["",""]' })).getAll('field'), ['', '']);
    const dynamic = extractOperations(document(media, { type: 'object', additionalProperties: true }), 'forms')[0];
    const untypedArray = { key: 'body:extra', name: 'extra', label: 'Extra', description: '', location: 'body', type: 'array', required: false };
    assert.throws(() => prepareRequest(dynamic, { 'body:extra': '["one"]' }, [untypedArray]), /primitive/);
  }
});
