// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { Then } from '@cucumber/cucumber';
import ids from '../tests/aws-rest-selectors.json' with {type:'json'};
import { awsRestContracts, awsRestContract, validAwsRestModel } from './lib/aws-rest.ts';
import { prepareAwsRestRequest, awsRestRequestTarget, decodeAwsRestResponse } from './lib/aws-rest-codec.ts';
import { awsRestChecksums } from './lib/aws-rest-checksum.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { extractOperations } from './lib/catalog.ts';
import { requestBody } from './lib/request-body.ts';
import { appendRequestQuery } from './lib/query-serialization.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { signAwsRequest } from './lib/secrets/aws-sigv4.ts';
import { privateResultInputKeys, supportsCredentialResults } from './lib/credential-results.ts';
import { awsSyntheticValues, verifyAwsSignature } from '../tests/aws-sigv4.fixture.mjs';
import { vaultVariablePlaceholder } from './lib/secrets/variables.ts';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { validateWorkflowDocument, parseWorkflowDocument } from './lib/workflow-document.ts';
import { validateWorkflowBinary } from './lib/workflow-binary.ts';
import display from './lib/operation-display.json' with {type:'json'};

const documents = new Map(), operations = new Map();
const bad = error => error?.code === 'CODEC';
async function model(id) {
  if (!operations.has(id)) {
    const catalog = id.split(':')[0];
    if (!documents.has(catalog)) documents.set(catalog, await readServiceSchema(catalog));
    const operation = inspectServiceSchema(documents.get(catalog), catalog, new Set([id])).operations.find(value=>value.id===id);
    assert.ok(operation && !operation.unavailableReason, JSON.stringify({id,issues:operation?.capabilities?.issues}));
    assert.ok(validAwsRestModel(operation), id); operations.set(id,operation);
  }
  return operations.get(id);
}
async function prepared(id, request = {}) {
  const operation=await model(id);
  const path=operation.path.replace(/\{([^{}]+)\}/g,(_,name)=>name==='Bucket'?'example-bucket':name==='Key'?'folder%2Fexample.txt':'example');
  return { operation, request:prepareAwsRestRequest(operation,{method:operation.method,path,query:{},...request}) };
}
Then('all 190 AWS REST selector operations retain qualified canonical and strict identities',async()=>{
  assert.equal(ids.length,190);assert.equal(new Set(ids).size,190);
  const selected=new Set(ids),found=new Set();
  for(const catalog of new Set(ids.map(id=>id.split(':')[0]))) {
    const document=await readServiceSchema(catalog),canonical=inspectServiceSchema(document,catalog,selected).operations;
    const scoped=structuredClone(document);
    scoped.paths=Object.fromEntries(Object.entries(scoped.paths).flatMap(([path,item])=>{
      const kept=Object.fromEntries(Object.entries(item).filter(([method,op])=>!['get','put','post','delete','patch','head','options','trace'].includes(method)||selected.has(catalog+':'+op.operationId)));
      return Object.keys(kept).some(key=>['get','put','post','delete','patch','head','options','trace'].includes(key))?[[path,kept]]:[];
    }));
    const strict=extractOperations(scoped,catalog);
    assert.deepEqual(new Set(strict.map(op=>op.id)),new Set(canonical.map(op=>op.id)));
    for(const op of [...canonical,...strict]) {
      assert.ok(!op.unavailableReason,JSON.stringify({id:op.id,issues:op.capabilities?.issues}));assert.ok(validAwsRestModel(op),op.id);
      assert.equal(op.path,awsRestContracts().operations[op.id].nativePath);assert.ok(op.path.includes('#'));
      found.add(op.id);
    }
  }
  assert.deepEqual(found,selected);
  const layer=await model('aws-lambda:GetLayerVersionByArn');assert.ok(supportsCredentialResults(layer));
});
Then('AWS REST selectors preserve encoded paths and fixed query values without collisions',async()=>{
  const lambda=await prepared('aws-lambda:GetLayerVersionByArn',{query:{Arn:'arn:aws:lambda:us-east-1:123456789012:layer:example:1'}});
  assert.equal(lambda.request.path,'/2018-10-31/layers');assert.equal(lambda.request.query.find,'LayerVersion');
  const url=new URL('https://lambda.us-east-1.amazonaws.com'+lambda.request.path);appendRequestQuery(url,lambda.request);
  assert.equal(url.searchParams.get('Arn'),'arn:aws:lambda:us-east-1:123456789012:layer:example:1');
  assert.equal(url.hash,'');assert.throws(()=>prepareAwsRestRequest(lambda.operation,{method:'GET',path:lambda.operation.path,query:{find:'other'}}),bad);
  const cloudfront=await prepared('aws-cloudfront:CreateDistributionWithTags2020_05_31');
  assert.equal(cloudfront.request.path,'/2020-05-31/distribution');assert.equal(cloudfront.request.query.WithTags,'');
  const copy=await prepared('aws-s3:CopyObject',{path:'/example-bucket/folder/example%23%3F.txt#x-amz-copy-source',headers:{'x-amz-copy-source':'source-bucket/a%20b.txt'}});
  assert.equal(copy.request.path,'/example-bucket/folder/example%23%3F.txt');assert.deepEqual(copy.request.query,{});
  assert.equal(copy.request.headers['x-amz-copy-source'],'source-bucket/a%20b.txt');
  assert.throws(()=>prepareAwsRestRequest(copy.operation,{method:'PUT',path:'/example-bucket/key#other',query:{}}),bad);
});
Then('S3 Control selector requests resolve account hosts and validated Outposts resources',async()=>{
  const standard=await prepared('aws-s3control:GetAccessPoint',{headers:{'x-amz-account-id':'123456789012'}});
  const target=awsRestRequestTarget(standard.operation,'https://s3-control.us-east-1.amazonaws.com',standard.request);
  assert.equal(target.url.hostname,'123456789012.s3-control.us-east-1.amazonaws.com');assert.equal(target.signing.service,'s3');
  const arn='arn:aws:s3-outposts:us-east-1:123456789012:outpost/op-1234/accesspoint/example';
  const outpost=await prepared('aws-s3control:GetAccessPoint',{path:'/v20180820/accesspoint/'+encodeURIComponent(arn)+'#x-amz-account-id',headers:{'x-amz-account-id':'123456789012'}});
  assert.equal(outpost.request.path,'/v20180820/accesspoint/example');assert.equal(outpost.request.headers['x-amz-outpost-id'],'op-1234');
  const routed=awsRestRequestTarget(outpost.operation,'https://s3-control.us-east-1.amazonaws.com',outpost.request);
  assert.equal(routed.url.hostname,'s3-outposts.us-east-1.amazonaws.com');assert.equal(routed.signing.service,'s3-outposts');
  assert.throws(()=>awsRestRequestTarget(outpost.operation,'https://s3-control.eu-west-1.amazonaws.com',outpost.request),bad);
  for(const account of ['123456789012.evil.test','../other','123456789012:443',''])
    assert.throws(()=>awsRestRequestTarget(standard.operation,'https://s3-control.us-east-1.amazonaws.com',{...standard.request,headers:{'x-amz-account-id':account}}),bad);
  assert.throws(()=>prepareAwsRestRequest(outpost.operation,{method:'GET',path:'/v20180820/accesspoint/'+encodeURIComponent(arn)+'#x-amz-account-id',query:{},headers:{'x-amz-account-id':'999999999999'}}),bad);
  const bucket='arn:aws:s3-outposts:us-east-1:123456789012:outpost/op-1234/bucket/example-bucket';
  const getBucket=await prepared('aws-s3control:GetBucket',{path:'/v20180820/bucket/'+encodeURIComponent(bucket)+'#x-amz-account-id',headers:{'x-amz-account-id':'123456789012'}});
  assert.equal(getBucket.request.path,'/v20180820/bucket/example-bucket');assert.equal(getBucket.request.awsRestOutpost.id,'op-1234');
  const create=await prepared('aws-s3control:CreateAccessPoint',{body:{Bucket:bucket},headers:{'x-amz-account-id':'123456789012'}});
  assert.match(requestBody(create.request),/<Bucket>example-bucket<\/Bucket>/);assert.ok(!requestBody(create.request).includes('arn:'));
  assert.equal(awsRestRequestTarget(create.operation,'https://s3-control.us-east-1.amazonaws.com',create.request).signing.service,'s3-outposts');
});
Then('Object Lambda selectors reject arbitrary hosts and sign the final route and token',async()=>{
  const {operation,request}=await prepared('aws-s3:WriteGetObjectResponse',{headers:{'x-amz-request-route':'route-123','x-amz-request-token':'private-fixture-token'}});
  const target=awsRestRequestTarget(operation,'https://s3.us-east-1.amazonaws.com',request);
  assert.equal(target.url.href,'https://route-123.s3-object-lambda.us-east-1.amazonaws.com/WriteGetObjectResponse');
  assert.deepEqual(target.signing,{service:'s3-object-lambda',region:'us-east-1'});
  const signed=await signAwsRequest('POST',target.url.href,new Headers(request.headers),null,awsSyntheticValues,target.signing);
  verifyAwsSignature(target.url.href,{method:'POST',headers:signed.headers,body:signed.body},awsSyntheticValues,'s3-object-lambda','us-east-1');
  assert.ok(privateResultInputKeys(operation).includes('header:x-amz-request-token'));
  for(const route of ['route.evil.test','route/path','route@evil','route:443','-route'])
    assert.throws(()=>awsRestRequestTarget(operation,'https://s3.us-east-1.amazonaws.com',{...request,headers:{...request.headers,'x-amz-request-route':route}}),bad);
  assert.throws(()=>awsRestRequestTarget(operation,'https://s3.us-east-1.amazonaws.com.evil.test',request),bad);
});
Then('S3 selectors serialize XML structures and raw policy strings correctly',async()=>{
  const deleted=await prepared('aws-s3:DeleteObjects',{body:{Delete:{Objects:[{Key:'a & b.txt'}],Quiet:true}}});
  const wire=requestBody(deleted.request);assert.equal(typeof wire,'string');
  assert.match(wire,/<Delete xmlns="http:\/\/s3.amazonaws.com\/doc\/2006-03-01\/">/);
  assert.match(wire,/<Object><Key>a &amp; b.txt<\/Key><\/Object>/);assert.match(wire,/<Quiet>true<\/Quiet>/);
  const policy='{"Version":"2012-10-17","Statement":[]}';
  const put=await prepared('aws-s3:PutBucketPolicy',{body:{Policy:policy}});
  assert.equal(requestBody(put.request),policy);assert.equal(put.request.contentType,'application/json');
  const result=decodeAwsRestResponse(deleted.operation,new TextEncoder().encode('<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Deleted><Key>a.txt</Key></Deleted></DeleteResult>'),new Headers({'content-type':'application/xml'}),200);
  assert.deepEqual(result,{Deleted:[{Key:'a.txt'}]});
  assert.throws(()=>decodeAwsRestResponse(deleted.operation,new TextEncoder().encode('<Error xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Code>InternalError</Code></Error>'),new Headers({'content-type':'application/xml'}),200),bad);
});
Then('AWS REST selector checksums match independent digests and reject changed checksums',async()=>{
  const {operation,request}=await prepared('aws-s3:DeleteObjects',{body:{Delete:{Objects:[{Key:'a.txt'}]}}});
  const body=requestBody(request),headers=new Headers();await awsRestChecksums(operation,headers,body);
  assert.equal(headers.get('Content-MD5'),createHash('md5').update(body).digest('base64'));
  for(const algorithm of ['SHA1','SHA256']) {
    const h=new Headers({'x-amz-sdk-checksum-algorithm':algorithm});await awsRestChecksums(operation,h,body);
    assert.equal(h.get('x-amz-checksum-'+algorithm.toLowerCase()),createHash(algorithm.toLowerCase()).update(body).digest('base64'));
  }
  for(const [algorithm,expected] of [['CRC32','y/Q5Jg=='],['CRC32C','4waSgw==']]) {
    const h=new Headers({'x-amz-sdk-checksum-algorithm':algorithm});await awsRestChecksums(operation,h,'123456789');
    assert.equal(h.get('x-amz-checksum-'+algorithm.toLowerCase()),expected);
  }
  await assert.rejects(()=>awsRestChecksums(operation,new Headers({'content-md5':'wrong'}),body),bad);
  await assert.rejects(()=>awsRestChecksums(operation,new Headers({'x-amz-sdk-checksum-algorithm':'unknown'}),body),bad);
  await assert.rejects(()=>awsRestChecksums(operation,new Headers({'x-amz-sdk-checksum-algorithm':'SHA256','x-amz-checksum-sha256':'wrong'}),body),bad);
});
Then('S3 selector metadata expands safely and encryption keys remain private with verified digests',async()=>{
  const copy=await prepared('aws-s3:CopyObject',{headers:{'x-amz-meta-':'{"title":"example","owner":"A B"}'}});
  assert.equal(copy.request.headers['x-amz-meta-title'],'example');assert.equal(copy.request.headers['x-amz-meta-owner'],'A B');assert.equal(copy.request.headers['x-amz-meta-'],undefined);
  for(const value of ['{"bad key":"value"}','{"title":"line\\nbreak"}','{"title":42}'])
    assert.throws(()=>prepareAwsRestRequest(copy.operation,{method:'PUT',path:copy.operation.path,query:{},headers:{'x-amz-meta-':value}}),bad);
  const key=Buffer.alloc(32,42),headers=new Headers({'x-amz-server-side-encryption-customer-key':key.toString('base64')});
  await awsRestChecksums(copy.operation,headers,null);
  assert.equal(headers.get('x-amz-server-side-encryption-customer-key-MD5'),createHash('md5').update(key).digest('base64'));
  assert.ok(privateResultInputKeys(copy.operation).includes('header:x-amz-server-side-encryption-customer-key'));
  await assert.rejects(()=>awsRestChecksums(copy.operation,new Headers({'x-amz-server-side-encryption-customer-key':'invalid'}),null),bad);
  const native=await readServiceSchemaUpstream('aws-s3'),document=await readServiceSchema('aws-s3');
  const before=native.paths[copy.operation.path].put,after=document.paths[copy.operation.path].put;
  assert.deepEqual(after['x-upstream-aws-rest-parameters'],before.parameters);
  assert.deepEqual(after['x-upstream-aws-rest-body'],before.requestBody);
});

function frame(name,payload,media='application/octet-stream',type='event') {
  const headers=Buffer.concat(Object.entries({':message-type':type,':event-type':name,':content-type':media}).map(([key,value])=>{
    const k=Buffer.from(key),v=Buffer.from(value),entry=Buffer.alloc(k.length+v.length+4);entry[0]=k.length;k.copy(entry,1);entry[k.length+1]=7;entry.writeUInt16BE(v.length,k.length+2);v.copy(entry,k.length+4);return entry;
  }));
  const data=Buffer.from(payload),bytes=Buffer.alloc(headers.length+data.length+16);bytes.writeUInt32BE(bytes.length);bytes.writeUInt32BE(headers.length,4);
  bytes.writeUInt32BE(crc32(bytes.subarray(0,8)),8);headers.copy(bytes,12);data.copy(bytes,12+headers.length);bytes.writeUInt32BE(crc32(bytes.subarray(0,-4)),bytes.length-4);return bytes;
}
Then('S3 selector event streams preserve XML statistics binary records and correct completion boundaries',async()=>{
  const s3=await model('aws-s3:SelectObjectContent'),headers=new Headers({'content-type':'application/vnd.amazon.eventstream'});
  const records=frame('Records','a,b\n1,2\n'),stats=frame('Stats','<Stats><BytesScanned>42</BytesScanned><BytesProcessed>42</BytesProcessed><BytesReturned>8</BytesReturned></Stats>','text/xml'),end=frame('End','');
  const result=decodeAwsRestResponse(s3,Buffer.concat([records,stats,end]),headers,200);
  assert.equal(Buffer.from(validateWorkflowBinary(result.Payload[0].Records.Payload).base64,'base64').toString(),'a,b\n1,2\n');
  assert.equal(result.Payload[1].Stats.Details.BytesScanned,42);assert.deepEqual(result.Payload[2],{End:{}});
  const corrupt=Buffer.from(records);corrupt[13]^=1;
  for(const data of [records,Buffer.concat([end,records]),corrupt,frame('Stats','<!DOCTYPE x><Stats/>','text/xml'),frame('End','invalid')])
    assert.throws(()=>decodeAwsRestResponse(s3,data,headers,200),bad);
  for(const data of [records.subarray(0,-1),frame('Error','failure','text/xml','error')])
    assert.throws(()=>decodeAwsRestResponse(s3,data,headers,200),bad);
});
Then('AWS selector display synopses preserve the thirteen complete source descriptions',async()=>{
  const selected=ids.filter(id=>Object.hasOwn(display,id));assert.equal(selected.length,13);
  for(const id of selected) {
    const op=await model(id),document=await readServiceSchema(id.split(':')[0]),before=JSON.stringify(document);
    assert.ok(op.description.length>4000);const graph=createOperationGraph(op,{x:0,y:0},'fixture',document);
    assert.equal(graph.nodes[0].data.description,display[id].description);
    const saved=validateWorkflowDocument({version:2,id:crypto.randomUUID(),name:'AWS selector',...graph,viewport:{x:0,y:0,zoom:1},snap:true,curved:true,dashed:false});
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(saved)),saved);assert.equal(JSON.stringify(document),before);
  }
});
Then('native AWS REST selector execution verifies final signatures and enforces destination boundaries',async()=>{
  const fixtures=[
    ['aws-s3:DeleteObjects',{'path:Bucket':'example-bucket','body:Delete':'{"Objects":[{"Key":"a.txt"}]}'},'<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Deleted><Key>a.txt</Key></Deleted></DeleteResult>','s3','s3.us-east-1.amazonaws.com'],
    ['aws-s3control:GetAccessPoint',{'path:name':'example','header:x-amz-account-id':'123456789012'},'<GetAccessPointResult xmlns="http://awss3control.amazonaws.com/doc/2018-08-20/"><Name>example</Name></GetAccessPointResult>','s3','123456789012.s3-control.us-east-1.amazonaws.com'],
    ['aws-s3control:GetAccessPoint',{'path:name':'arn:aws:s3-outposts:us-east-1:123456789012:outpost/op-1234/accesspoint/example','header:x-amz-account-id':'123456789012'},'<GetAccessPointResult xmlns="http://awss3control.amazonaws.com/doc/2018-08-20/"><Name>example</Name></GetAccessPointResult>','s3-outposts','s3-outposts.us-east-1.amazonaws.com'],
    ['aws-s3:WriteGetObjectResponse',{'header:x-amz-request-route':'route-123','header:x-amz-request-token':vaultVariablePlaceholder},'','s3-object-lambda','route-123.s3-object-lambda.us-east-1.amazonaws.com']
  ];
  for(const [id,input,response,service,host] of fixtures) {
    const operation=await model(id),contract=awsRestContract(operation),source=awsRestContracts().sources[contract.catalog];
    const origin=source.endpoint.url.replace(/\{([^{}]+)\}/g,(_,name)=>source.endpoint.variables[name].default);
    const descriptor=await approvedOperation(operation,origin),credentials={},records=[];
    for(const [part,value] of Object.entries(awsSyntheticValues)){credentials[part]=crypto.randomUUID();records.push({id:credentials[part],label:part,value,kind:'secret',grants:[]});}
    const binding={alternative:0,fingerprint:descriptor.fingerprint,credentials:{[operation.security[0][0].name]:credentials}};
    const variables=[],token='PRIVATE_OBJECT_LAMBDA_TOKEN_83472';
    if(id==='aws-s3:WriteGetObjectResponse') {
      await assert.rejects(()=>executeCredentialed(descriptor,{...input,'header:x-amz-request-token':token},binding,records,{assertCurrent(){},async fetchRequest(){assert.fail('A public token must not dispatch');}}),{code:'PERMISSION'});
      const credentialId=crypto.randomUUID();records.push({id:credentialId,label:'Object Lambda token',value:token,kind:'secret',grants:[]});
      variables.push({key:'header:x-amz-request-token',path:[],credentialId});
    }
    let calls=0,wireError;
    decodeAwsRestResponse(operation,new TextEncoder().encode(response),new Headers({'content-type':'application/xml'}),200);
    const result=await executeCredentialed(descriptor,input,binding,records,{assertCurrent(){},...(variables.length?{variables}:{}),async fetchRequest(address,init){
      try {
      calls++;const url=new URL(address);assert.equal(url.hostname,host);assert.equal(url.hash,'');
      verifyAwsSignature(address,init,awsSyntheticValues,service,'us-east-1');
      if(id==='aws-s3:DeleteObjects') {
        assert.equal(url.searchParams.get('delete'),'');assert.equal(new Headers(init.headers).get('content-md5'),createHash('md5').update(init.body).digest('base64'));
      }
      if(id==='aws-s3:WriteGetObjectResponse') assert.equal(new Headers(init.headers).get('x-amz-request-token'),token);
      return new Response(response,{headers:{'content-type':'application/xml'}});
      } catch(error) { wireError=error;throw error; }
    }}).catch(error=>{throw wireError??new Error(id+' dispatches='+calls+': '+error.message,{cause:error});});
    assert.equal(calls,1);assert.equal(result.response.status,200);
    for(const value of Object.values(awsSyntheticValues))assert.ok(!JSON.stringify(result).includes(value));
    assert.ok(!JSON.stringify(result).includes(token));
    await assert.rejects(()=>approvedOperation(operation,origin+'.evil.test'));
  }
});
