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
    'anthropic', 'aws', 'azure', 'bitbucket', 'bluesky', 'cloudflare', 'cohere', 'confluence', 'deepseek',
    'digitalocean', 'discord', 'docker', 'dukascopy', 'ecb', 'elevenlabs', 'frankfurter', 'fred', 'gcp',
    'gemini', 'github', 'gitlab', 'groq', 'hetzner', 'huggingface', 'jira', 'mistral', 'ollama', 'openai',
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
