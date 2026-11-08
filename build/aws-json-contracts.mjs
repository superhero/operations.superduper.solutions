// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { encodeSchemaPack, compactSchemaPackPrefix } from '../src/lib/schema-pack-codec.ts';
import pins from '../src/lib/aws-json-pins.json' with { type: 'json' };
import ids from '../tests/aws-json-operations.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '..'), modelsIndex = process.argv.indexOf('--models');
assert.ok(modelsIndex >= 0 && process.argv[modelsIndex + 1], 'Provide --models DIR with the pinned <catalog>.json SDK models.');
const models = resolve(process.argv[modelsIndex + 1]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const traits = new Set(['type', 'shape', 'members', 'member', 'key', 'value', 'locationName', 'timestampFormat',
  'required', 'min', 'max', 'enum', 'pattern', 'sensitive', 'eventstream', 'eventpayload', 'eventheader', 'payload', 'location']);
function trim(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => traits.has(key)).map(([key, entry]) => [key,
    key === 'members' ? Object.fromEntries(Object.entries(entry).map(([name, member]) => [name, trim(member)])) : trim(entry)]));
}
const sources = {}, operations = {};
assert.equal(ids.length, 1784); assert.equal(new Set(ids).size, ids.length); assert.equal(Object.keys(pins).length, 28);
for (const [catalog, pin] of Object.entries(pins)) {
  const nativeBytes = gunzipSync(await readFile(resolve(root, 'src/catalogs/services', catalog + '.json.gz')));
  const sdkBytes = await readFile(resolve(models, catalog + '.json'));
  assert.equal(sha(nativeBytes), pin.sha256, catalog + ': native source changed.');
  assert.equal(sha(sdkBytes), pin.sdk.sha256, catalog + ': SDK source changed.');
  const native = JSON.parse(nativeBytes), sdk = JSON.parse(sdkBytes), metadata = sdk.metadata, used = new Set();
  assert.equal(metadata.protocol, 'json'); assert.equal(metadata.signatureVersion, 'v4');
  assert.equal(metadata.apiVersion, native.info.version); assert.equal(metadata.jsonVersion, pin.jsonVersion);
  assert.equal(metadata.targetPrefix, pin.targetPrefix);
  assert.equal(metadata.signingName ?? metadata.endpointPrefix, pin.service);
  for (const endpoint of pin.endpoints) assert.ok(native.servers.some(server => server.url === endpoint.url
    && Object.entries(endpoint.variables).every(([name, variable]) => variable.default === server.variables[name].default
      && JSON.stringify(variable.enum) === JSON.stringify(server.variables[name].enum))), catalog + ': endpoint pin');
  function include(reference) {
    if (!reference) return;
    const name = reference.shape; assert.equal(typeof name, 'string');
    if (used.has(name)) return; used.add(name);
    const shape = sdk.shapes[name]; assert.ok(shape, catalog + ':' + name);
    assert.ok(!shape.eventstream, catalog + ':' + name + ': event framing needs a separate reviewed contract.');
    for (const member of Object.values(shape.members ?? {})) include(member);
    for (const key of ['member', 'key', 'value']) if (shape[key]) include(shape[key]);
  }
  for (const id of ids.filter(id => id.startsWith(catalog + ':'))) {
    const name = id.slice(catalog.length + 1), sdkOperation = sdk.operations[name]; assert.ok(sdkOperation, id);
    const target = metadata.targetPrefix + '.' + name, path = '/#X-Amz-Target=' + target;
    const nativeOperation = native.paths[path]?.post; assert.equal(nativeOperation?.operationId, name, id);
    assert.equal(sdkOperation.http.method, 'POST'); assert.equal(sdkOperation.http.requestUri, '/');
    assert.ok(!sdkOperation.endpointdiscovery?.required, id + ': required endpoint discovery');
    const hostPrefix = sdkOperation.endpoint?.hostPrefix ?? '';
    assert.ok(hostPrefix === '' || id === 'aws-states:StartSyncExecution' && hostPrefix === 'sync-', id + ': host prefix');
    const auth = sdkOperation.authtype === 'none' ? 'none' : 'sigv4';
    if (auth === 'none') assert.deepEqual(sdkOperation.auth, ['smithy.api#noAuth'], id);
    else assert.ok(sdkOperation.authtype === undefined && sdkOperation.auth === undefined, id);
    const targetParameter = nativeOperation.parameters?.find(parameter => parameter.name === 'X-Amz-Target');
    assert.equal(targetParameter?.in, 'header'); assert.equal(targetParameter.required, true);
    assert.deepEqual(targetParameter.schema.enum, [target]);
    for (const parameter of nativeOperation.parameters ?? []) assert.ok(parameter === targetParameter
      || parameter.in === 'query' && ['Pagination limit', 'Pagination token'].includes(parameter.description), id + ': native parameter');
    include(sdkOperation.input); include(sdkOperation.output);
    operations[id] = { catalog, operation: name, target, auth, hostPrefix,
      input: sdkOperation.input?.shape ?? null, output: sdkOperation.output?.shape ?? null,
      bodyRequired: nativeOperation.requestBody?.required === true, status: sdkOperation.http.responseCode ?? 200 };
  }
  sources[catalog] = { ...pin, shapes: Object.fromEntries([...used].sort().map(name => [name, trim(sdk.shapes[name])])) };
}
assert.equal(Object.keys(operations).length, ids.length);
const raw = Buffer.from(JSON.stringify({ version: 1, sources, operations }));
const packed = encodeSchemaPack(gzipSync(raw, { level: 9 })).slice(compactSchemaPackPrefix.length);
const result = `// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Generated by build/aws-json-contracts.mjs. See aws-json-data.NOTICE.
import { gunzipSync } from "fflate";
import { decodeCompactSchemaPack } from "./schema-pack-codec.ts";
export const awsJsonDataSha256 = "${sha(raw)}";
const packed = "${packed}";
export function decodeAwsJsonData(): unknown {
  const bytes = gunzipSync(decodeCompactSchemaPack(packed));
  if (bytes.byteLength !== ${raw.length}) throw new Error("The AWS JSON contract pack is incomplete.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
`;
const outputIndex = process.argv.indexOf('--output');
const target = resolve(root, outputIndex < 0 ? 'src/lib/aws-json-data.ts' : process.argv[outputIndex + 1]);
if (process.argv.includes('--check')) assert.equal(await readFile(target, 'utf8'), result, 'AWS JSON contracts are outdated.');
else await writeFile(target, result);
console.log(JSON.stringify({ sources: Object.keys(sources).length, operations: ids.length, bytes: raw.length,
  packedCharacters: packed.length, sha256: sha(raw) }));
