// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import ids from '../tests/multipart-file-operations.json' with {type:'json'};
import { extractOperations } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { encodeWorkflowBinary } from './lib/workflow-binary.ts';
import { bindMultipartFiles, multipartFileSources } from './lib/multipart-file-contracts.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
const bytes=[new Uint8Array([0,255,1,128]),new TextEncoder().encode('λ\r\nβ')];
const files=[encodeWorkflowBinary('one.bin',bytes[0]),encodeWorkflowBinary('two.txt',bytes[1],'text/plain')];
const binary={type:'string',format:'binary',minLength:1,maxLength:20};
const array={type:'array',minItems:1,maxItems:2,items:binary};
function fixture(items=array,media='multipart/form-data') {
 const schema={type:'object',required:['files'],properties:{files:items,tags:{type:'array',items:{type:'string'}},caption:{type:'string'}}};
 const operation={operationId:'files',summary:'Files',requestBody:{required:true,content:{[media]:{schema}}},responses:{200:{description:'Success'}}};
 return {openapi:'3.0.3',info:{title:'Files',version:'1'},servers:[{url:'https://example.test'}],paths:{'/files':{post:operation}}};
}
const models=document=>[extractOperations(document,'file-array')[0],inspectServiceSchema(document,'file-array').operations[0]];
async function assertFiles(form,name) {
 const parts=form.getAll(name);assert.equal(parts.length,2);
 for(const [index,part] of parts.entries()) {assert.equal(part.name,files[index].name);assert.equal(part.type,files[index].mediaType);assert.deepEqual(new Uint8Array(await part.arrayBuffer()),bytes[index]);}
}
Then('both parsers send repeated multipart files with their names types bytes and ordinary fields',async()=>{
 for(const operation of models(fixture())) {
  assert.equal(operation.unavailableReason,undefined);const request=prepareRequest(operation,{'body:files':JSON.stringify(files),'body:tags':'["a","b"]','body:caption':'λ & β'});
  const form=requestBody(request);await assertFiles(form,'files');assert.deepEqual(form.getAll('tags'),['a','b']);assert.equal(form.get('caption'),'λ & β');
  const encoded=new Request('https://example.test/files',{method:'POST',body:form});assert.match(encoded.headers.get('Content-Type'),/multipart\/form-data; boundary=/);await assertFiles(await encoded.formData(),'files');
 }
});
Then('multipart file arrays reject nullable nested mixed and corrupt files while preserving bounds',()=>{
 for(const schema of [{...array,nullable:true},{...array,items:{...binary,nullable:true}},{type:'array',items:{type:'object',properties:{}}},{type:'array',items:array}]) {
  const document=fixture(schema);assert.throws(()=>extractOperations(document,'file-array'));assert.ok(inspectServiceSchema(document,'file-array').operations[0].unavailableReason);
 }
 const encoded=fixture(array,'application/x-www-form-urlencoded');assert.throws(()=>extractOperations(encoded,'file-array'));assert.ok(inspectServiceSchema(encoded,'file-array').operations[0].unavailableReason);
 for(const operation of models(fixture())) for(const value of [[],[...files,files[0]],[null],['text'],[{}],[{...files[0],base64:'bad'}],[encodeWorkflowBinary('empty.bin',new Uint8Array())],[encodeWorkflowBinary('long.bin',new Uint8Array(21))]])
  assert.throws(()=>prepareRequest(operation,{'body:files':JSON.stringify(value)}),error=>error instanceof InputValidationError && error.fieldKey==='body:files');
 for(const operation of models(fixture({...array,uniqueItems:true})))assert.throws(()=>prepareRequest(operation,{'body:files':JSON.stringify([files[0],files[0]])}),/unique/);
});
Then('multipart provider corrections preserve native provenance and reject drift',async()=>{
 for(const catalog of Object.keys(multipartFileSources)) {
  const native=await readServiceSchemaUpstream(catalog),document=structuredClone(native),paths=structuredClone(native.paths);
  bindMultipartFiles(document);assert.deepEqual(document.paths,paths);assert.deepEqual(document.security,native.security);
  let count=0;for(const [name,schema]of Object.entries(document.components.schemas))if(schema['x-upstream-form-schema']) {count++;assert.deepEqual(schema['x-upstream-form-schema'],native.components.schemas[name]);}
  assert.equal(count,catalog==='anthropic'?4:2);assert.throws(()=>bindMultipartFiles(document),/reviewed/);
  const changed=structuredClone(native);changed.servers[0].url='https://other.example.test';assert.throws(()=>bindMultipartFiles(changed),/reviewed/);
  const drift=structuredClone(native);drift.info.version+='changed';assert.throws(()=>bindMultipartFiles(drift),/reviewed/);
 }
});
function response(operation) {
 const entry=Object.entries(operation.responseContent?.['200']??operation.responseContent?.['201']??{}).find(([,kind])=>kind!=='unsupported'&&kind!=='stream');
 if(entry?.[1]==='binary')return new Response(bytes[0],{headers:{'Content-Type':entry[0]}});
 return Response.json({accepted:true});
}
Then('all ten native file collection operations prepare authenticated multipart requests',async()=>{
 assert.equal(new Set(ids).size,10);let calls=0;
 for(const catalog of new Set(ids.map(id=>id.split(':')[0]))) {
  const document=await readServiceSchema(catalog),operations=inspectServiceSchema(document,catalog,new Set(ids)).operations;
  for(const operation of operations) {
   assert.equal(operation.unavailableReason,undefined,operation.id);assert.equal(operation.bodyMediaType,'multipart/form-data');
   const field=operation.fields.find(field=>field.type==='array'&&field.schema?.items?.format==='binary');assert.ok(field,operation.id);
   const inputs={[field.key]:JSON.stringify(files)};
   for(const input of operation.fields)if(input.required&&input.key!==field.key&&input.defaultValue===undefined)inputs[input.key]=String(input.enum?.find(x=>x!==null)??(input.type==='integer'?1:'fixture-value'));
   if(operation.fields.some(field=>field.key==='body:labels'))inputs['body:labels']='{"language":"en"}';
   const origin=operationServerUrl(document,operation),descriptor=await approvedOperation(operation,origin),records=[],credentials={};
   for(const [index,scheme]of operation.security[0].entries()){const id='file-token-'+index;credentials[scheme.name]=id;records.push({id,label:id,kind:'secret',value:'multipart-private-key-'+index,grants:[]});}
   const binding={alternative:0,fingerprint:descriptor.fingerprint,credentials};
   const result=await executeCredentialed(descriptor,inputs,binding,records,{assertCurrent(){},async fetchRequest(_address,init){calls++;
    assert.ok(init.body instanceof FormData);assert.equal(new Headers(init.headers).get('Content-Type'),null);await assertFiles(init.body,field.name);
    if(catalog==='anthropic')assert.equal(field.name,'files[]');else assert.ok(['files','videos'].includes(field.name));
    if(inputs['body:labels'])assert.deepEqual(JSON.parse(init.body.get('labels')),{language:'en'});
    for(const scheme of operation.security[0])assert.ok(new Headers(init.headers).get(scheme.header));return response(operation);}});
   for(const record of records)assert.equal(JSON.stringify(result).includes(record.value),false);
  }
 }
 assert.equal(calls,10);
});
