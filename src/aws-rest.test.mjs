// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { Then } from '@cucumber/cucumber';
import ids from '../tests/aws-rest-operations.json' with {type:'json'};
import { awsRestContracts, awsRestEndpoint, awsRestSigningProfile, awsRestPrivateResultPaths, validAwsRestModel } from './lib/aws-rest.ts';
import { awsRestDataSha256 } from './lib/aws-rest-data.ts';
import { decodeAwsRestResponse, prepareAwsRestRequest, awsEventCrc32 } from './lib/aws-rest-codec.ts';
import { encodeWorkflowBinary } from './lib/workflow-binary.ts';
import { requestBody } from './lib/request-body.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperations } from './lib/catalog.ts';

const bytes = value => new TextEncoder().encode(value), headers = type => new Headers({'Content-Type':type});
function model(id) {
  const contract=awsRestContracts().operations[id];assert.ok(contract,id);
  return {id,name:id,description:'',group:'AWS',method:contract.method,path:contract.path,bodyRequired:false,awsRest:awsRestSigningProfile,
    awsRestRevision:awsRestDataSha256,
    fields:[...contract.path.matchAll(/\{([^{}]+)\}/g)].map(([,name])=>({key:'path:'+name,name,label:name,description:'',type:'string',location:'path',required:true})),
    security:[[{name:'hmac',kind:'aws-sigv4',header:'Authorization',profile:awsRestSigningProfile}]],
    ...(Object.hasOwn(awsRestPrivateResultPaths,id)?{credentialResult:true,credentialResultProfile:'private-result-v1'}:{})};
}
function decode(id,body,type='application/json',status=200,extra={}) {
  return decodeAwsRestResponse(model(id),typeof body==='string'?bytes(body):body,new Headers({'Content-Type':type,...extra}),status);
}
const bad = error => error?.code==='CODEC';

Then('all 658 native AWS REST operations have qualified canonical and strict models',async()=>{
  const selected=new Set(ids),found=new Set(),failures=[];
  for(const catalog of Object.keys(awsRestContracts().sources)) {
    const document=await readServiceSchema(catalog),canonical=inspectServiceSchema(document,catalog,selected).operations;
    const scoped=structuredClone(document);scoped.paths=Object.fromEntries(Object.entries(document.paths).flatMap(([path,item])=>{
      const included=Object.fromEntries(Object.entries(item).filter(([method,value])=>!['get','put','post','patch','delete','head','options','trace'].includes(method)||selected.has(catalog+':'+value.operationId)));
      return Object.keys(included).some(method=>['get','put','post','patch','delete','head','options','trace'].includes(method))?[[path,included]]:[];
    }));
    let strict=[];try{strict=extractOperations(scoped,catalog);}catch(error){failures.push({catalog,strict:error.message});}
    for(const operation of canonical){found.add(operation.id);if(operation.unavailableReason||!validAwsRestModel(operation))failures.push({id:operation.id,issues:operation.capabilities?.issues??[],valid:validAwsRestModel(operation)});}
    if(strict.length)assert.deepEqual(new Set(strict.map(operation=>operation.id)),new Set(canonical.map(operation=>operation.id)));
    for(const operation of strict)assert.ok(validAwsRestModel(operation),operation.id);
  }
  assert.deepEqual(found,selected);assert.deepEqual(failures,[],JSON.stringify(failures,null,2));
});

Then('the 658 AWS REST contracts retain pinned sources and reject other authorities',()=>{
  const contracts=awsRestContracts();assert.equal(Object.keys(contracts.sources).length,14);
  assert.deepEqual(new Set(Object.keys(contracts.operations)),new Set(ids));assert.equal(ids.length,658);
  assert.equal(createHash('sha256').update(JSON.stringify(contracts)).digest('hex'),awsRestDataSha256);
  for (const id of ids) {
    const operation=model(id),contract=contracts.operations[id],source=contracts.sources[contract.catalog];assert.ok(validAwsRestModel(operation),id);
    const endpoint=source.endpoint.url.replace(/\{([^{}]+)\}/g,(_,name)=>source.endpoint.variables[name].default);
    const expected={service:source.service,region:source.endpoint.variables.region?.default??'us-east-1'};
    assert.deepEqual(awsRestEndpoint(endpoint,operation),expected,id);
    for (const origin of [endpoint.replace('https:','http:'),endpoint+'.evil.example.test',endpoint+'/prefix',endpoint+'?x=1',endpoint+'#x',endpoint.replace('https://','https://user:pass@')])
      assert.equal(awsRestEndpoint(origin,operation),undefined,origin);
    assert.equal(awsRestEndpoint(endpoint,{...operation,path:operation.path+'/other'}),undefined);
  }
  assert.equal(awsRestEndpoint('https://lambda.us-east-1.amazonaws.com',model('aws-sesv2:GetAccount')),undefined);
  assert.throws(()=>{contracts.operations[ids[0]].method='OTHER';},TypeError);
});

Then('AWS REST JSON serialization preserves logical names and exact wire aliases',()=>{
  const operation=model('aws-apigatewayv2:CreateApi');
  const request=prepareAwsRestRequest(operation,{method:operation.method,path:operation.path,query:{},body:{Name:'Example λ',ProtocolType:'HTTP',
    CorsConfiguration:{AllowOrigins:['https://example.test'],AllowCredentials:true}}});
  assert.deepEqual(JSON.parse(requestBody(request)),{name:'Example λ',protocolType:'HTTP',corsConfiguration:{allowOrigins:['https://example.test'],allowCredentials:true}});
  const nativeAliases=prepareAwsRestRequest(operation,{method:'POST',path:operation.path,query:{},body:{name:'Example λ',protocolType:'HTTP',corsConfiguration:{AllowOrigins:['https://example.test'],AllowCredentials:true}}});
  assert.deepEqual(nativeAliases.body,request.body);
  const response=decode('aws-apigatewayv2:CreateApi','{"apiId":"abc","name":"Example","protocolType":"HTTP","newUnreviewedField":"omitted"}',undefined,201);
  assert.deepEqual(response,{ApiId:'abc',Name:'Example',ProtocolType:'HTTP'});
  const backup=decode('aws-backup:DescribeBackupVault','{"BackupVaultName":"vault","CreationDate":1700000000,"NumberOfRecoveryPoints":2}');
  assert.equal(backup.CreationDate,'2023-11-14T22:13:20.000Z');assert.equal(backup.NumberOfRecoveryPoints,2);
  const empty=prepareAwsRestRequest(operation,{method:'POST',path:operation.path,query:{}});assert.deepEqual(empty.body,{});
  const imported=model('aws-apigateway:PutRestApi');
  const mapped=prepareAwsRestRequest(imported,{method:imported.method,path:imported.path,query:{parameters:'{"ignore":"documentation","label":"a&b λ"}',mode:'merge'}});
  assert.deepEqual(mapped.query,{mode:'merge',ignore:'documentation',label:'a&b λ'});
  assert.throws(()=>prepareAwsRestRequest(imported,{method:imported.method,path:imported.path,query:{parameters:'{"mode":"overwrite"}',mode:'merge'}}),bad);
  assert.throws(()=>prepareAwsRestRequest(imported,{method:imported.method,path:imported.path,query:{parameters:'{"ignore":["documentation"]}'}}),bad);
});

Then('AWS REST XML responses decode reviewed SDK shapes without unsafe XML features',()=>{
  const route='aws-route53:ListHostedZones',namespace='https://route53.amazonaws.com/doc/2013-04-01/';
  const xml=`<ListHostedZonesResponse xmlns="${namespace}"><HostedZones><HostedZone><Id>/hostedzone/Z1</Id><Name>example.test.</Name><CallerReference>ref</CallerReference><Config><Comment> a &amp; b </Comment><PrivateZone>false</PrivateZone></Config><ResourceRecordSetCount>2</ResourceRecordSetCount></HostedZone></HostedZones><Marker/><IsTruncated>false</IsTruncated><MaxItems>100</MaxItems></ListHostedZonesResponse>`;
  const result=decode(route,xml,'text/xml');assert.equal(result.HostedZones.length,1);assert.equal(result.HostedZones[0].ResourceRecordSetCount,2);
  assert.equal(result.HostedZones[0].Config.PrivateZone,false);assert.equal(result.HostedZones[0].Config.Comment,' a & b ');assert.equal(result.IsTruncated,false);
  const cf=decode('aws-cloudfront:GetDistribution2020_05_31','<Distribution xmlns="http://cloudfront.amazonaws.com/doc/2020-05-31/"><Id>D1</Id><Status>Deployed</Status></Distribution>','text/xml',200,{ETag:'revision-1'});
  assert.deepEqual(cf,{Distribution:{Id:'D1',Status:'Deployed'},ETag:'revision-1'});
  const s3=decode('aws-s3:ListBuckets','<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Buckets><Bucket><Name>example-bucket</Name><CreationDate>2024-01-02T03:04:05Z</CreationDate></Bucket></Buckets><Owner><ID>owner</ID></Owner></ListAllMyBucketsResult>','application/xml');
  assert.equal(s3.Buckets[0].Name,'example-bucket');assert.equal(s3.Buckets[0].CreationDate,'2024-01-02T03:04:05.000Z');
  for (const input of [xml.replace(namespace,'https://evil.example.test/'),xml+'<extra/>','<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///etc/passwd">]>'+xml,
    xml.replace(' a &amp; b ','&unknown;'),xml.slice(0,-4),xml.replace('>2<','>not-a-number<')])assert.throws(()=>decode(route,input,'text/xml'),bad);
});

Then('AWS REST payloads remain bounded binary files through both wire directions',async()=>{
  const operation=model('aws-runtime-sagemaker:InvokeEndpoint'),payload=Uint8Array.of(0,255,0,13,10,42),file=encodeWorkflowBinary('input.bin',payload,'application/octet-stream');
  const request=prepareAwsRestRequest(operation,{method:operation.method,path:'/endpoints/model/invocations',query:{},body:file,headers:{'Content-Type':'application/x-custom'}});
  assert.equal(request.contentType,'application/x-custom');assert.equal(request.headers['Content-Type'],undefined);
  assert.deepEqual(new Uint8Array(await requestBody(request).arrayBuffer()),payload);
  const result=decode('aws-runtime-sagemaker:InvokeEndpoint',payload,'application/x-custom',200,{'x-Amzn-Invoked-Production-Variant':'variant'});
  assert.equal(result.Body.base64,file.base64);assert.equal(result.Body.mediaType,'application/x-custom');assert.equal(result.InvokedProductionVariant,'variant');
  assert.equal(decode('aws-runtime-sagemaker:InvokeEndpoint',new Uint8Array(),'application/x-custom').Body.size,0);
  const metadata=decode('aws-s3:HeadObject',new Uint8Array(),'application/xml',200,{'content-length':'123','last-modified':'Tue, 02 Jan 2024 03:04:05 GMT','x-amz-meta-owner':'synthetic'});
  assert.equal(metadata.ContentLength,123);assert.equal(metadata.LastModified,'2024-01-02T03:04:05.000Z');assert.deepEqual(metadata.Metadata,{owner:'synthetic'});
  assert.throws(()=>decode('aws-runtime-sagemaker:InvokeEndpoint',new Uint8Array(500001),'application/octet-stream'),error=>error.code==='LIMIT');
});

function event(name,payload) {
  const entries=Object.entries({':message-type':'event',':event-type':name,':content-type':name==='PayloadChunk'?'application/octet-stream':'application/json'});
  const parts=entries.map(([name,value])=>{const key=bytes(name),data=bytes(value),result=new Uint8Array(1+key.length+3+data.length);result[0]=key.length;result.set(key,1);result[1+key.length]=7;new DataView(result.buffer).setUint16(2+key.length,data.length);result.set(data,4+key.length);return result;});
  const headerLength=parts.reduce((sum,part)=>sum+part.length,0),data=typeof payload==='string'?bytes(payload):payload;
  const frame=new Uint8Array(16+headerLength+data.length),view=new DataView(frame.buffer);view.setUint32(0,frame.length);view.setUint32(4,headerLength);view.setUint32(8,crc32(frame.subarray(0,8)));
  let offset=12;for(const part of parts){frame.set(part,offset);offset+=part.length;}frame.set(data,offset);view.setUint32(frame.length-4,crc32(frame.subarray(0,-4)));return frame;
}
const concatenate=(...parts)=>{const result=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;};
Then('AWS REST binary event streams reject truncation corruption and missing completion',()=>{
  assert.equal(awsEventCrc32(bytes('123456789')),0xcbf43926);
  const id='aws-lambda:InvokeWithResponseStream',chunk=event('PayloadChunk',bytes('hello λ')),done=event('InvokeComplete','{"LogResult":"bG9n"}'),stream=concatenate(chunk,done);
  const result=decode(id,stream,'application/vnd.amazon.eventstream');assert.equal(result.StatusCode,200);
  assert.equal(result.EventStream.length,2);assert.equal(result.EventStream[0].PayloadChunk.Payload.base64,Buffer.from('hello λ').toString('base64'));
  assert.equal(result.EventStream[1].InvokeComplete.LogResult,'bG9n');
  const corrupt=stream.slice();corrupt[13]^=1;
  for(const input of [stream.subarray(0,-1),chunk,concatenate(done,chunk),corrupt,event('Unknown','{}')])assert.throws(()=>decode(id,input,'application/vnd.amazon.eventstream'),bad);
  assert.throws(()=>decode(id,stream,'application/json'),error=>error.code==='MEDIA');
});

Then('AWS REST wire codecs reject unknown inputs wrong media and invalid model descriptors',()=>{
  const operation=model('aws-apigatewayv2:CreateApi'),request={method:'POST',path:operation.path,query:{},body:{UnreviewedAction:'do-something'}};
  assert.throws(()=>prepareAwsRestRequest(operation,request),bad);
  const field={key:'header:X-Amz-Date',name:'X-Amz-Date',label:'Date',description:'',location:'header',required:false,type:'string'};
  assert.equal(validAwsRestModel({...operation,fields:[field]}),false);
  assert.equal(validAwsRestModel({...operation,id:'aws-other:CreateApi'}),false);
  assert.equal(validAwsRestModel({...operation,responseStream:'unreviewed'}),false);
  assert.throws(()=>decode(operation.id,'{}','text/plain'),error=>error.code==='MEDIA');
  assert.throws(()=>decode(operation.id,'{"name":42}'),bad);
  assert.throws(()=>decode('aws-backup:DescribeBackupVault','{"CreationDate":"not-a-time"}'),bad);
});
