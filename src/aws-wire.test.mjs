// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { awsSyntheticValues as credentials, verifyAwsSignature } from '../tests/aws-sigv4.fixture.mjs';
import { applySchemaPatches, awsWireProtocols } from './lib/schema-patches.ts';
import { readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperations } from './lib/catalog.ts';
import { validateSchemaDocument } from './lib/schema-documents.ts';
import { awsWireContracts, awsWireSources, configureAwsWire, awsWireEndpoint } from './lib/aws-wire.ts';
import { decodeAwsWireResponse } from './lib/aws-wire-response.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { readWorkflowResponseBody } from './lib/workflow-response-body.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { VaultSession } from './lib/secrets/session.ts';
import { VaultError } from './lib/secrets/types.ts';
import { newVaultKey, recoveryKey, randomBase64, wrapVaultKey } from './lib/secrets/crypto.ts';
import { sealSnapshot } from './lib/secrets/format.ts';
import { httpConnectionReference } from './lib/secrets/http-connections.ts';

const namespace='https://sts.amazonaws.com/doc/2011-06-15/';
const identity={Account:'001234567890',Arn:'arn:aws:iam::001234567890:user/Alice',UserId:'000123:Alice'};
const xml=(value=identity)=>'<GetCallerIdentityResponse xmlns="'+namespace+'"><GetCallerIdentityResult><Account>'+value.Account+'</Account><Arn>'+value.Arn+'</Arn><UserId>'+value.UserId+'</UserId></GetCallerIdentityResult><ResponseMetadata><RequestId>00001234</RequestId></ResponseMetadata></GetCallerIdentityResponse>';
const input={'body:RequestItems':JSON.stringify({Orders:{Keys:[{id:{S:'雪 +/%?&=\r\n'},revision:{N:'900719925474099312345'},bytes:{B:'AP8='}}],ConsistentRead:true,ProjectionExpression:'#id',ExpressionAttributeNames:{'#id':'id'}}}),'body:ReturnConsumedCapacity':'TOTAL'};
const text=body=>new TextDecoder().decode(body??new Uint8Array());
const refused=error=>error instanceof Error;
function model(profile,method='POST') {
  const c=awsWireContracts[profile],operation={id:'aws-'+c.service+':'+(c.service==='sts'?method+'_':'')+c.action,name:c.action,description:'',group:c.service,method,path:c.path,fields:[],bodyRequired:false,
    security:[[{name:'hmac',kind:'aws-sigv4',header:'Authorization',profile:c.profile}]]};
  configureAwsWire(operation,profile);return operation;
}
function safe(value){for(const secret of Object.values(credentials))for(const form of [secret,encodeURIComponent(secret),new URLSearchParams({v:secret}).toString().slice(2)])assert.ok(!JSON.stringify(value).includes(form));}
async function fixture(profile='dynamodb-batch-get-item',method='POST') {
  const c=awsWireContracts[profile],origin='https://'+c.service+'.us-east-1.amazonaws.com',operation=model(profile,method);
  const key=await newVaultKey(),id=crypto.randomUUID(),methodId=crypto.randomUUID(),recovery=randomBase64(128),salt=randomBase64(16);
  const envelope={id:methodId,kind:'recovery',revision:1,salt,wrappedKey:await wrapVaultKey(key,await recoveryKey(recovery,salt),{vaultId:id,epoch:1,kind:'recovery',id:methodId,revision:1})};
  const storage={state:{revision:1,lockEpoch:1,snapshot:await sealSnapshot({id,epoch:1,revision:1,envelopes:[envelope],records:[]},key)},
    async read(){return structuredClone(this.state);},async replace(expected,snapshot,keys){if(expected.revision!==this.state.revision||expected.lockEpoch!==this.state.lockEpoch)throw new VaultError('CONFLICT');this.state={revision:this.state.revision+1,lockEpoch:this.state.lockEpoch+1,snapshot:structuredClone(snapshot),keys:structuredClone(keys)};return this.read();},
    async indexKeys(expected,keys){assert.equal(expected.revision,this.state.revision);this.state.keys=structuredClone(keys);return this.read();},async lock(){this.state.revision++;this.state.lockEpoch++;return this.read();}};
  const f={origin,operation,storage,proof:{methodId,secret:recovery},calls:[],enabled:true,fail:false};
  f.session=new VaultSession(storage,undefined,async()=>{if(!f.enabled)throw new VaultError('PERMISSION');});await f.session.unlock(f.proof);
  const refs={};for(const [part,value] of Object.entries(credentials)){const entries=await f.session.put(null,{label:'AWS wire '+part,kind:'secret',value});refs[part]=entries.find(item=>item.label==='AWS wire '+part).id;}
  f.refs=refs;f.approved=await approvedOperation(operation,origin);f.manual={alternative:0,fingerprint:f.approved.fingerprint,credentials:{hmac:refs}};
  f.connection=await f.session.putConnection({label:'AWS wire',account:'Sandbox',format:'schema'},f.approved,f.manual);f.binding=await f.session.connectionBinding(httpConnectionReference(f.connection),f.approved);
  f.provider=async(address,init)=>{
    const call={address,init};f.calls.push(call);Object.assign(call,verifyAwsSignature(address,init,credentials,c.service));
    const url=new URL(address);assert.equal(url.pathname,'/');assert.equal(url.hash,'');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
    const headers=new Headers(init.headers);
    if(c.service==='dynamodb') {
      assert.equal(init.method,'POST');assert.equal(url.search,'');assert.equal(headers.get('X-Amz-Target'),'DynamoDB_20120810.'+c.action);assert.equal(headers.get('Content-Type'),'application/x-amz-json-1.0');
      call.body=JSON.parse(text(init.body));
      return new Response(JSON.stringify(f.fail?{__type:'com.amazonaws.dynamodb#AccessDeniedException',message:Object.values(credentials).join(' ')}
        :profile==='dynamodb-batch-get-item'?{Responses:{Orders:[{id:{S:'returned'},revision:{N:'900719925474099312345'}}]},UnprocessedKeys:call.body.RequestItems,ConsumedCapacity:[]}
        :{TableNames:['Orders'],LastEvaluatedTableName:'Orders'}),{status:f.fail?400:200,headers:{'Content-Type':'application/x-amz-json-1.0'}});
    }
    assert.equal(headers.has('X-Amz-Target'),false);
    call.parameters=init.method==='POST'?new URLSearchParams(text(init.body)):url.searchParams;
    assert.deepEqual([...call.parameters],[['Action','GetCallerIdentity'],['Version','2011-06-15']]);
    if(init.method==='POST'){assert.equal(headers.get('Content-Type'),'application/x-www-form-urlencoded');assert.equal(url.search,'');assert.equal(text(init.body),'Action=GetCallerIdentity&Version=2011-06-15');}
    else assert.equal(init.body,null);
    return new Response(f.fail?'<ErrorResponse xmlns="'+namespace+'"><Error><Type>Sender</Type><Code>InvalidClientTokenId</Code><Message>'+Object.values(credentials).join(' ')+'</Message></Error><RequestId>request</RequestId></ErrorResponse>':xml(),{status:f.fail?403:200,headers:{'Content-Type':'text/xml; charset=utf-8'}});
  };
  f.run=async(values=profile==='dynamodb-batch-get-item'?input:{},binding=f.binding,session=f.session,descriptor=f.approved)=>{
    const old=globalThis.fetch;globalThis.fetch=f.provider;try{return await session.execute(descriptor,values,binding);}finally{globalThis.fetch=old;}
  };return f;
}
Then('AWS wire corrections preserve native sources and expose only the reviewed four methods',async()=>{
  for(const [id,count,available] of [['aws-dynamodb',53,2],['aws-sts',16,2]]){
    const upstream=await readServiceSchemaUpstream(id);assert.equal(createHash('sha256').update(JSON.stringify(upstream)).digest('hex'),awsWireSources[id]);
    const before=structuredClone(upstream),document=applySchemaPatches(upstream,[awsWireProtocols]),inspected=inspectServiceSchema(document,id);
    assert.deepEqual(upstream,before);assert.equal(inspected.operations.length,count);assert.equal(inspected.operations.filter(op=>!op.unavailableReason).length,available);
    for(const operation of inspected.operations){const source=document.paths[operation.path][operation.method.toLowerCase()],original=before.paths[operation.path][operation.method.toLowerCase()];assert.equal(source.operationId,original.operationId);
      if(!operation.unavailableReason){assert.ok(source['x-upstream-aws-wire-contract']);assert.ok(operation.awsWire);assert.ok(operation.security.flat().every(s=>s.kind==='aws-sigv4'));assert.equal(prepareRequest(operation,operation.awsWire==='dynamodb-batch-get-item'?input:{}).path,'/');
        const selected={...document,paths:{[operation.path]:{[operation.method.toLowerCase()]:source}}};assert.equal(extractOperations(selected,id)[0].awsWire,operation.awsWire);
        assert.equal(validateSchemaDocument(selected,id+'-uploaded').operations[0].awsWire,operation.awsWire);
        const untagged=structuredClone(selected);delete untagged.paths[operation.path][operation.method.toLowerCase()]['x-operations-aws-wire'];assert.throws(()=>validateSchemaDocument(untagged,id+'-unqualified'));
        const forged=structuredClone(selected);forged.paths['/#Action=Unreviewed']=forged.paths[operation.path];delete forged.paths[operation.path];assert.throws(()=>validateSchemaDocument(forged,id+'-forged'));
      }else assert.deepEqual(source,original);
    }
    const changed=structuredClone(before);changed.info.version='unreviewed';assert.throws(()=>applySchemaPatches(changed,[awsWireProtocols]));
  }
});
Then('DynamoDB batch reads send exact target JSON and return unprocessed keys without replay',async()=>{
  const f=await fixture(),result=await f.run();assert.deepEqual(f.calls[0].body,{RequestItems:JSON.parse(input['body:RequestItems']),ReturnConsumedCapacity:'TOTAL'});
  assert.equal(result.request.path,'/');assert.equal(result.response.mediaType,'application/json');assert.equal(result.response.transportMediaType,'application/x-amz-json-1.0');
  assert.equal(result.response.body.Responses.Orders[0].revision.N,'900719925474099312345');assert.deepEqual(result.response.body.UnprocessedKeys,f.calls[0].body.RequestItems);assert.equal(f.calls.length,1);safe(result);
});
Then('DynamoDB table listing signs empty and paginated JSON using one saved connection',async()=>{
  const f=await fixture('dynamodb-list-tables');await f.run();assert.equal(text(f.calls[0].init.body),'{}');
  await f.run({'body:ExclusiveStartTableName':'Orders','body:Limit':'2'});assert.deepEqual(f.calls[1].body,{ExclusiveStartTableName:'Orders',Limit:2});assert.equal(f.calls.length,2);
});
Then('STS identity requests sign query or form bytes and decode the matching XML envelope',async()=>{
  for(const method of ['POST','GET']){const f=await fixture('sts-get-caller-identity',method),result=await f.run();assert.deepEqual(result.response.body,{...identity,ResponseMetadata:{RequestId:'00001234'}});assert.equal(result.response.transportMediaType,'text/xml');assert.equal(f.calls.length,1);safe(result);}
  const entities=xml({...identity,UserId:'000123:A&amp;B&#x2F;C'});assert.equal(decodeAwsWireResponse('sts-get-caller-identity',entities,'text/xml',200).UserId,'000123:A&B/C');
  assert.equal(decodeAwsWireResponse('sts-get-caller-identity',xml({...identity,UserId:'A&amp;amp;B&#47;C'}),'text/xml',200).UserId,'A&amp;B/C');
});
Then('forged AWS wire models and public protocol fields cannot reach a signer or fetch',async()=>{
  const f=await fixture();for(const change of [{path:'/#X-Amz-Target=DynamoDB_20120810.DeleteTable'},{path:'/'},{method:'DELETE'},{bodyMediaType:'text/xml'},
    {awsWire:'sts-get-caller-identity'},{security:[...f.operation.security,[]]},{fields:[...f.operation.fields,{key:'header:X-Amz-Target',name:'X-Amz-Target',location:'header',label:'Target',type:'string',required:false}]}])
    await assert.rejects(approvedOperation({...structuredClone(f.operation),...change},f.origin),refused);
  for(const key of ['header:X-Amz-Target','header:Authorization','header:X-Amz-Date','query:Action','body:Version'])await assert.rejects(f.run({...input,[key]:'forged'}),refused);
  assert.equal(f.calls.length,0);
});
Then('AWS wire connections survive encrypted reload and reject changed regions services and credentials',async()=>{
  for(const profile of ['dynamodb-list-tables','sts-get-caller-identity']){
    const f=await fixture(profile);f.session.lock();const session=new VaultSession(f.storage);await session.unlock(f.proof);const ref=httpConnectionReference(f.connection),binding=await session.connectionBinding(ref,f.approved);await f.run({},binding,session);
    const region=await approvedOperation(f.operation,f.origin.replace('us-east-1','us-west-2'));await assert.rejects(session.connectionBinding(ref,region),refused);
    for(const origin of ['http://sts.us-east-1.amazonaws.com','https://sts.amazonaws.com','https://dynamodb-fips.us-east-1.amazonaws.com','https://sts.cn-north-1.amazonaws.com.cn',f.origin+'/base',f.origin+':8443',f.origin+'.evil.test',f.origin.replace('us-east-1','unknown-1'),f.origin.replace('sts.','dynamodb.').replace('dynamodb.dynamodb.','sts.')]){
      if(!awsWireEndpoint(origin,profile))await assert.rejects(approvedOperation(f.operation,origin),refused);
    }
    await session.put(null,{id:f.refs.secretAccessKey,label:'AWS wire secretAccessKey',kind:'secret',value:'B'.repeat(40)});await assert.rejects(f.run({},binding,session),refused);assert.equal(f.calls.length,1);
  }
});
Then('AWS wire decoders reject mismatched media invalid JSON and unsafe or ambiguous XML',async()=>{
  for(const [body,media] of [['{}','application/json'],['not JSON','application/x-amz-json-1.0'],['[]','application/x-amz-json-1.0'],['null','application/x-amz-json-1.0']])assert.throws(()=>decodeAwsWireResponse('dynamodb-list-tables',body,media,200));
  for(const body of [xml().replace(namespace,'https://evil.test/'),xml().replace('<Account>','<Account><Nested>bad</Nested>'),xml().replace('</Account>','</Account><Account>duplicate</Account>'),
    '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]>'+xml(),xml().replace('<UserId>','<UserId><![CDATA['),'<other>'+xml()+'</other>',xml()+xml(),xml().replace('UserId','Other'),xml().replace('GetCallerIdentityResult','Other'),
    xml().replace(identity.UserId,'<x>'.repeat(10)+'deep'+'</x>'.repeat(10)),xml().replace(identity.UserId,'<?other instruction?>value'),xml().replace('<Account>'+identity.Account+'</Account>',''),xml().replace(identity.UserId,'A&copy;B')])
    assert.throws(()=>decodeAwsWireResponse('sts-get-caller-identity',body,'text/xml',200));
  assert.throws(()=>decodeAwsWireResponse('sts-get-caller-identity',xml(),'application/json',200));
  const response=new Response(new Uint8Array([0xff,0xfe]),{headers:{'Content-Type':'text/xml'}});await assert.rejects(readWorkflowResponseBody(response,model('sts-get-caller-identity'),'POST',new AbortController().signal),refused);
  await assert.rejects(readWorkflowResponseBody(new Response(xml(),{headers:{'Content-Type':'invalid'}}),model('sts-get-caller-identity'),'POST',new AbortController().signal),e=>e.code==='MEDIA');
});
Then('AWS wire response limits and cancellation stop decoding without request replay',async()=>{
  const operation=model('sts-get-caller-identity');await assert.rejects(readWorkflowResponseBody(new Response(' '.repeat(65537),{headers:{'Content-Type':'text/xml'}}),operation,'POST',new AbortController().signal),e=>e.code==='LIMIT');
  const controller=new AbortController();let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('<GetCallerIdentityResponse'));},cancel(){cancelled=true;}});
  const waiting=readWorkflowResponseBody(new Response(stream,{headers:{'Content-Type':'text/xml'}}),operation,'POST',controller.signal);controller.abort();await assert.rejects(waiting,e=>e.code==='CANCELLED');assert.equal(cancelled,true);
  const f=await fixture('dynamodb-list-tables');f.provider=async()=>{f.calls.push('one');return new Response('{"pad":"'+'x'.repeat(8*1024*1024)+'"}',{headers:{'Content-Type':'application/x-amz-json-1.0'}});};await assert.rejects(f.run(),refused);assert.equal(f.calls.length,1);
});
Then('AWS JSON and XML failures are scrubbed and never retried automatically',async()=>{
  for(const profile of ['dynamodb-list-tables','sts-get-caller-identity']){const f=await fixture(profile);f.fail=true;const error=await f.run().catch(e=>e);assert.equal(error.response.status,profile.startsWith('sts')?403:400);assert.equal(error.cause,undefined);safe({message:error.message,response:error.response});assert.equal(f.calls.length,1);}
});
Then('invalid DynamoDB batch sizes keys and unknown inputs fail before dispatch',async()=>{
  const f=await fixture();for(const items of [{},{Orders:{Keys:[]}},{Orders:{Keys:Array.from({length:101},()=>({id:{S:'id'}}))}},{Orders:{Keys:[{}]}},{Orders:{Keys:[{id:{N:123}}]}},{Orders:{Keys:[{id:{B:'not base64!'}}]}},
    {Orders:{Keys:[{id:{S:'one',N:'2'}}]}},{Orders:{Keys:[{id:{M:{nested:{S:'no'}}}}]}},{Orders:{Keys:[{id:{S:'id'}}],Unknown:true}}])await assert.rejects(f.run({'body:RequestItems':JSON.stringify(items)}),refused);
  assert.equal(f.calls.length,0);
});
