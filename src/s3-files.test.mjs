// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { Then } from '@cucumber/cucumber';
import { vi } from 'vitest';
import { awsSyntheticValues as credentials, verifyAwsSignature } from '../tests/aws-sigv4.fixture.mjs';
import { applySchemaPatches, awsS3Files } from './lib/schema-patches.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { configureS3Files, encodeS3Key, s3SigningEndpoint, s3ObjectUrl, s3SourceSha256, s3MetadataHeaders } from './lib/s3-files.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { VaultSession } from './lib/secrets/session.ts';
import { VaultError } from './lib/secrets/types.ts';
import { newVaultKey, recoveryKey, randomBase64, wrapVaultKey } from './lib/secrets/crypto.ts';
import { sealSnapshot } from './lib/secrets/format.ts';
import { httpConnectionReference } from './lib/secrets/http-connections.ts';
import { encodeWorkflowBinary } from './lib/workflow-binary.ts';
import { readWorkflowFile } from './lib/workflow-file.ts';
import { createOperationGraph, insertFileBinaryCast } from './lib/workflow-graph.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { updateCatalogs } from './lib/catalog.ts';
import { catalogs } from './lib/catalog-registry.ts';

const bucket='operations-test-bucket', region='us-east-1', key='folder//雪 +?%2F/#final.bin';
const rawBytes=new Uint8Array([0,255,13,10,239,187,191,65]);
const hash=(bytes,algorithm='sha256',encoding='base64')=>createHash(algorithm).update(bytes).digest(encoding);
const checksumHeaders=bytes=>({'ETag':'"'+hash(bytes,'md5','hex')+'"','x-amz-checksum-sha256':hash(bytes),'x-amz-checksum-type':'FULL_OBJECT'});
const ordinary=profile=>({id:'aws-s3:'+ (profile==='put-object'?'PutObject':'GetObject'),name:profile,description:'',group:'S3',method:profile==='put-object'?'PUT':'GET',path:'/{Bucket}/{Key}',fields:[],bodyRequired:false,
  security:[[{name:'hmac',kind:'aws-sigv4',header:'Authorization',profile:'s3-object'}]]});
const decoded=file=>Uint8Array.from(Buffer.from(file.base64,'base64'));
function safe(value){for(const secret of Object.values(credentials))for(const form of [secret,encodeURIComponent(secret),new URLSearchParams({v:secret}).toString().slice(2)])assert.ok(!JSON.stringify(value).includes(form));}
async function fixture(style='path') {
  const origin='https://'+(style==='virtual'?bucket+'.':'')+'s3.'+region+'.amazonaws.com';
  const k=await newVaultKey(),id=crypto.randomUUID(),methodId=crypto.randomUUID(),recovery=randomBase64(128),salt=randomBase64(16);
  const envelope={id:methodId,kind:'recovery',revision:1,salt,wrappedKey:await wrapVaultKey(k,await recoveryKey(recovery,salt),{vaultId:id,epoch:1,kind:'recovery',id:methodId,revision:1})};
  const storage={state:{revision:1,lockEpoch:1,snapshot:await sealSnapshot({id,epoch:1,revision:1,envelopes:[envelope],records:[]},k)},
    async read(){return structuredClone(this.state);},async replace(expected,snapshot,keys){if(expected.revision!==this.state.revision||expected.lockEpoch!==this.state.lockEpoch)throw new VaultError('CONFLICT');this.state={revision:this.state.revision+1,lockEpoch:this.state.lockEpoch+1,snapshot:structuredClone(snapshot),keys:structuredClone(keys)};return this.read();},
    async indexKeys(expected,keys){assert.equal(expected.revision,this.state.revision);this.state.keys=structuredClone(keys);return this.read();},async lock(){this.state.revision++;this.state.lockEpoch++;return this.read();}};
  const f={origin,storage,proof:{methodId,secret:recovery},calls:[],stored:new Map(),enabled:true,headerMode:'sha256',fail:false,afterWrite:undefined};
  f.session=new VaultSession(storage,undefined,async()=>{if(!f.enabled)throw new VaultError('PERMISSION');});await f.session.unlock(f.proof);
  const refs={};for(const [part,value] of Object.entries(credentials)){const entries=await f.session.put(null,{label:'S3 '+part,kind:'secret',value});refs[part]=entries.find(item=>item.label==='S3 '+part).id;}
  f.refs=refs;f.models={};f.approved={};f.bindings={};
  for(const profile of ['put-object','get-object']){const model=ordinary(profile);configureS3Files(model,profile);f.models[profile]=model;f.approved[profile]=await approvedOperation(model,origin);}
  f.manual={alternative:0,fingerprint:f.approved['put-object'].fingerprint,credentials:{hmac:refs}};
  f.connection=await f.session.putConnection({label:'S3 files',account:'AWS sandbox',format:'schema'},f.approved['put-object'],f.manual);
  for(const profile of ['put-object','get-object'])f.bindings[profile]=await f.session.connectionBinding(httpConnectionReference(f.connection),f.approved[profile]);
  f.provider=async(address,init)=>{
    const call={address,init};f.calls.push(call);Object.assign(call,verifyAwsSignature(address,init,credentials,'s3'));
    assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');
    const url=new URL(address), endpoint=s3SigningEndpoint(url.origin);assert.ok(endpoint);
    const parts=url.pathname.slice(1).split('/'), selectedBucket=endpoint.bucket??parts.shift();const selectedKey=decodeURIComponent(parts.join('/'));
    const identity=selectedBucket+'/'+selectedKey, headers=new Headers(init.headers);
    if(f.fail)return new Response('<Error><Code>AccessDenied</Code><Message>'+Object.values(credentials).join(' ')+'</Message></Error>',{status:403,headers:{'Content-Type':'application/xml'}});
    if(init.method==='PUT') {
      assert.ok(init.body instanceof Uint8Array);const bytes=Uint8Array.from(init.body);assert.equal(headers.get('x-amz-checksum-sha256'),hash(bytes));
      f.stored.set(identity,{bytes,media:headers.get('Content-Type'),metadata:headers.get('x-amz-meta-note')});await f.afterWrite?.(call);
      const proofs=f.headerMode==='missing'?{}:f.headerMode==='etag'?{ETag:checksumHeaders(bytes).ETag}:checksumHeaders(bytes);
      return new Response('',{status:200,headers:{...proofs,'Content-Type':'text/plain'}});
    }
    assert.equal(init.method,'GET');assert.equal(init.body,null);assert.equal(headers.get('x-amz-checksum-mode'),'ENABLED');
    const object=f.stored.get(identity);assert.ok(object,'An unexpected object key reached the endpoint');
    let proofs=f.headerMode==='missing'?{}:f.headerMode==='etag'?{ETag:checksumHeaders(object.bytes).ETag}:checksumHeaders(object.bytes);
    if(f.headerMode==='wrong')proofs={...proofs,'x-amz-checksum-sha256':hash(new Uint8Array([1]))};
    if(f.headerMode==='composite')proofs={...proofs,'x-amz-checksum-type':'COMPOSITE'};
    if(object.proofs)proofs=object.proofs;
    return new Response(object.bytes,{status:200,headers:{...proofs,'Content-Type':object.media,'Content-Disposition':'attachment; filename="object.bin"'}});
  };
  f.input=(profile,file=encodeWorkflowBinary('source.bin',rawBytes,'application/octet-stream'))=>({'path:Bucket':bucket,'path:Key':key,...(profile==='put-object'?{'body:$':JSON.stringify(file)}:{})});
  f.run=async(profile,input=f.input(profile),signal,session=f.session,binding=f.bindings[profile])=>{const old=globalThis.fetch;globalThis.fetch=f.provider;try{return await session.execute(f.approved[profile],input,binding,signal);}finally{globalThis.fetch=old;}};
  return f;
}

Then('S3 corrects only reviewed object byte contracts and retains all native methods',async()=>{
  const raw=await readServiceSchemaUpstream('aws-s3');assert.equal(hash(gunzipSync(await readFile('src/catalogs/services/aws-s3.json.gz')),'sha256','hex'),s3SourceSha256);
  const doc=applySchemaPatches(raw,[awsS3Files]);assert.deepEqual(await readServiceSchema('aws-s3'),doc);const item=doc.paths['/{Bucket}/{Key}'];
  for(const [method,profile] of [['get','get-object'],['put','put-object']]){
    const source=raw.paths['/{Bucket}/{Key}'][method],op=item[method];assert.equal(op.operationId,source.operationId);assert.equal(op['x-operations-s3-files'],profile);
    assert.deepEqual(op['x-upstream-s3-object-contract'].responses,source.responses);assert.ok(op.responses.default.content['application/xml']);
    if(method==='put'){assert.deepEqual(op['x-upstream-s3-object-contract'].requestBody,source.requestBody);assert.equal(op.requestBody.content['application/octet-stream'].schema.format,'binary');}
  }
  for(const [path,methods] of Object.entries(raw.paths))for(const method of Object.keys(methods))if(!(path==='/{Bucket}/{Key}'&&['get','put'].includes(method)))assert.deepEqual(doc.paths[path][method],methods[method]);
  const models=inspectServiceSchema(doc,'aws-s3').operations;assert.equal(models.length,97);assert.deepEqual(models.filter(op=>!op.unavailableReason).map(op=>op.id).sort(),['aws-s3:GetObject','aws-s3:PutObject']);
  for(const change of [d=>d.info.version='future',d=>d.servers[0].url='https://unreviewed.example.test',d=>d.paths['/{Bucket}/{Key}'].put.operationId='Other',d=>d.paths['/{Bucket}/{Key}'].get.servers=[{url:'https://unreviewed.example.test'}]]){const changed=structuredClone(raw);change(changed);assert.throws(()=>applySchemaPatches(changed,[awsS3Files]),/reviewed/);}
});
Then('S3 regional path and virtual hosts preserve escaped keys without browser normalization',()=>{
  for(const value of ['folder//雪 +?%2F/#final.bin','/leading/','%2E/%2e%2e/literal','a\\b','emoji/😀'])for(const style of ['path','virtual']){
    const origin='https://'+(style==='virtual'?bucket+'.':'')+'s3.us-east-1.amazonaws.com';const path='/'+bucket+'/'+encodeS3Key(value),url=s3ObjectUrl(origin,path);
    assert.equal(decodeURIComponent(url.pathname.slice(style==='virtual'?1:bucket.length+2)),value);
  }
  for(const origin of ['http://s3.us-east-1.amazonaws.com','https://s3.amazonaws.com','https://s3-us-east-1.amazonaws.com','https://s3.us-east-1.amazonaws.com.evil.test','https://s3.cn-north-1.amazonaws.com.cn','https://bucket.s3-accelerate.amazonaws.com','https://s3.us-east-1.amazonaws.com/other','https://s3.us-east-1.amazonaws.com:8443'])assert.equal(s3SigningEndpoint(origin),undefined);
  for(const value of ['.','a/../b','a/./b','x\n','雪'.repeat(342)])assert.throws(()=>encodeS3Key(value));
  assert.throws(()=>s3ObjectUrl('https://other-bucket.s3.us-east-1.amazonaws.com','/'+bucket+'/key'));
});
Then('S3 {string} uploads raw bytes and metadata and downloads the same bounded file',async style=>{
  const f=await fixture(style),input={...f.input('put-object'),'header:x-amz-meta-':'{"Note":"binary object"}','header:Cache-Control':'max-age=60'};
  const put=await f.run('put-object',input);assert.equal(put.response.body,'');assert.equal(f.calls[0].init.headers.get('x-amz-meta-note'),'binary object');
  const get=await f.run('get-object');assert.equal(get.response.bodyType,'binary');assert.deepEqual(decoded(get.response.body),rawBytes);assert.equal(get.response.body.mediaType,'application/octet-stream');
  assert.equal(f.calls.length,2);assert.equal(f.stored.get(bucket+'/'+key).metadata,'binary object');assert.equal(get.request.path,new URL(f.calls[1].address).pathname);safe(put);safe(get);
});
Then('an S3 workflow runner preserves an uploaded file through an explicit Binary cast',async()=>{
  const f=await fixture(),full=await readServiceSchema('aws-s3'),document={...full,paths:{'/{Bucket}/{Key}':{get:full.paths['/{Bucket}/{Key}'].get,put:full.paths['/{Bucket}/{Key}'].put}}},data=readWorkflowFile('example.json',new TextEncoder().encode(' {"n":12}\r\n'));
  const previous=[...catalogs];updateCatalogs([...previous,{id:'aws-s3',name:'S3',file:'s3.json',document,groups:[],execution:{kind:'http',origin:f.origin}}]);
  try {
  const file={id:'file',type:'file',position:{x:0,y:0},data:{file:data}},graph=createOperationGraph(f.models['put-object'],{x:400,y:0},'send',document);
  const target=graph.nodes.find(n=>n.type==='data'&&n.data.direction==='inputs'&&n.data.fields.some(field=>field.inputKey==='body:$'||field.type==='Binary'));
  const binary=target.data.fields.find(field=>field.type==='Binary');const edge={id:'file-body',kind:'mapping',source:file.id,sourceHandle:'value',target:target.id,targetHandle:binary.id};
  const cast=insertFileBinaryCast(edge,[file,...graph.nodes],graph.edges,'s3-binary-cast');
  const workflow={version:3,id:'s3-workflow',name:'S3 bytes',nodes:cast.nodes,edges:cast.edges,viewport:{x:0,y:0,zoom:1},snap:true,curved:false,dashed:false};
  const runner=createWorkflowRunner(workflow,'send',{execute:async(_op,values)=>f.run('put-object',{...values,'path:Bucket':bucket,'path:Key':key})});
  const values=runner.next().values;assert.deepEqual(JSON.parse(values['body:$']),data.original);await runner.submit({...values,'path:Bucket':bucket,'path:Key':key});
  assert.deepEqual(f.stored.get(bucket+'/'+key).bytes,Uint8Array.from(Buffer.from(data.original.base64,'base64')));assert.ok(cast.nodes.some(n=>n.id==='s3-binary-cast'&&n.data.targetType==='Binary'));
  } finally { updateCatalogs(previous); }
});
Then('S3 object JSON text XML and finite stream media remain exact file bytes',async()=>{
  const f=await fixture();for(const media of ['application/json','text/plain','application/xml','image/png','application/x-ndjson','text/event-stream']){
    const data=encodeWorkflowBinary('data.bin',rawBytes,media);await f.run('put-object',f.input('put-object',data));const result=await f.run('get-object');assert.equal(result.response.bodyType,'binary');assert.equal(result.response.body.mediaType,media);assert.deepEqual(decoded(result.response.body),rawBytes);
  }
});
Then('S3 accepts full object SHA256 and single part ETags and rejects missing altered or composite integrity',async()=>{
  const f=await fixture();await f.run('put-object');
  for(const mode of ['sha256','etag']){f.headerMode=mode;assert.deepEqual(decoded((await f.run('get-object')).response.body),rawBytes);}
  for(const mode of ['missing','wrong','composite']){f.headerMode=mode;await assert.rejects(f.run('get-object'),error=>error instanceof VaultError&&error.code==='S3_INTEGRITY');}
});
Then('S3 rejects decompressed object bytes that do not match the stored checksum',async()=>{
  const f=await fixture(),original=gzipSync(rawBytes);f.stored.set(bucket+'/'+key,{bytes:rawBytes,media:'application/octet-stream',proofs:checksumHeaders(original)});
  await assert.rejects(f.run('get-object'),error=>error.code==='S3_INTEGRITY');assert.equal(f.calls.length,1);
});
Then('S3 accepts empty and maximum sized files and rejects oversized uploads and responses',async()=>{
  const f=await fixture();for(const size of [0,500000]){const file=encodeWorkflowBinary('bounded.bin',new Uint8Array(size));await f.run('put-object',f.input('put-object',file));assert.equal((await f.run('get-object')).response.body.size,size);}
  const before=f.calls.length,tooLarge={kind:'workflow-file',version:1,name:'large.bin',mediaType:'application/octet-stream',size:500001,base64:Buffer.alloc(500001).toString('base64')};
  await assert.rejects(f.run('put-object',f.input('put-object',tooLarge)));assert.equal(f.calls.length,before);
  f.stored.set(bucket+'/'+key,{bytes:new Uint8Array(500001),media:'application/octet-stream'});await assert.rejects(f.run('get-object'),error=>error.code==='LIMIT');
});
Then('S3 rejects XML Body wrappers unsupported headers metadata and dot segment keys before dispatch',async()=>{
  const f=await fixture();
  for(const changes of [{'body:$':JSON.stringify({Body:'old XML wrapper'})},{'header:Range':'bytes=0-2'},{'header:x-amz-server-side-encryption-customer-key':'private'},{'path:Key':'a/../b'},{'header:x-amz-meta-':'{"Note":"one","note":"two"}'},{'header:x-amz-meta-':'{"bad\\nkey":"value"}'},{'header:x-amz-meta-':JSON.stringify({note:'x'.repeat(2049)})}])await assert.rejects(f.run('put-object',{...f.input('put-object'),...changes}));
  assert.equal(f.calls.length,0);assert.throws(()=>s3MetadataHeaders({note:'雪'}));
});
Then('S3 reload reuses opaque references while changed buckets regions keys expiry and schema reject stale authority',async()=>{
  const f=await fixture('virtual');await f.run('put-object');safe(f.storage.state);safe(await f.session.backup());f.session.lock();const reloaded=new VaultSession(f.storage);await reloaded.unlock(f.proof);
  const binding=await reloaded.connectionBinding(httpConnectionReference(f.connection),f.approved['get-object']);await f.run('get-object',f.input('get-object'),undefined,reloaded,binding);
  const count=f.calls.length;await assert.rejects(f.run('get-object',{...f.input('get-object'),'path:Bucket':'other-bucket'},undefined,reloaded,binding));assert.equal(f.calls.length,count);
  const moved=await approvedOperation(f.models['get-object'],'https://'+bucket+'.s3.us-west-2.amazonaws.com');await assert.rejects(reloaded.connectionBinding(httpConnectionReference(f.connection),moved));
  await reloaded.put(null,{id:f.refs.secretAccessKey,label:'S3 secretAccessKey',kind:'secret',value:'B'.repeat(40)});await assert.rejects(f.run('get-object',f.input('get-object'),undefined,reloaded,binding));assert.equal(f.calls.length,count);
  const fresh=await fixture();fresh.enabled=false;await assert.rejects(fresh.run('put-object'));assert.equal(fresh.calls.length,0);
  const expiring=await fixture(),expiresAt=Date.now()+60000;const connection=await expiring.session.putConnection({label:'S3 files',account:'AWS sandbox',format:'schema',expiresAt,reference:httpConnectionReference(expiring.connection)},expiring.approved['put-object'],expiring.manual);
  const expired=await expiring.session.connectionBinding(httpConnectionReference(connection),expiring.approved['put-object']);const now=vi.spyOn(Date,'now').mockReturnValue(expiresAt+1);try{await assert.rejects(expiring.run('put-object',expiring.input('put-object'),undefined,expiring.session,expired));assert.equal(expiring.calls.length,0);}finally{now.mockRestore();}
});
Then('S3 cancellation and unverifiable write responses report possible completion and never retry',async()=>{
  const f=await fixture(),cancelled=new AbortController();cancelled.abort();await assert.rejects(f.run('put-object',f.input('put-object'),cancelled.signal),error=>error.code==='CANCELLED');assert.equal(f.calls.length,0);
  const controller=new AbortController();f.afterWrite=()=>{controller.abort();throw new DOMException('cancelled','AbortError');};await assert.rejects(f.run('put-object',f.input('put-object'),controller.signal),error=>error.code==='WRITE_UNCONFIRMED');assert.equal(f.calls.length,1);assert.ok(f.stored.has(bucket+'/'+key));
  const hidden=await fixture();hidden.headerMode='missing';await assert.rejects(hidden.run('put-object'),error=>error.code==='WRITE_UNCONFIRMED');assert.equal(hidden.calls.length,1);assert.ok(hidden.stored.has(bucket+'/'+key));
});
Then('S3 preserves scrubbed XML errors and blocks secret bearing object files',async()=>{
  const f=await fixture();f.fail=true;const error=await f.run('put-object').catch(error=>error);assert.equal(error.response.status,403);assert.ok(error.response.body.includes('<Error>'));safe({message:error.message,response:error.response});assert.equal(f.calls.length,1);assert.equal(f.stored.size,0);
  f.fail=false;f.stored.set(bucket+'/'+key,{bytes:new TextEncoder().encode(credentials.secretAccessKey),media:'application/octet-stream'});
  const withheld=await f.run('get-object');assert.equal(withheld.response.body,null);assert.equal(withheld.response.redacted,true);assert.equal(withheld.response.bodyType,undefined);safe(withheld);assert.equal(f.calls.length,2);
});
