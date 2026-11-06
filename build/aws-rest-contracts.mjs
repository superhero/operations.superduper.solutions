// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Regenerate only after downloading the pinned official models to --models DIR.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { decodeAwsRestData } from '../src/lib/aws-rest-data.ts';
import { encodeSchemaPack, compactSchemaPackPrefix } from '../src/lib/schema-pack-codec.ts';
import baselineIds from '../tests/aws-rest-operations.json' with {type:'json'};
import headerArrayIds from '../tests/header-array-operations.json' with {type:'json'};
const ids = [...baselineIds, ...headerArrayIds];

const root = resolve(import.meta.dirname, '..'), models = process.argv[process.argv.indexOf('--models') + 1];
assert.ok(process.argv.includes('--models') && models, 'Provide --models DIR containing the pinned <catalog>.json models.');
const sha = value => createHash('sha256').update(value).digest('hex');
const previous = decodeAwsRestData(), sources = {}, operations = {};
const traits = new Set(['type','members','member','key','value','shape','location','locationName','flattened','xmlAttribute',
  'xmlNamespace','timestampFormat','payload','resultWrapper','required','eventstream','event','eventpayload','eventheader','exception','jsonvalue']);
function trim(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>traits.has(key)).map(([key, entry])=>[key,
    key === 'members' ? Object.fromEntries(Object.entries(entry).map(([name, member])=>[name, trim(member)]))
      : key === 'xmlNamespace' ? { ...entry } : trim(entry)]));
}
for (const [catalog, pinned] of Object.entries(previous.sources)) {
  const nativeBytes = gunzipSync(await readFile(resolve(root, 'src/catalogs/services', catalog+'.json.gz')));
  assert.equal(sha(nativeBytes), pinned.sha256, `${catalog}: native source changed; review before changing the pin.`);
  const bytes = await readFile(resolve(models, catalog+'.json'));
  assert.equal(sha(bytes), pinned.sdk.sha256, `${catalog}: SDK model does not match its official pinned source.`);
  const native = JSON.parse(nativeBytes), sdk = JSON.parse(bytes), used = new Set();
  assert.equal(sdk.metadata.protocol, pinned.protocol, catalog + ": protocol changed.");
  assert.equal(sdk.metadata.signingName ?? sdk.metadata.endpointPrefix, pinned.service, catalog + ": signing authority changed.");
  function include(name) {
    if (used.has(name)) return; used.add(name);
    const shape = sdk.shapes[name]; assert.ok(shape, `${catalog}:${name}`);
    for (const member of [...Object.values(shape.members ?? {}), ...['member','key','value'].filter(key=>shape[key]).map(key=>shape[key])]) include(member.shape);
  }
  for (const id of ids.filter(id=>id.startsWith(catalog+':'))) {
    const old = previous.operations[id] ?? (id === 'aws-s3:ListObjects'
      ? {catalog:'aws-s3',operation:'ListObjects',nativeMethod:'GET',method:'GET',nativePath:'/{Bucket}',path:'/{Bucket}',greedy:[],status:200}
      : undefined); assert.ok(old);
    const operation = sdk.operations[old.operation]; assert.ok(operation);
    assert.equal(native.paths[old.nativePath]?.[old.nativeMethod.toLowerCase()]?.operationId, id.slice(catalog.length+1));
    assert.equal(operation.http.method, old.method);
    assert.equal(operation.http.requestUri.replaceAll('+}', '}'), old.path);
    const input = operation.input?.shape ?? null, output = operation.output?.shape ?? null;
    if (input) include(input); if (output) include(output);
    const inputTraits = operation.input ? trim(operation.input) : undefined;
    // The archived SDK model omits these query traits; the current API request
    // syntax explicitly names maxResults/nextToken and has no request body.
    const wireSources = id === 'aws-opensearch:DescribeDomainAutoTunes'
      ? ['https://docs.aws.amazon.com/opensearch-service/latest/APIReference/API_DescribeDomainAutoTunes.html'] : [];
    if (id === 'aws-opensearch:DescribeDomainAutoTunes') {
      assert.equal(operation.http.method, 'GET');
      inputTraits.members = structuredClone(trim(sdk.shapes[input]).members);
      for (const name of ['MaxResults','NextToken']) {
        assert.equal(inputTraits.members[name].location, undefined);
        inputTraits.members[name].location = 'querystring';
        inputTraits.members[name].locationName = name[0].toLowerCase()+name.slice(1);
      }
    }
    const outputTraits = operation.output ? trim(operation.output) : undefined;
    if (id === 'aws-s3:ListObjects') {
      outputTraits.locationName = 'ListBucketResult';
      wireSources.push('https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjects.html');
    }
    operations[id] = { ...old, input, output,
      ...(inputTraits ? { inputTraits } : {}),
      ...(outputTraits ? { outputTraits } : {}),
      ...(wireSources.length ? {wireSources} : {}) };
  }
  sources[catalog] = { ...pinned, shapes: Object.fromEntries([...used].sort().map(name=>[name, trim(sdk.shapes[name])])) };
}
assert.equal(Object.keys(operations).length, ids.length); assert.equal(new Set(ids).size, ids.length);
const raw = Buffer.from(JSON.stringify({version:1,sources,operations}));
const packed = encodeSchemaPack(gzipSync(raw,{level:9})).slice(compactSchemaPackPrefix.length);
const result = `// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Generated by build/aws-rest-contracts.mjs from the pinned AWS SDK models.
// Source URLs/hashes are retained in the pack. See aws-rest-data.NOTICE.
import { gunzipSync } from "fflate";
import { decodeCompactSchemaPack } from "./schema-pack-codec.ts";

export const awsRestDataSha256 = "${sha(raw)}";
const packed = "${packed}";
export function decodeAwsRestData(): unknown {
  const bytes = gunzipSync(decodeCompactSchemaPack(packed));
  if (bytes.byteLength !== ${raw.length}) throw new Error("The AWS REST contract pack is incomplete.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
`;
const outputIndex = process.argv.indexOf('--output');
const target = resolve(root, outputIndex < 0 ? 'src/lib/aws-rest-data.ts' : process.argv[outputIndex+1]);
if (process.argv.includes('--check')) assert.equal(await readFile(target,'utf8'),result,'AWS REST serialization data is outdated.');
else await writeFile(target,result);
console.log(JSON.stringify({operations:ids.length,sources:Object.keys(sources).length,bytes:raw.length,packedCharacters:packed.length,sha256:sha(raw)}));
