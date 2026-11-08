// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { encodeSchemaPack, compactSchemaPackPrefix } from '../src/lib/schema-pack-codec.ts';
import pins from '../src/lib/aws-query-pins.json' with {type:'json'};
import ids from '../tests/aws-query-operations.json' with {type:'json'};

const root=resolve(import.meta.dirname,'..'), index=process.argv.indexOf('--models');
assert.ok(index>=0 && process.argv[index+1],'Provide --models DIR with the pinned AWS SDK models.');
const models=resolve(process.argv[index+1]),sha=value=>createHash('sha256').update(value).digest('hex');
const traits=new Set(['type','shape','members','member','key','value','locationName','queryName','timestampFormat','required',
  'min','max','enum','pattern','sensitive','flattened','xmlAttribute','xmlNamespace','resultWrapper','location']);
function trim(value) {
  if(!value || typeof value!=='object' || Array.isArray(value))return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>traits.has(key)).map(([key,item])=>[key,
    key==='members'?Object.fromEntries(Object.entries(item).map(([name,member])=>[name,trim(member)]))
      :key==='xmlNamespace'?{...item}:trim(item)]));
}
assert.equal(ids.length,2726);assert.equal(new Set(ids).size,2726);assert.equal(Object.keys(pins).length,12);
const sources={},operations={};
for(const [catalog,pin] of Object.entries(pins)) {
  const nativeBytes=gunzipSync(await readFile(resolve(root,'src/catalogs/services',catalog+'.json.gz'))),sdkBytes=await readFile(resolve(models,catalog+'.json'));
  assert.equal(sha(nativeBytes),pin.sha256,catalog+': native source changed');assert.equal(sha(sdkBytes),pin.sdk.sha256,catalog+': SDK source changed');
  const native=JSON.parse(nativeBytes),sdk=JSON.parse(sdkBytes),metadata=sdk.metadata,used=new Set();
  assert.ok(['query','ec2'].includes(metadata.protocol));assert.equal(metadata.protocol,pin.protocol);
  assert.equal(metadata.apiVersion,pin.apiVersion);assert.equal(metadata.apiVersion,native.info.version);
  assert.equal(metadata.signingName??metadata.endpointPrefix,pin.service);assert.equal(metadata.xmlNamespace,pin.namespace);
  assert.equal(metadata.signatureVersion,'v4');
  for(const endpoint of pin.endpoints)assert.ok(native.servers.some(server=>server.url===endpoint.url
    &&JSON.stringify(server.variables??{})===JSON.stringify(endpoint.variables??{})),catalog+': authority');
  const nativeOps=new Map(Object.entries(native.paths).flatMap(([path,item])=>Object.entries(item)
    .filter(([method,op])=>['get','post'].includes(method)&&op.operationId).map(([method,op])=>[catalog+':'+op.operationId,{path,method:method.toUpperCase(),op}])));
  function include(ref) {
    if(!ref)return;const name=ref.shape;assert.equal(typeof name,'string');if(used.has(name))return;used.add(name);
    const shape=sdk.shapes[name];assert.ok(shape,catalog+':'+name);assert.ok(!shape.eventstream,catalog+':'+name);
    for(const member of [...Object.values(shape.members??{}),...['member','key','value'].filter(key=>shape[key]).map(key=>shape[key])])include(member);
  }
  for(const id of ids.filter(id=>id.startsWith(catalog+':'))) {
    const action=id.slice(catalog.length+1).replace(/^(GET|POST)_/,''),op=sdk.operations[action],source=nativeOps.get(id);assert.ok(op&&source,id);
    assert.equal(id,`${catalog}:${source.method}_${action}`);assert.equal(source.path.split('#')[1],'Action='+action);
    const queuePath=source.path.split('#')[0]!=='/';assert.ok(!queuePath||catalog==='aws-sqs'&&source.path.startsWith('/{AccountNumber}/{QueueName}/#'));
    assert.equal(op.http.method,'POST');assert.equal(op.http.requestUri,'/');assert.ok(!op.endpoint&&!op.endpointdiscovery&&!op.authtype&&!op.auth,id);
    include(op.input);include(op.output);
    // The official STS client uses makeUnauthenticatedRequest for these actions.
    const auth=catalog==='aws-sts'&&['AssumeRoleWithSAML','AssumeRoleWithWebIdentity'].includes(action)?'none':'sigv4';
    operations[id]={catalog,operation:action,method:source.method,path:source.path,queuePath,auth,
      input:op.input?.shape??null,output:op.output?.shape??null,
      ...(op.input?{inputTraits:trim(op.input)}:{}),...(op.output?{outputTraits:trim(op.output)}:{}),status:op.http.responseCode??200};
  }
  sources[catalog]={...pin,shapes:Object.fromEntries([...used].sort().map(name=>[name,trim(sdk.shapes[name])]))};
}
assert.equal(Object.keys(operations).length,2726);
const raw=Buffer.from(JSON.stringify({version:1,sources,operations})),packed=encodeSchemaPack(gzipSync(raw,{level:9})).slice(compactSchemaPackPrefix.length);
const result=`// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Generated by build/aws-query-contracts.mjs. See aws-query-data.NOTICE.
import { gunzipSync } from "fflate";
import { decodeCompactSchemaPack } from "./schema-pack-codec.ts";
export const awsQueryDataSha256 = "${sha(raw)}";
const packed = "${packed}";
export function decodeAwsQueryData(): unknown {
  const bytes = gunzipSync(decodeCompactSchemaPack(packed));
  if (bytes.byteLength !== ${raw.length}) throw new Error("The AWS Query contract pack is incomplete.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
`;
const output=process.argv.indexOf('--output'),target=resolve(root,output<0?'src/lib/aws-query-data.ts':process.argv[output+1]);
if(process.argv.includes('--check'))assert.equal(await readFile(target,'utf8'),result,'AWS Query contracts are outdated.');else await writeFile(target,result);
console.log(JSON.stringify({sources:12,operations:2726,bytes:raw.length,packedCharacters:packed.length,sha256:sha(raw)}));
