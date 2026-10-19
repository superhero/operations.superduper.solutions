// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Then } from '@cucumber/cucumber';
import { decodeServiceSchema, readServiceSchema, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';

const fixture = data => {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
  return { pack: `data:application/gzip;base64,${gzipSync(bytes).toString('base64')}`,
    descriptor: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } };
};
Then('all service schema packs match their size hash and operation inventory', async () => {
  const ids = serviceSchemaDescriptors.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...new Set(serviceSchemaDescriptors.map(item => item.provider ?? item.id))].sort(), [
    'anthropic', 'atlassian', 'aws', 'azure', 'bluesky', 'cloudflare', 'cohere', 'deepseek',
    'digitalocean', 'discord', 'docker', 'dukascopy', 'ecb', 'elevenlabs', 'frankfurter', 'fred', 'gcp',
    'gemini', 'github', 'gitlab', 'groq', 'hetzner', 'huggingface', 'mistral', 'ollama', 'openai',
    'openrouter', 'render', 'replicate', 'resend', 'telegram', 'together', 'twilio', 'vercel', 'x', 'xai'
  ]);
  for (const descriptor of serviceSchemaDescriptors) {
    const document = await readServiceSchema(descriptor.id);
    assert.equal(document.openapi, descriptor.openapi, descriptor.id);
    assert.equal(document.info.version, descriptor.version, descriptor.id);
    const seen = new Set();
    function references(value) {
      if (!value || typeof value !== 'object') return;
      if (typeof value.$ref === 'string' && !seen.has(value.$ref)) {
        seen.add(value.$ref);
        assert.ok(value.$ref.startsWith('#/'), `${descriptor.id}: external reference ${value.$ref}`);
        const target = decodeURIComponent(value.$ref.slice(2)).split('/').reduce((parent, part) =>
          parent?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], document);
        assert.notEqual(target, undefined, `${descriptor.id}: unresolved reference ${value.$ref}`);
      }
      for (const [key, child] of Object.entries(value))
        if (!['example', 'examples', 'default'].includes(key)) references(child);
    }
    references(document);
    const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
    assert.equal(Object.values(document.paths).reduce((count, item) => count + Object.keys(item).filter(key => methods.has(key)).length, 0),
      descriptor.operations, descriptor.id);
  }
  const large = fixture({ description: 'test '.repeat(20_000) });
  assert.deepEqual(await decodeServiceSchema(large.pack, large.descriptor), { description: 'test '.repeat(20_000) });
  await assert.rejects(readServiceSchema('does-not-exist'), /unavailable/);
  await assert.rejects(readServiceSchema(serviceSchemaDescriptors[0].id, { descriptors: serviceSchemaDescriptors, packs: {} }), /unavailable/);
});

Then('embedded ReDoc exports preserve OpenAPI data and reject missing malformed or incomplete contracts', async () => {
  const { extractRedocSchema } = await import('../build/redoc-schema.mjs');
  const document = { openapi: '3.0.3', info: { title: 'Status API', version: '1', description: 'Braces { } and escaped "quotes" \\ are data.' },
    paths: { '/status': { get: { responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Status' } } } } } } } },
    components: { schemas: { Status: { type: 'string', enum: ['operational', 'degraded'] } } } };
  for (const declaration of ['const', 'let', 'var']) {
    const before = globalThis.__redocExecuted;
    const html = `<html><script>${declaration} __redoc_state = ${JSON.stringify({ spec: { data: document }, menu: {} })};\n`
      + 'globalThis.__redocExecuted = true; Redoc.hydrate(__redoc_state);</script></html>';
    assert.deepEqual(extractRedocSchema(html), document);
    assert.equal(globalThis.__redocExecuted, before, 'Only JSON is parsed; surrounding JavaScript must never execute.');
  }
  for (const html of ['', '<html>Missing contract</html>', 'const __redoc_state = {"spec":',
    'const __redoc_state = {spec: {data: {}}};', 'const __redoc_state = {"spec":{"data":[]}};',
    'const __redoc_state = {"spec":{"data":{"openapi":"2.0","info":{},"paths":{}}}};'])
    assert.throws(() => extractRedocSchema(html));
});

Then('method and path identities preserve aliased operations and recursive models without changing existing contracts', async () => {
  const { useMethodPathOperationIds } = await import('../build/service-operation-identities.mjs');
  const document = { openapi: '3.0.3', info: { title: 'Aliased API', version: '1' },
    paths: {
      '/v1/items/{id}': { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: { operationId: 'read', security: [{ Token: [] }], responses: { '200': { description: 'OK',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } } } } },
      '/latest/items/{id}': { $ref: '#/paths/~1v1~1items~1%7Bid%7D' },
      '/other': { get: { operationId: 'read', responses: { '200': { description: 'OK' } } } },
    }, components: { schemas: { Item: { type: 'object', properties: {
      operationId: { type: 'string', example: 'data, not a workflow identity' },
      child: { $ref: '#/components/schemas/Item' },
    } } } } };
  const before = structuredClone(document);
  const adapted = useMethodPathOperationIds(document);
  assert.deepEqual(document, before);
  for (const [path, item] of Object.entries(adapted.paths)) assert.equal(item.get.operationId, `GET ${path}`);
  assert.equal(adapted.paths['/latest/items/{id}']['x-upstream-path-ref'], document.paths['/latest/items/{id}'].$ref);
  assert.equal(adapted.paths['/latest/items/{id}'].get['x-upstream-operation-id'], 'read');
  assert.deepEqual(adapted.paths['/latest/items/{id}'].parameters, document.paths['/v1/items/{id}'].parameters);
  assert.deepEqual(adapted.paths['/latest/items/{id}'].get.security, [{ Token: [] }]);
  assert.deepEqual(adapted.components, document.components);
  assert.equal(adapted.paths['/v1/items/{id}'].get.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/Item');
  const invalid = structuredClone(document);
  invalid.paths['/v1/items/{id}'] = { $ref: '#/paths/~1latest~1items~1%7Bid%7D' };
  assert.throws(() => useMethodPathOperationIds(invalid), /cyclic/);
});
Then('service schema decoding rejects corrupt metadata compressed data and JSON', async () => {
  const valid = fixture({ openapi: '3.1.0' });
  for (const bytes of [0, -1, 1.5, 65 * 1024 * 1024])
    await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, bytes }), /metadata/);
  await assert.rejects(decodeServiceSchema('not-a-data-url', valid.descriptor), /metadata/);
  await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, bytes: 1 }), /recorded size/);
  await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, bytes: valid.descriptor.bytes + 1 }), /incomplete/);
  await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, sha256: '0'.repeat(64) }), /hash/);
  await assert.rejects(decodeServiceSchema('data:application/gzip;base64,YmFk', valid.descriptor));
  for (const value of [null, [], true, 'schema', 12]) {
    const item = fixture(value);
    await assert.rejects(decodeServiceSchema(item.pack, item.descriptor), /OpenAPI document/);
  }
  for (const bytes of [Buffer.from('{broken'), Buffer.from([255])]) {
    const item = fixture(bytes);
    await assert.rejects(decodeServiceSchema(item.pack, item.descriptor));
  }
});

Then('native and compatible schema decoders retain identical data and corruption guards', async () => {
  const property = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64');
  const native = Uint8Array.fromBase64;
  assert.equal(typeof native, 'function', 'The pinned Node runtime must exercise the native decoder.');
  const document = { openapi: '3.1.0', description: 'Élément 中 𠀀 😀 '.repeat(10_000), paths: {} };
  const valid = fixture(document);
  let nativeCalls = 0;
  try {
    for (const enabled of [true, false]) {
      Object.defineProperty(Uint8Array, 'fromBase64', { configurable: true, value: enabled ? value => {
        nativeCalls++; return native(value);
      } : undefined });
      assert.deepEqual(await decodeServiceSchema(valid.pack, valid.descriptor), document);
      await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, sha256: '0'.repeat(64) }), /hash/);
      await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, bytes: 1 }), /recorded size/);
      await assert.rejects(decodeServiceSchema(valid.pack, { ...valid.descriptor, bytes: valid.descriptor.bytes + 1 }), /incomplete/);
      await assert.rejects(decodeServiceSchema('data:application/gzip;base64,YmFk', valid.descriptor));
      await assert.rejects(decodeServiceSchema('data:application/gzip;base64,A', valid.descriptor));
    }
    assert.ok(nativeCalls > 0, 'The native path must not silently fall back.');
  } finally {
    if (property) Object.defineProperty(Uint8Array, 'fromBase64', property);
    else delete Uint8Array.fromBase64;
  }
});

Then('external Swagger references remain valid after bundling and OpenAPI conversion', async () => {
  const { bundleSwaggerReferences } = await import('../build/swagger-references.mjs');
  const { default: converter } = await import('swagger2openapi');
  const source = { swagger: '2.0', info: { title: 'Recursive API', version: '1' }, host: 'api.example.com', schemes: ['https'], produces: ['application/json'],
    paths: { '/errors': { get: { parameters: [{ $ref: 'types.json#/parameters/ApiVersion' }], responses: { '200': {
      description: 'Errors', schema: { $ref: 'types.json#/definitions/Error' }
    } }, 'x-examples': { Example: { $ref: 'example.json' } } } } } };
  const external = {
    'https://schemas.test/types.json': { definitions: { Error: { type: 'object', properties: { details: {
      type: 'array', items: { $ref: '#/definitions/Error' }
    } } } }, parameters: { ApiVersion: { name: 'api-version', in: 'query', type: 'string', required: true } } },
    'https://schemas.test/example.json': { parameters: { 'api-version': '1' }, responses: { '200': { details: [] } } }
  };
  const calls = [];
  const download = async url => { calls.push(url); return JSON.stringify(external[url]); };
  const bundled = await bundleSwaggerReferences(source, 'https://schemas.test/root.json', download);
  const { openapi } = await converter.convertObj(bundled, { patch: true, warnOnly: false });
  const get = ref => ref.slice(2).split('/').reduce((value, key) => value[key], openapi);
  const response = openapi.paths['/errors'].get.responses['200'].content['application/json'].schema;
  const error = get(response.$ref);
  assert.equal(get(error.properties.details.items.$ref), error);
  const parameter = get(openapi.paths['/errors'].get.parameters[0].$ref);
  assert.equal(parameter.schema.type, 'string');
  assert.deepEqual(calls.sort(), Object.keys(external).sort());
  await assert.rejects(bundleSwaggerReferences({ definitions: { Invalid: { $ref: 'types.json#/missing/Test' } } },
    'https://schemas.test/root.json', download), /Unsupported external/);
  await assert.rejects(bundleSwaggerReferences({ definitions: { Invalid: { $ref: 'types.json#/definitions/Absent' } } },
    'https://schemas.test/root.json', download), /Missing Swagger reference/);
});
