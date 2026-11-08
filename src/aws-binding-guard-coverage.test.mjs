// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {awsRestContracts} from './lib/aws-rest.ts';
import {bindAwsRest,awsRestSourcePins} from './lib/aws-rest-bindings.ts';
import {bindAwsJson} from './lib/aws-json-bindings.ts';
import {bindAwsQuery} from './lib/aws-query-bindings.ts';
import {prepareAwsRestOutpost,awsRestTarget} from './lib/aws-rest-target.ts';
import {readServiceSchemaUpstream} from './lib/service-schema-packs.ts';

const codec=error=>error?.code==='CODEC';
function operation(id){const c=awsRestContracts().operations[id];assert.ok(c,id);return {id,method:c.method,path:c.path};}
function declaration(document,id){const c=awsRestContracts().operations[id];return document.paths[c.nativePath][c.nativeMethod.toLowerCase()];}
const parameter=(document,value)=>value.$ref?document.components.parameters[value.$ref.split('/').at(-1)]:value;

Then('AWS REST native normalization retains schema alternatives and migrates required body fields',async()=>{
  const raw=await readServiceSchemaUpstream('aws-elasticfilesystem'),document=structuredClone(raw),id='aws-elasticfilesystem:DescribeAccountPreferences';
  const input=declaration(document,id);input.parameters=[...(input.parameters??[]),{name:'Authorization',in:'header',schema:{type:'string'}}];
  input.requestBody.content['application/json'].schema.properties.NextToken={
    anyOf:[{type:'string',format:'password'}],oneOf:[{type:'string',format:'uuid'}]};
  const original=structuredClone(input);bindAwsRest(document);
  const normalized=declaration(document,id),schema=normalized.requestBody.content['application/json'].schema.properties.NextToken;
  assert.deepEqual(schema,{anyOf:[{type:'string'}],oneOf:[{type:'string'}]});
  assert.deepEqual(normalized['x-upstream-aws-rest-body'],original.requestBody);
  assert.deepEqual(normalized['x-upstream-aws-rest-parameters'],original.parameters);
  assert.ok(!normalized.parameters.some(value=>parameter(document,value).name==='Authorization'));
  const invalid=structuredClone(raw);declaration(invalid,id).requestBody.content['application/json'].schema.properties.NextToken={type:'string',pattern:'['};
  assert.throws(()=>bindAwsRest(invalid),/unsupported AWS input pattern/);
  const optional=structuredClone(raw),optionalInput=declaration(optional,id);delete optionalInput.requestBody;
  optionalInput.parameters=[{name:'NextToken',in:'query',required:false,schema:{type:'string'}}];bindAwsRest(optional);
  const optionalBody=declaration(optional,id).requestBody;
  assert.equal(optionalBody.required,false);assert.deepEqual(optionalBody.content['application/json'].schema.properties.NextToken,{type:'string'});
  const gateway=structuredClone(await readServiceSchemaUpstream('aws-apigatewayv2')),create=declaration(gateway,'aws-apigatewayv2:CreateApi');
  delete create.requestBody;create.parameters=[{name:'Name',in:'query',required:true,schema:{type:'string',minLength:1}}];
  bindAwsRest(gateway);assert.equal(create.parameters.length,0);assert.equal(create.requestBody.required,true);
  assert.deepEqual(create.requestBody.content['application/json'].schema.required,['name']);
  assert.deepEqual(create.requestBody.content['application/json'].schema.properties.name,{type:'string',minLength:1});
  assert.deepEqual(awsRestSourcePins(),Object.fromEntries(Object.entries(awsRestContracts().sources).map(([catalog,source])=>[catalog,source.sha256])));
  assert.throws(()=>bindAwsJson({}),/pinned native and SDK contracts/);assert.throws(()=>bindAwsQuery({}),/pinned native and SDK contracts/);
});

Then('AWS XML metadata maps migrate out of bodies without retaining spurious required fields',async()=>{
  const raw=await readServiceSchemaUpstream('aws-s3'),id='aws-s3:CopyObject';
  for(const includeMetadata of [true,false]){
    const document=structuredClone(raw),input=declaration(document,id);
    input.parameters=(input.parameters??[]).filter(value=>{
      const p=parameter(document,value);return !(p.in==='header'&&p.name.toLowerCase()==='x-amz-meta-');
    });
    const metadata={type:'object',additionalProperties:{type:'string'}};
    input.requestBody={required:true,content:{'application/json':{schema:{type:'object',
      properties:includeMetadata?{'x-amz-meta-':metadata}:{},required:includeMetadata?['x-amz-meta-']:[]}}}};
    const original=structuredClone(input.requestBody);bindAwsRest(document);
    assert.equal(input.requestBody,undefined);assert.deepEqual(input['x-upstream-aws-rest-body'],original);
    const headers=input.parameters.filter(value=>value.in==='header'&&value.name==='x-amz-meta-');
    assert.equal(headers.length,includeMetadata?1:0);
    if(includeMetadata){assert.equal(headers[0].required,false);assert.deepEqual(headers[0].schema,{type:'string',maxLength:65536});}
  }
});

Then('AWS Outposts routes reject conflicting resources malformed paths and destination suffixes',()=>{
  const account='123456789012',origin='https://s3-control.us-east-1.amazonaws.com',headers={'x-amz-account-id':account};
  const regional=operation('aws-s3control:ListRegionalBuckets'),request={method:'GET',path:'/v20180820/bucket',query:{},headers};
  const regionalRequest=prepareAwsRestOutpost(regional,{...request,headers:{...headers,'X-Amz-Outpost-Id':'op-1234'}});
  assert.deepEqual(regionalRequest.awsRestOutpost,{region:'',account,id:'op-1234'});
  const target=awsRestTarget(regional,origin,regionalRequest);assert.equal(target.url.hostname,'s3-outposts.us-east-1.amazonaws.com');assert.equal(target.signing.service,'s3-outposts');
  assert.equal(prepareAwsRestOutpost(regional,{...request,headers:undefined}).awsRestOutpost,undefined);
  for(const badHeaders of [{'x-amz-outpost-id':'op-1234'},{...headers,'x-amz-outpost-id':'bad!'}])
    assert.throws(()=>prepareAwsRestOutpost(regional,{...request,headers:badHeaders}),codec);
  const create=operation('aws-s3control:CreateAccessPoint');
  const arn=(id,kind,name)=>`arn:aws:s3-outposts:us-east-1:${account}:outpost/${id}/${kind}/${name}`;
  const accesspoint=arn('op-1234','accesspoint','owned-accesspoint'),bucket=arn('op-1234','bucket','owned-bucket');
  const createRequest={method:'PUT',path:'/v20180820/accesspoint/'+encodeURIComponent(accesspoint),query:{},headers,body:{Bucket:bucket}};
  const routed=prepareAwsRestOutpost(create,createRequest);assert.equal(routed.path,'/v20180820/accesspoint/owned-accesspoint');assert.equal(routed.body.Bucket,'owned-bucket');
  assert.throws(()=>prepareAwsRestOutpost(create,{...createRequest,body:{Bucket:arn('op-5678','bucket','owned-bucket')}}),codec);
  assert.throws(()=>prepareAwsRestOutpost(create,{...createRequest,headers:{...headers,'x-amz-outpost-id':'op-5678'}}),codec);
  for(const path of ['/wrong','/v20180820/accesspoint/%GG'])assert.throws(()=>prepareAwsRestOutpost(create,{...createRequest,path}),codec);
  const job=operation('aws-s3control:GetJobTagging'),jobPath=(awsRestContracts().operations[job.id].wirePath??job.path).replace(/\{[^{}]+\}/g,'job-1');
  assert.equal(prepareAwsRestOutpost(job,{...request,path:jobPath}).path,jobPath);
  assert.throws(()=>awsRestTarget(regional,'https://other.example.test',request),codec);
  for(const path of ['/v20180820/bucket?extra=one','/v20180820/bucket#fragment','@other.example.test/path'])
    assert.throws(()=>awsRestTarget(regional,origin,{...request,path}),codec);
});
