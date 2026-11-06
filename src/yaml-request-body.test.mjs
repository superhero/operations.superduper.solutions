// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { parse as parseYaml } from 'yaml';
import { Then } from '@cucumber/cucumber';
import { extractOperations } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { isYamlRequestMediaType } from './lib/request-media.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

function fixture(media, schema) {
  return {openapi:'3.0.3',info:{title:'YAML',version:'1'},servers:[{url:'https://example.test'}],paths:{'/manifest':{post:{
    operationId:'manifest',summary:'Manifest',requestBody:{required:true,content:{[media]:{schema}}},responses:{200:{description:'Success'}}}}}};
}
const models=document=>[extractOperations(document,'yaml')[0],inspectServiceSchema(document,'yaml').operations[0]];
const sample={name:'yes',note:'λ: β\n# comment\n*alias',values:['null','2026-11-06','on'],enabled:false,count:12,empty:null};
const objectSchema={type:'object',properties:{name:{type:'string',enum:['yes']},note:{type:'string'},values:{type:'array',items:{type:'string'}},
  enabled:{type:'boolean'},count:{type:'integer'},empty:{type:'object',nullable:true,additionalProperties:true}},required:['name'],additionalProperties:false};
Then('both YAML body parsers preserve logical values through an independent YAML decoder',()=>{
  for(const media of ['application/x-yaml','application/yaml','text/yaml','text/x-yaml','Application/YAML']) {
    assert.equal(isYamlRequestMediaType(media),true);
    for(const [schema,expected,values] of [
      [objectSchema,sample,Object.fromEntries(Object.entries(sample).map(([k,v])=>['body:'+k,typeof v==='string'?v:JSON.stringify(v)]))],
      [{type:'array',items:{type:'string'}},sample.values,{'body:$':JSON.stringify(sample.values)}],
      [{type:'string'},sample.note,{'body:$':sample.note}]
    ]) for(const operation of models(fixture(media,schema))) {
      assert.equal(operation.unavailableReason,undefined);
      const request=prepareRequest(operation,values);assert.equal(request.contentType,media);
      assert.deepEqual(parseYaml(requestBody(request)),expected);
    }
  }
});
Then('YAML bodies retain schema validation and reject binary or unknown media encodings',()=>{
  for(const media of ['application/yaml-seq','application/*+yaml',' application/yaml','application/yaml; charset=utf-16','application/yaml\n']) {
    assert.equal(isYamlRequestMediaType(media),false,media);const document=fixture(media,objectSchema);
    assert.ok(inspectServiceSchema(document,'yaml').operations[0].unavailableReason,media);assert.throws(()=>extractOperations(document,'yaml'));
  }
  const binary=fixture('application/yaml',{type:'string',format:'binary'});
  for(const operation of models(binary)) {
    assert.deepEqual(operation.binaryMediaTypes,['application/yaml']);
    assert.throws(()=>prepareRequest(operation,{'body:$':'plain text'}),InputValidationError);
  }
  const nested=fixture('application/yaml',{type:'object',properties:{file:{type:'string',format:'binary'}}});
  assert.throws(()=>extractOperations(nested,'yaml'));
  assert.ok(inspectServiceSchema(nested,'yaml').operations[0].unavailableReason);
  for(const operation of models(fixture('application/yaml',objectSchema))) {
    assert.throws(()=>prepareRequest(operation,{}),InputValidationError);
    assert.throws(()=>prepareRequest(operation,{'body:name':'no'}),InputValidationError);
  }
  const encoding=fixture('application/yaml',objectSchema);encoding.paths['/manifest'].post.requestBody.content['application/yaml'].encoding={name:{contentType:'text/plain'}};
  assert.throws(()=>extractOperations(encoding,'yaml'),/encoding/);
  assert.ok(inspectServiceSchema(encoding,'yaml').operations[0].unavailableReason);
});
Then('the native YAML policy operation preserves its source and sends the exact typed manifest privately',async()=>{
  const id='digitalocean:harness_validate_session_policy',document=await readServiceSchema('digitalocean'),native=await readServiceSchemaUpstream('digitalocean');
  const operation=inspectServiceSchema(document,'digitalocean',new Set([id])).operations[0],source=document.paths[operation.path].post;
  assert.equal(operation.unavailableReason,undefined);assert.equal(operation.bodyMediaType,'application/x-yaml');
  assert.deepEqual(source.requestBody,native.paths[operation.path].post.requestBody);
  assert.equal(operation.id,'digitalocean:'+source.operationId);
  const origin=operationServerUrl(document,operation),descriptor=await approvedOperation(operation,origin),token='yaml-private-key-9913';
  const records=[{id:'yaml-token',label:'YAML token',kind:'secret',value:token,grants:[]}];
  const binding={alternative:0,fingerprint:descriptor.fingerprint,credentials:{[operation.security[0][0].name]:'yaml-token'}};
  const manifest={metadata:{name:'yaml-fixture'},spec:{runtime:{adapter:'codex'}}};let calls=0;
  const result=await executeCredentialed(descriptor,Object.fromEntries(Object.entries(manifest).map(([k,v])=>['body:'+k,JSON.stringify(v)])),binding,records,
    {assertCurrent(){},async fetchRequest(address,init){calls++;assert.equal(address,'https://api.digitalocean.com/v2/agents/sessions/policy/validate');
      assert.equal(new Headers(init.headers).get('Authorization'),'Bearer '+token);assert.equal(new Headers(init.headers).get('Content-Type'),'application/x-yaml');
      assert.deepEqual(parseYaml(init.body),manifest);return Response.json({valid:true,echo:token});}});
  assert.equal(calls,1);assert.equal(JSON.stringify(result).includes(token),false);
  const changed={...operation,bodyMediaType:'application/json'},other=await approvedOperation(changed,origin);assert.notEqual(other.fingerprint,descriptor.fingerprint);
  await assert.rejects(executeCredentialed(other,{'body:metadata':'{}'},binding,records,{assertCurrent(){}}),error=>error.code==='PERMISSION');
});
