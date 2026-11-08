// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {vi} from 'vitest';
import * as rest from './lib/aws-rest.ts';
import {awsJsonContracts} from './lib/aws-json.ts';
import {awsQueryContracts} from './lib/aws-query.ts';
import {bindAwsJson} from './lib/aws-json-bindings.ts';
import {bindAwsQuery} from './lib/aws-query-bindings.ts';
import {readServiceSchemaUpstream} from './lib/service-schema-packs.ts';

Then('JSON and Query native bindings preserve omitted declarations and reject missing target headers atomically',async()=>{
  const raw=await readServiceSchemaUpstream('aws-kms'),document=structuredClone(raw);
  const entry=Object.entries(awsJsonContracts().operations).find(([,c])=>c.catalog==='aws-kms');assert.ok(entry);
  const path='/#X-Amz-Target='+entry[1].target,item=document.paths[path],original=structuredClone(item.post.parameters);
  delete document.components.schemas;delete item.parameters;bindAwsJson(document);
  assert.deepEqual(item.post['x-upstream-aws-json-contract'].parameters,original);
  assert.deepEqual(item.post['x-upstream-aws-json-contract'].pathParameters,[]);
  assert.equal(item.post['x-operations-aws-json'],'aws-json-v1');
  const invalid=structuredClone(raw);delete invalid.paths[path].post.parameters;const before=JSON.stringify(invalid);
  assert.throws(()=>bindAwsJson(invalid),/target/);assert.equal(JSON.stringify(invalid),before);
  const query=structuredClone(await readServiceSchemaUpstream('aws-iam'));
  const queryEntry=Object.entries(awsQueryContracts().operations).find(([,c])=>c.catalog==='aws-iam');assert.ok(queryEntry);
  const c=queryEntry[1],queryItem=query.paths[c.path],operation=queryItem[c.method.toLowerCase()];
  delete query.components.schemas;delete queryItem.parameters;delete operation.parameters;delete operation.requestBody;bindAwsQuery(query);
  assert.deepEqual(operation['x-upstream-aws-query-contract'].parameters,[]);
  assert.deepEqual(operation['x-upstream-aws-query-contract'].pathParameters,[]);assert.equal(operation['x-upstream-aws-query-contract'].requestBody,null);
  assert.equal(operation['x-operations-aws-query'],'aws-query-v1');assert.ok(Object.keys(query.components.schemas).some(name=>name.startsWith('OperationsAwsQuery_')));
  const invalidQuery=structuredClone(await readServiceSchemaUpstream('aws-iam'));
  invalidQuery.components.securitySchemes.hmac.type='http';const queryBefore=JSON.stringify(invalidQuery);
  assert.throws(()=>bindAwsQuery(invalidQuery),{message:'AWS Query requires the pinned native and SDK contracts (IAM declaration).'});
  assert.equal(JSON.stringify(invalidQuery),queryBefore);
});

Then('REST native route corrections retain signer and body provenance while removing orphaned native paths',async()=>{
  const pack=structuredClone(rest.awsRestContracts()),document=structuredClone(await readServiceSchemaUpstream('aws-sesv2'));
  const contacts=pack.operations['aws-sesv2:ListContacts'],contactOperation=document.paths[contacts.nativePath][contacts.nativeMethod.toLowerCase()];
  contactOperation.parameters=[...(contactOperation.parameters??[]),{name:'Authorization',in:'header',schema:{type:'string'}},
    {name:'Filter',in:'query',required:false,schema:{type:'object'}}];
  const originalParameters=structuredClone(contactOperation.parameters),originalBody=structuredClone(contactOperation.requestBody);
  const jobs=pack.operations['aws-sesv2:ListImportJobs'],originalPath=jobs.nativePath,native=document.paths[originalPath].get;
  delete document.paths[originalPath].get;jobs.nativePath='/unit-native-import-jobs';document.paths[jobs.nativePath]={get:native};delete native.parameters;
  try{
    vi.doMock('./lib/aws-rest.ts',()=>({...rest,awsRestContracts:()=>pack}));
    const {bindAwsRest}=await import('./lib/aws-rest-bindings.ts?aws-native-route-residual');bindAwsRest(document);
    assert.equal(document.paths[jobs.nativePath],undefined);assert.ok(document.paths[jobs.path].post);
    assert.deepEqual(contactOperation['x-upstream-aws-rest-parameters'],originalParameters);
    assert.deepEqual(contactOperation['x-upstream-aws-rest-body'],originalBody);
    assert.ok(!contactOperation.parameters.some(parameter=>parameter.name==='Authorization'||parameter.name==='Filter'));
    assert.deepEqual(native['x-upstream-aws-rest-parameters'],[]);
  }finally{vi.doUnmock('./lib/aws-rest.ts');}
});

Then('isolated REST XML native bindings retain aliases and reject incomplete body declarations',{timeout:60000},async()=>{
  const raw=await readServiceSchemaUpstream('aws-s3');let current;
  try{
    vi.doMock('./lib/aws-rest.ts',()=>({...rest,awsRestContracts:()=>current}));
    const {bindAwsRest}=await import('./lib/aws-rest-bindings.ts?aws-native-xml-residual');
    for(const variant of ['aliases','metadata-only','empty-input','missing-media','missing-response','empty-events','empty-event-member','unknown-parameter']){
      current=structuredClone(rest.awsRestContracts());const source=current.sources['aws-s3'],c=current.operations['aws-s3:CopyObject'];
      const document=structuredClone(raw),operation=document.paths[c.nativePath][c.nativeMethod.toLowerCase()];delete document.paths[c.nativePath];
      c.nativePath=c.path='/unit-'+variant;c.wirePath=c.path;c.input='UnitInput';delete c.inputTraits;delete c.outputTraits;
      document.paths[c.nativePath]={[c.nativeMethod.toLowerCase()]:operation};delete operation.parameters;delete operation.requestBody;
      source.shapes.UnitInput={type:'structure'};
      if(variant==='aliases'){
        source.shapes.UnitInput={type:'structure',required:['Alias'],members:{Alias:{type:'string',locationName:'wireAlias'},Unrequired:{type:'string'},
          Meta:{type:'map',location:'headers',key:{type:'string'},value:{type:'string'}},Header:{type:'string',location:'header',locationName:'x-unit'}}};
        operation.parameters=[{name:'x-unit',in:'header',content:{'application/json':{schema:{type:'string'}}}}];
        operation.requestBody={content:{'application/json':{schema:{type:'object',properties:{wireAlias:{type:'string'},Unrequired:{type:'string'},
          Meta:{type:'object',additionalProperties:{type:'string'}}},required:['wireAlias','Unrequired','Meta']}}}};
      }else if(variant==='metadata-only'){
        source.shapes.UnitInput={type:'structure',members:{Meta:{type:'map',location:'headers',key:{type:'string'},value:{type:'string'}}}};
        operation.requestBody={content:{'application/json':{schema:{type:'object',properties:{Meta:{type:'object',additionalProperties:{type:'string'}}}}}}};
      }else if(variant==='empty-input')operation.requestBody={content:{'application/json':{schema:{type:'object',properties:{}}}}};
      else if(variant==='missing-media')operation.requestBody={};
      else if(variant==='unknown-parameter')operation.parameters=[{name:'Unreviewed',in:'query',schema:{type:'string'}}];
      else{
        const events=variant!=='missing-response';source.shapes.UnitPayload=events?{type:'structure',eventstream:true,
          ...(variant==='empty-event-member'?{members:{End:{shape:'UnitInput'}}}:{})}:{type:'blob'};
        source.shapes.UnitOutput={type:'structure',payload:'Payload',members:{Payload:{shape:'UnitPayload'}}};c.output='UnitOutput';
        if(events)operation.responses={'200':{description:'Event result',content:{'application/json':{schema:{type:'object',properties:{Payload:{type:'object',properties:
          variant==='empty-event-member'?{End:{type:'object',properties:{}}}:{}}}}}}}};
        else delete operation.responses;
      }
      if(['missing-media','unknown-parameter'].includes(variant)){assert.throws(()=>bindAwsRest(document),/reviewed native source and SDK wire contract/);continue;}
      bindAwsRest(document);assert.equal(operation['x-operations-aws-signing'],'aws-rest-v1');
      if(variant==='aliases'){
        const schema=operation.requestBody.content['application/json'].schema;
        assert.deepEqual(schema.required,['wireAlias']);assert.equal(schema.properties.Meta,undefined);
        assert.equal(operation.parameters.find(value=>value.name==='Meta').schema.type,'string');
        assert.ok(operation.parameters.find(value=>value.name==='x-unit').content['application/json']);
      }else if(variant==='metadata-only'){
        assert.deepEqual(operation['x-upstream-aws-rest-parameters'],[]);assert.equal(operation.requestBody,undefined);
        assert.deepEqual(operation.parameters.map(({name,schema})=>({name,schema})),[{name:'Meta',schema:{type:'string',maxLength:65536}}]);
      }else if(variant==='empty-input')assert.equal(operation.requestBody,undefined);
      else if(variant==='missing-response')assert.equal(operation.responses,undefined);
      else assert.equal(operation.responses['200'].content['application/json'].schema.properties.Payload.type,'array');
    }
  }finally{vi.doUnmock('./lib/aws-rest.ts');}
});
