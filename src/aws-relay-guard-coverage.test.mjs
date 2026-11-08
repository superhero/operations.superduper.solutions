// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {awsGetBodyProfile,awsGetBodyOperation,awsGetBodyPath,awsGetBodyLimit,awsGetBodyResponseLimit,awsGetBodyInput} from './lib/aws-get-body-contract.ts';
import {validateAwsGetBodyRelay,awsGetBodyEligible,awsGetBodyKeyHash,resolveAwsGetBodyKey,fetchAwsGetBody} from './lib/secrets/aws-get-body.ts';
import {awsRestContracts,awsRestSigningProfile,configureAwsRest,validAwsRestModel} from './lib/aws-rest.ts';
import {readWorkflowResponseBody} from './lib/workflow-response-body.ts';

const code=expected=>error=>error?.code===expected,encode=value=>new TextEncoder().encode(value);
async function fixture(){
  const key='relay_fixture_'.repeat(4),pairingKeyId='11111111-2222-4333-8444-555555555555';
  const relay={host:'https://efs-companion.example.test',pairingKeyId,keyHash:await awsGetBodyKeyHash(key)};
  const records=[{id:pairingKeyId,label:'Owned relay fixture',kind:'secret',value:key,grants:[]}];
  const descriptor={fingerprint:'a'.repeat(64),origin:'https://elasticfilesystem.us-east-1.amazonaws.com',
    operation:{id:awsGetBodyOperation,awsRest:'aws-rest-v1',method:'GET'}};
  const address=descriptor.origin+awsGetBodyPath,init={method:'GET',body:encode('{"MaxResults":2}')};
  const envelope={profile:awsGetBodyProfile,fingerprint:descriptor.fingerprint,status:200,statusText:'OK',headers:{'content-type':'application/json'},body:'{"NextToken":"next"}'};
  const invoke=(transport,overrides={},guard=()=>{})=>fetchAwsGetBody(descriptor,relay,records,address,{...init,...overrides},transport,guard);
  return {key,relay,records,descriptor,address,init,envelope,invoke};
}

Then('EFS relay references reject malformed keys identities methods and GET bodies',async()=>{
  const f=await fixture(),input={host:f.relay.host,pairingKeyId:f.relay.pairingKeyId};
  assert.deepEqual(validateAwsGetBodyRelay(f.relay),f.relay);assert.deepEqual(validateAwsGetBodyRelay(input,false),input);
  for(const value of [null,[],42,{...f.relay,unexpected:true},{...f.relay,keyHash:'bad'},
    {...f.relay,pairingKeyId:'bad'},{...f.relay,host:f.relay.host+'/'}])assert.throws(()=>validateAwsGetBodyRelay(value),code('INVALID'));
  assert.throws(()=>validateAwsGetBodyRelay({...input,unexpected:true},false),code('INVALID'));
  for(const value of ['short','invalid character!'.repeat(4),'x'.repeat(257)])await assert.rejects(awsGetBodyKeyHash(value),code('INVALID'));
  assert.equal(await resolveAwsGetBodyKey(f.relay,f.records),f.key);
  for(const records of [[],[...f.records,...f.records],[{...f.records[0],kind:'apiKey'}],
    [{...f.records[0],oauthState:'owned state'}],[{...f.records[0],value:'changed_fixture_'.repeat(4)}]])
    await assert.rejects(resolveAwsGetBodyKey(f.relay,records),code('PERMISSION'));
  assert.equal(awsGetBodyEligible(f.descriptor),true);
  for(const operation of [{...f.descriptor.operation,id:'other:operation'},{...f.descriptor.operation,awsRest:'other'},
    {...f.descriptor.operation,method:'POST'}]){
    const descriptor={...f.descriptor,operation};assert.equal(awsGetBodyEligible(descriptor),false);
    await assert.rejects(fetchAwsGetBody(descriptor,f.relay,f.records,f.address,f.init,()=>assert.fail('Invalid descriptor dispatched'),()=>{}),code('PERMISSION'));
  }
  for(const init of [{...f.init,method:'POST'},{...f.init,body:'{}'}])
    await assert.rejects(fetchAwsGetBody(f.descriptor,f.relay,f.records,f.address,init,()=>assert.fail('Invalid relay input dispatched'),()=>{}),code('PERMISSION'));
  assert.equal(awsGetBodyInput('{}'),'{}');assert.equal(awsGetBodyInput('{"MaxResults":1,"NextToken":"next"}'),'{"MaxResults":1,"NextToken":"next"}');
  for(const value of [undefined,'x'.repeat(awsGetBodyLimit+1),'null','[]','{"Unknown":1}',
    '{"MaxResults":0}','{"MaxResults":1.5}','{"NextToken":2}','{"NextToken":""}','{"NextToken":"'+'x'.repeat(129)+'"}'])
    assert.throws(()=>awsGetBodyInput(value),/Invalid EFS GET body/);
});

Then('EFS relay responses reject changed transport metadata and malformed result envelopes',async()=>{
  const f=await fixture();let requests=0;
  const valid=await f.invoke(async(address,init)=>{
    requests++;assert.equal(address,f.relay.host+'/v1/efs/account-preferences');
    assert.equal(init.method,'POST');assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+f.key);
    assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
    assert.equal(JSON.parse(init.body).body,'{"MaxResults":2}');
    return Response.json(f.envelope,{headers:{'content-type':'application/json; charset=utf-8'}});
  });
  assert.equal(requests,1);assert.equal(await valid.text(),f.envelope.body);
  for(const response of [new Response('',{status:500}),{status:200,redirected:true,headers:new Headers({'content-type':'application/json'})},
    new Response(''),new Response(null,{headers:{'content-type':'application/json'}})])
    await assert.rejects(f.invoke(async()=>response),code('NETWORK'));
  const changes=[null,[],{...f.envelope,extra:true},...[
    {profile:'other'},{fingerprint:'b'.repeat(64)},{status:'200'},{status:199},{status:600},{status:301},
    {statusText:1},{statusText:'bad\nstatus'},{body:1},{body:'x'.repeat(awsGetBodyResponseLimit+1)},
    {headers:null},{headers:[]},{headers:{cookie:'unexpected'}},{headers:{'content-type':1}},
    {headers:{'content-type':'x'.repeat(1025)}},{headers:{'x-amzn-requestid':'bad\rheader'}},
  ].map(change=>({...f.envelope,...change}))];
  for(const envelope of changes)await assert.rejects(f.invoke(async()=>Response.json(envelope)),code('NETWORK'));
  await assert.rejects(f.invoke(async()=>new Response(new Uint8Array(awsGetBodyResponseLimit+65537),{headers:{'content-type':'application/json'}})),code('LIMIT'));
  for(const status of [204,205]){
    const response=await f.invoke(async()=>Response.json({...f.envelope,status,statusText:'',body:''}));
    assert.equal(response.status,status);assert.equal(response.body,null);
  }
});

Then('EFS relay cancellation preserves cancellation errors when stream cleanup rejects',async()=>{
  const f=await fixture();
  for(const abortAt of [1,2,3]){
    const controller=new AbortController();let guards=0,requests=0;
    await assert.rejects(f.invoke(async()=>{requests++;return Response.json(f.envelope);},{signal:controller.signal},()=>{
      if(++guards===abortAt)controller.abort();
    }),code('CANCELLED'));
    assert.equal(guards,abortAt);assert.equal(requests,abortAt===1?0:1);
  }
  const beforeRead=new AbortController();let cancelledBeforeRead=0;
  const stream=new ReadableStream({cancel(){cancelledBeforeRead++;}},{highWaterMark:0});
  const body={getReader(){beforeRead.abort();return stream.getReader();}};
  await assert.rejects(f.invoke(async()=>({status:200,redirected:false,headers:new Headers({'content-type':'application/json'}),body}),
    {signal:beforeRead.signal}),code('CANCELLED'));assert.equal(cancelledBeforeRead,1);
  const duringRead=new AbortController();let cancelledDuringRead=0;
  const pending=new ReadableStream({pull(){duringRead.abort();},cancel(){cancelledDuringRead++;throw new Error('Owned cleanup rejection');}},{highWaterMark:0});
  await assert.rejects(f.invoke(async()=>new Response(pending,{headers:{'content-type':'application/json'}}),
    {signal:duringRead.signal}),code('CANCELLED'));assert.equal(cancelledDuringRead,1);
});

Then('AWS response readers reject stale JSON models and tolerate rejected HEAD body cancellation',async()=>{
  const signal=new AbortController().signal;
  await assert.rejects(readWorkflowResponseBody(Response.json({}),{id:'aws-kms:ListKeys',method:'POST',
    path:'/#X-Amz-Target=TrentService.ListKeys',awsJson:'aws-json-v1',awsJsonRevision:'unreviewed'},'POST',signal),code('CODEC'));
  const id='aws-s3:HeadObject',contract=awsRestContracts().operations[id];assert.ok(contract);
  const operation={id,name:id,description:'',group:'AWS',method:contract.method,path:contract.path,bodyRequired:false,awsRest:awsRestSigningProfile,
    fields:[...contract.path.matchAll(/\{([^{}]+)\}/g)].map(([,name])=>({key:'path:'+name,name,label:name,description:'',type:'string',location:'path',required:true})),
    security:[[{name:'hmac',kind:'aws-sigv4',header:'Authorization',profile:awsRestSigningProfile}]]};
  configureAwsRest(operation);assert.equal(validAwsRestModel(operation),true);
  let cancelled=0;const stream=new ReadableStream({cancel(){cancelled++;throw new Error('Owned HEAD cancellation rejection');}},{highWaterMark:0});
  const result=await readWorkflowResponseBody(new Response(stream),operation,'HEAD',signal);
  assert.equal(cancelled,1);assert.equal(result.mediaType,'application/json');assert.equal(typeof result.body,'object');
});
