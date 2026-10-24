// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { awsSyntheticValues as values, verifyAwsSignature as verify, awsDigest as digest } from '../tests/aws-sigv4.fixture.mjs';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { Then } from '@cucumber/cucumber';
import { vi } from 'vitest';
import { signAwsRequest } from './lib/secrets/aws-sigv4.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { awsRestProfile, lambdaSigningRegion } from './lib/aws-signing.ts';
import { VaultError } from './lib/secrets/types.ts';
import { VaultSession } from './lib/secrets/session.ts';
import { newVaultKey, recoveryKey, randomBase64, wrapVaultKey } from './lib/secrets/crypto.ts';
import { sealSnapshot } from './lib/secrets/format.ts';
import { httpConnectionReference, connectionCredentialIds } from './lib/secrets/http-connections.ts';
import { validateCredentialBinding } from './lib/secrets/bindings.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { serviceSchemaDescriptors, readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { extractOperationSecurity } from './lib/operation-security.ts';
import { portableWorkflowDocument, validateWorkflowDocument } from './lib/workflow-document.ts';

const endpoint = 'https://lambda.us-east-1.amazonaws.com';
const scheme = { name: 'hmac', kind: 'aws-sigv4', header: 'Authorization', profile: awsRestProfile };
const fields = ['Marker', 'MaxItems'].map(name => ({ key: 'query:'+name, name, label: name, location: 'query', type: name === 'MaxItems' ? 'integer' : 'string', required: false }));
const operation = { id: 'aws-fixture:ListFunctions', name: 'List Lambda functions', description: '', group: 'AWS', method: 'GET',
  path: '/2015-03-31/functions/', fields, bodyRequired: false, responseMediaType: 'application/json', security: [[scheme]] };
const refused = error => error instanceof VaultError;
function safe(value, extra = []) {
  for (const secret of [...Object.values(values),...extra]) for (const form of [secret,encodeURIComponent(secret),new URLSearchParams({v:secret}).toString().slice(2)])
    assert.ok(!JSON.stringify(value).includes(form), 'Private AWS material crossed a public boundary');
}
async function fixture(temporary = true) {
  const key = await newVaultKey(), id = crypto.randomUUID(), methodId = crypto.randomUUID(), recovery = randomBase64(128), salt = randomBase64(16);
  const envelope = { id: methodId, kind: 'recovery', revision: 1, salt, wrappedKey: await wrapVaultKey(key, await recoveryKey(recovery,salt),
    { vaultId:id,epoch:1,kind:'recovery',id:methodId,revision:1 }) };
  const storage = { state: { revision:1,lockEpoch:1,snapshot:await sealSnapshot({id,epoch:1,revision:1,envelopes:[envelope],records:[]},key) },
    async read() { return structuredClone(this.state); },
    async replace(expected,snapshot,keys) { if (expected.revision!==this.state.revision || expected.lockEpoch!==this.state.lockEpoch) throw new VaultError('CONFLICT');
      this.state={revision:this.state.revision+1,lockEpoch:this.state.lockEpoch+1,snapshot:structuredClone(snapshot),keys:structuredClone(keys)};return this.read(); },
    async indexKeys(expected,keys) { assert.equal(expected.revision,this.state.revision);this.state.keys=structuredClone(keys);return this.read(); },
    async lock() { this.state.revision++;this.state.lockEpoch++;return this.read(); } };
  const proof={methodId,secret:recovery}, f={storage,proof,enabled:true,calls:[],temporary, echo:false,fail:false};
  f.session=new VaultSession(storage,undefined,async()=>{if(!f.enabled)throw new VaultError('PERMISSION');});await f.session.unlock(proof);
  f.reference={};
  for(const part of ['accessKeyId','secretAccessKey',...(temporary?['sessionToken']:[])]) {
    const entries=await f.session.put(null,{label:'AWS '+part,kind:'secret',value:values[part]});f.reference[part]=entries.find(item=>item.label==='AWS '+part).id;
  }
  f.approved=await approvedOperation(operation,endpoint);
  f.manual={alternative:0,fingerprint:f.approved.fingerprint,credentials:{hmac:f.reference}};
  f.connection=await f.session.putConnection({label:'AWS connection',account:'Sandbox account',format:'schema'},f.approved,f.manual);
  f.binding=await f.session.connectionBinding(httpConnectionReference(f.connection),f.approved);
  f.provider=async(url,init)=>{
    const call={url,init}; f.calls.push(call);
    const checked=verify(url,init,{...values,...(!temporary?{sessionToken:undefined}:{})}); Object.assign(call,checked);
    assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.body,null);
    return Response.json({Functions:[],...(f.echo?{echo:[...Object.values(values),checked.authorization,checked.signature,encodeURIComponent(checked.authorization)]}:{})},{status:f.fail?403:200});
  };
  f.run=async(binding=f.binding,session=f.session,descriptor=f.approved)=>{const old=globalThis.fetch;globalThis.fetch=f.provider;
    try{return await session.execute(descriptor,{'query:Marker':'next +/?=%雪','query:MaxItems':'2'},binding);}finally{globalThis.fetch=old;}};
  return f;
}

Then('AWS signatures match published empty string binary and temporary credential vectors',async()=>{
  // Smithy upstream SignatureV4.spec.ts, reviewed 2026-10-25; exact source SHA in the task evidence.
  const context={service:'foo',region:'us-bar-1',now:()=>Date.parse('2000-01-01T00:00:00Z')}, credentials={accessKeyId:'foo',secretAccessKey:'bar'};
  for(const [body,token,signature] of [
    [undefined,undefined,'1e3b24fcfd7655c0c245d99ba7b6b5ca6174eab903ebfbda09ce457af062ad30'],
    ['It was the best of times, it was the worst of times',undefined,'cf22a0befff359388f136b158f0b1b43db7b18d2ca65ce4112bc88a16815c4b6'],
    [new Uint8Array([0xde,0xad,0xbe,0xef]),undefined,'89f092f52faedb8a6be1890b2a511b88e7998389d62bd7d72915e2f4ee271a64'],
    [undefined,'baz','4fd09a8cf3b28a62a9c6c424f03ababcd703528578bc6ec9184fc585f18c3fbb']]) {
    const signed=await signAwsRequest('POST','https://foo.us-bar-1.amazonaws.com/',new Headers(),body,{...credentials,...(token?{sessionToken:token}:{})},context);
    assert.ok(signed.headers.get('Authorization').endsWith('Signature='+signature));assert.equal(signed.headers.has('host'),false);
    assert.equal(signed.headers.get('X-Amz-Date'),'20000101T000000Z');
  }
});
Then('AWS signing binds encoded paths repeated query keys normalized headers and copied payload bytes',async()=>{
  const bytes=new Uint8Array([0,255,13,10]), original=bytes.slice(), url=endpoint+'/some%20path/%E9%9B%AA?b=two+words&a=2&a=1&empty=&plus=%2B';
  const promise=signAwsRequest('POST',url,new Headers({'Content-Type':'application/octet-stream','X-Example':'  one   two  '}),bytes,values,{service:'lambda',region:'us-east-1'});
  bytes.fill(65);const signed=await promise;assert.deepEqual(signed.body,original);verify(url,{method:'POST',headers:signed.headers,body:signed.body});
  await assert.rejects(Promise.resolve().then(()=>verify(url,{method:'POST',headers:signed.headers,body:bytes})),assert.AssertionError);
  const json=await signAwsRequest('POST',endpoint+'/',new Headers({'Content-Type':'application/json'}),'{"hello":"雪"}',values,{service:'lambda',region:'us-east-1'});
  verify(endpoint+'/',{method:'POST',headers:json.headers,body:json.body});assert.equal(new TextDecoder().decode(json.body),'{"hello":"雪"}');
});
Then('AWS rejects public signing overrides multipart bodies invalid clocks and insecure destinations',async()=>{
  const context={service:'lambda',region:'us-east-1'};
  for(const name of ['Authorization','X-Amz-Date','X-Amz-Content-Sha256','X-Amz-Security-Token','Host'])
    await assert.rejects(signAwsRequest('GET',endpoint+'/',new Headers({[name]:'override'}),undefined,values,context),refused);
  for(const url of ['http://lambda.us-east-1.amazonaws.com/','https://user:pass@lambda.us-east-1.amazonaws.com/','https://lambda.us-east-1.amazonaws.com/#fragment',endpoint+'/?X-Amz-Credential=override'])
    await assert.rejects(signAwsRequest('GET',url,new Headers(),undefined,values,context),refused);
  await assert.rejects(signAwsRequest('POST',endpoint+'/',new Headers(),new FormData(),values,context),refused);
  for(const now of [NaN,-1,Infinity,1.5])await assert.rejects(signAwsRequest('GET',endpoint+'/',new Headers(),undefined,values,{...context,now:()=>now}),refused);
});
Then('native AWS schemas retain source identities while only the selected Lambda REST request becomes executable',async()=>{
  const raw=await readServiceSchemaUpstream('aws-lambda'),document=await readServiceSchema('aws-lambda');assert.deepEqual(document,raw);
  const descriptor=serviceSchemaDescriptors.find(item=>item.id==='aws-lambda');assert.equal(descriptor.version,'2015-03-31');
  assert.equal(digest(gunzipSync(await readFile('src/catalogs/services/aws-lambda.json.gz'))),descriptor.sha256);
  const models=inspectServiceSchema(document,'aws-lambda').operations;assert.equal(models.length,66);
  const available=models.filter(item=>!item.unavailableReason);assert.deepEqual(available.map(item=>item.id),['aws-lambda:ListFunctions']);
  assert.equal(available[0].fields.length,4);assert.ok(available[0].fields.every(item=>item.location==='query'));assert.deepEqual(available[0].security,[[scheme]]);
  await approvedOperation(available[0],endpoint);
  const s3=inspectServiceSchema(await readServiceSchema('aws-s3'),'aws-s3').operations;
  assert.equal(s3.length,97);assert.deepEqual(s3.filter(item=>!item.unavailableReason).map(item=>item.id).sort(),['aws-s3:GetObject','aws-s3:PutObject']);
  assert.ok(s3.filter(item=>!item.unavailableReason).every(item=>item.security[0][0].kind==='aws-sigv4'));
  for(const id of ['aws-sts','aws-dynamodb']) {
    const methods=inspectServiceSchema(await readServiceSchema(id),id).operations;assert.ok(methods.length>0);assert.ok(methods.every(item=>item.unavailableReason));
  }
  for(const marker of ['awsSigv4','awsS3'])assert.throws(()=>extractOperationSecurity({components:{securitySchemes:{hmac:{type:'apiKey',in:'header',name:'Authorization','x-amazon-apigateway-authtype':marker}}},security:[{hmac:[]}]},{}),/Signature Version 4/);
  for(const marker of ['awsSigv4','awsS3']) {
    const oauthDocument={openapi:'3.0.3',info:{title:'AWS marker',version:'1'},servers:[{url:endpoint}],security:[{auth:[]}],
      components:{securitySchemes:{auth:{type:'oauth2',flows:{},'x-amazon-apigateway-authtype':marker}}},
      paths:{'/read':{get:{operationId:'read',responses:{200:{description:'JSON',content:{'application/json':{schema:{type:'object'}}}}}}}}};
    assert.match(inspectServiceSchema(oauthDocument,'aws-marker').operations[0].unavailableReason,/Signature Version 4/);
  }
});
Then('a saved AWS connection with {string} credentials signs a current regional Lambda request privately',async mode=>{
  const f=await fixture(mode==='temporary'),result=await f.run();assert.equal(f.calls.length,1);assert.deepEqual(result.response.body,{Functions:[]});safe(result);safe(f.binding);
  assert.equal(f.calls[0].url.startsWith(endpoint+operation.path),true);assert.deepEqual(f.binding.credentials,{});
  const date=f.calls[0].date;assert.ok(Math.abs(Date.now()-Date.parse(date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,'$1-$2-$3T$4:$5:$6Z')))<10000);
});
Then('an encrypted AWS connection survives reload and portable workflows contain no local binding',async()=>{
  const f=await fixture(),reference=httpConnectionReference(f.connection);safe(f.storage.state);safe(await f.session.backup());
  assert.deepEqual(connectionCredentialIds(f.connection).sort(),Object.values(f.reference).sort());f.session.lock();const reloaded=new VaultSession(f.storage);await reloaded.unlock(f.proof);
  const binding=await reloaded.connectionBinding(reference,f.approved);await f.run(binding,reloaded);assert.equal(f.calls.length,1);assert.deepEqual(validateCredentialBinding(f.manual),f.manual);
  const document={version:3,id:'aws',name:'AWS',nodes:[{id:'read',type:'operation',position:{x:0,y:0},data:{operationId:operation.id,name:operation.name,method:'GET',path:operation.path,description:'',credentialBinding:binding}}],edges:[],viewport:{x:0,y:0,zoom:1},snap:true,curved:false,dashed:false};
  assert.deepEqual(validateWorkflowDocument(document).nodes[0].data.credentialBinding,binding);assert.ok(!JSON.stringify(portableWorkflowDocument(document)).includes(reference.id));
});
Then('AWS rejects static Authorization bindings changed regions changed profiles and public protocol fields',async()=>{
  const f=await fixture();
  await assert.rejects(f.run({...f.manual,credentials:{hmac:f.reference.accessKeyId}}),refused);
  for(const destination of ['https://lambda.us-west-2.amazonaws.com','https://lambda.us-east-1.amazonaws.com.evil.test','https://lambda.cn-north-1.amazonaws.com.cn','https://lambda-fips.us-east-1.amazonaws.com',endpoint+'/other',endpoint+':8443']) {
    const region=lambdaSigningRegion(destination);
    if(region){const moved=await approvedOperation(operation,destination);await assert.rejects(f.run(f.binding,f.session,moved),refused);}
    else await assert.rejects(approvedOperation(operation,destination),refused);
  }
  for(const change of [{method:'POST'},{path:'/2015-03-31/functions/other'},{bodyMediaType:'application/json',bodyRequired:true},{fields:[...fields,{key:'header:X-Amz-Date',name:'X-Amz-Date',label:'Date',location:'header',type:'string',required:false}]},{security:[[scheme],[]]}])
    await assert.rejects(approvedOperation({...operation,...change},endpoint),refused);
  assert.equal(f.calls.length,0);
});
Then('stale AWS connection references cannot survive credential rotation removal expiry or lock',async()=>{
  for(const mode of ['rotate','remove','expire','lock']){
    const f=await fixture(); let clock;
    if(mode==='rotate')await f.session.put(null,{id:f.reference.secretAccessKey,label:'AWS secretAccessKey',kind:'secret',value:'B'.repeat(40)});
    if(mode==='remove')await f.session.removeConnection(httpConnectionReference(f.connection));
    if(mode==='expire'){const expiresAt=Date.now()+60000;const next=await f.session.putConnection({label:'AWS connection',account:'Sandbox account',format:'schema',expiresAt,reference:httpConnectionReference(f.connection)},f.approved,f.manual);f.binding=await f.session.connectionBinding(httpConnectionReference(next),f.approved);clock=vi.spyOn(Date,'now').mockReturnValue(expiresAt+1);}
    if(mode==='lock')f.session.lock();
    try{await assert.rejects(f.run(),refused);assert.equal(f.calls.length,0);}finally{clock?.mockRestore();}
  }
});
Then('AWS credential session and derived signature echoes are scrubbed without resource retries',async()=>{
  const f=await fixture();f.echo=true;const result=await f.run();assert.equal(result.response.redacted,true);safe(result,[f.calls[0].signature,f.calls[0].authorization]);
  f.fail=true;const error=await f.run().catch(error=>error);assert.equal(error.cause,undefined);safe({message:error.message,response:error.response},[f.calls[1].signature,f.calls[1].authorization]);assert.equal(f.calls.length,2);
});
Then('AWS cancellation changed schema and stale signing time prevent dispatch',async()=>{
  const f=await fixture(),records=await f.session.list(), secrets=Object.entries(f.reference).map(([part,id])=>({...records.find(item=>item.id===id),value:values[part],grants:[]}));
  const controller=new AbortController();controller.abort();
  await assert.rejects(executeCredentialed(f.approved,{},f.manual,secrets,{signal:controller.signal,assertCurrent:async()=>{},fetchRequest:f.provider}),refused);
  await assert.rejects(executeCredentialed(f.approved,{},f.manual,secrets,{assertCurrent:async()=>{throw new VaultError('PERMISSION');},fetchRequest:f.provider}),refused);
  let now=Date.now(),checks=0;const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
  try {await assert.rejects(executeCredentialed(f.approved,{},f.manual,secrets,{assertCurrent:async()=>{if(++checks===2)now+=61000;},fetchRequest:f.provider}),refused);assert.equal(f.calls.length,0);}
  finally{clock.mockRestore();}
});
