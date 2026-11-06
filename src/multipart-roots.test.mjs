// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import ids from '../tests/multipart-root-operations.json' with {type:'json'};
import data from './lib/multipart-root-contracts.json' with {type:'json'};
import { bindMultipartRoots } from './lib/multipart-root-contracts.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperations } from './lib/catalog.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { encodeWorkflowBinary, maxWorkflowUploadBytes } from './lib/workflow-binary.ts';
import { requestBody } from './lib/request-body.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
const selected=new Set(ids), verbs=new Set(['get','post','put','patch','delete','head','options','trace']);
const bytes=new Uint8Array([0,255,128,10,13,34,65]), file=encodeWorkflowBinary('module.js',bytes,'application/javascript');
const native=(document,c)=>document.paths[c.path][c.method.toLowerCase()];
function scope(document,catalog) {
 const copy=structuredClone(document);for(const [path,item]of Object.entries(copy.paths)) {
  for(const method of Object.keys(item))if(verbs.has(method)&&!selected.has(catalog+':'+item[method].operationId))delete item[method];
  if(!Object.keys(item).some(method=>verbs.has(method)))delete copy.paths[path];
 }return copy;
}
function inputs(operation) {
 const result={};for(const field of operation.fields)if(field.required&&field.location!=='body')result[field.key]=field.name==='X-Atlassian-Token'?'no-check':field.name==='zone_id'?'a'.repeat(32):'7';
 if(operation.id==='cloudflare:updateZoneSnippet'){result['body:metadata']='{"main_module":"module.js"}';result['body:files']=JSON.stringify([file,file]);}
 else if(operation.id.startsWith('groq:')){result['body:model']='whisper-large-v3-turbo';result['body:file']=JSON.stringify(file);}
 else if(operation.id.startsWith('mistral:')){result['body:model']='voxtral-mini-latest';result['body:file']=JSON.stringify(file);}
 else if(operation.path.includes('/avatar/'))result['body:avatar']=JSON.stringify(file);
 else result['body:file']=JSON.stringify(operation.bodySchema.properties.file.type==='array'?[file,file]:file);
 return result;
}
async function authority(operation) {
 const descriptor=await approvedOperation(operation,'https://multipart-roots.synthetic.example.test/base');
 const alternative=operation.security.findIndex(option=>option.length&&option.every(scheme=>['basic','bearer','apiKey'].includes(scheme.kind)));assert.ok(alternative>=0,operation.id);
 const records=[],credentials={};for(const scheme of operation.security[alternative]) {
  const secret=()=>{const record={id:crypto.randomUUID(),label:'Root fixture',kind:'secret',value:'synthetic-root-token-'+records.length+'-971',grants:[]};records.push(record);return record.id;};
  credentials[scheme.name]=scheme.kind==='basic'?{username:secret(),password:secret()}:secret();
 }return {descriptor,records,binding:{alternative,credentials,fingerprint:descriptor.fingerprint}};
}
async function allModels() {
 const models=[];for(const catalog of [...new Set(ids.map(id=>id.split(':')[0]))]) {
  const document=await readServiceSchema(catalog),canonical=inspectServiceSchema(document,catalog,selected).operations,imported=scope(document,catalog);
  // The service adapter accepts native OAuth2 scopes. The strict importer takes
  // bearer definitions, so normalize only its view for the request-codec parity
  // check; private execution below always uses the complete canonical model.
  const oauth=new Set(Object.entries(imported.components?.securitySchemes??{}).filter(([,scheme])=>scheme.type==='oauth2').map(([name])=>name));
  for(const name of oauth)imported.components.securitySchemes[name]={type:'http',scheme:'bearer'};
  for(const item of Object.values(imported.paths))for(const method of verbs)if(item[method]?.security)item[method].security=item[method].security.map(option=>Object.fromEntries(Object.entries(option).map(([name,scopes])=>[name,oauth.has(name)?[]:scopes])));
  if(imported.security)imported.security=imported.security.map(option=>Object.fromEntries(Object.entries(option).map(([name,scopes])=>[name,oauth.has(name)?[]:scopes])));
  const strict=extractOperations(imported,catalog);assert.equal(canonical.length,strict.length);
  for(const operation of canonical){assert.equal(operation.unavailableReason,undefined,operation.id);models.push({operation,strict:strict.find(x=>x.id===operation.id)});}
 }assert.equal(models.length,12);return models;
}
Then('the nine multipart root corrections are reversible without changing shared schemas',async()=>{
 let count=0;for(const catalog of Object.keys(data.sources)) {
  const before=await readServiceSchemaUpstream(catalog),document=structuredClone(before);bindMultipartRoots(document);assert.deepEqual(document.components,before.components);assert.deepEqual(document.servers,before.servers);
  for(const [id,c]of Object.entries(data.operations))if(c.catalog===catalog) {
   count++;const operation=native(document,c),original=native(before,c),saved=operation['x-upstream-multipart-root'];assert.equal(operation.operationId,original.operationId,id);assert.deepEqual(operation.responses,original.responses);assert.deepEqual(operation.security,original.security??[{basic:[]}]);assert.deepEqual(saved,{requestBody:original.requestBody,parameters:original.parameters??null,security:original.security??null});
   operation.requestBody=saved.requestBody;if(saved.parameters===null)delete operation.parameters;else operation.parameters=saved.parameters;if(saved.security===null)delete operation.security;else operation.security=saved.security;delete operation['x-upstream-multipart-root'];
  }assert.deepEqual(document,before);
 }assert.equal(count,9);
});
Then('changed multipart root declarations cannot be applied partially',async()=>{
 for(const catalog of Object.keys(data.sources)) {
  const source=await readServiceSchemaUpstream(catalog),contract=Object.values(data.operations).filter(x=>x.catalog===catalog).at(-1);
  for(const change of [document=>document.info.version+='changed',document=>delete document.paths[contract.path],document=>native(document,contract).requestBody={content:{}},document=>native(document,contract)['x-upstream-multipart-root']={},document=>native(document,contract).parameters=[{name:'X-Atlassian-Token',in:'header'}]]) {
   const document=structuredClone(source);change(document);const before=JSON.stringify(document);assert.throws(()=>bindMultipartRoots(document),/reviewed native contract/);assert.equal(JSON.stringify(document),before);
  }bindMultipartRoots(source);assert.throws(()=>bindMultipartRoots(source),/reviewed native contract/);
 }
});
function choiceFixture() {
 const schema={type:'object',properties:{file:{type:'string',format:'binary'},url:{type:'string',minLength:3},model:{type:'string',minLength:2}},required:['model'],additionalProperties:false,oneOf:[{required:['file']},{required:['url']}]};
 return {openapi:'3.1.0',info:{title:'Choices',version:'1'},servers:[{url:'https://choices.example.test'}],paths:{'/upload':{post:{operationId:'upload',responses:{200:{description:'ok'}},requestBody:{required:true,content:{'multipart/form-data':{schema}}}}}}};
}
Then('multipart file or URL choices retain exclusivity constraints and definition references',()=>{
 const source=choiceFixture();for(const operation of [extractOperations(source,'choice')[0],inspectServiceSchema(source,'choice').operations[0]]) {
  assert.equal(operation.unavailableReason,undefined);assert.deepEqual(operation.bodySchema.requiredOneOf,[['file'],['url']]);
  assert.ok(requestBody(prepareRequest(operation,{'body:model':'ab','body:file':JSON.stringify(file)})).get('file'));
  assert.equal(requestBody(prepareRequest(operation,{'body:model':'ab','body:url':'https://audio.example.test/file'})).get('url'),'https://audio.example.test/file');
  for(const input of [{'body:model':'ab'},{'body:model':'ab','body:file':JSON.stringify(file),'body:url':'https://audio.example.test/file'},{'body:model':'ab','body:url':'x'},{'body:model':'a','body:url':'abc'}])assert.throws(()=>prepareRequest(operation,input),InputValidationError);
 }
 const constrained=choiceFixture();constrained.paths['/upload'].post.requestBody.content['multipart/form-data'].schema.oneOf[0].additionalProperties=false;assert.throws(()=>extractOperations(constrained,'choice'),/Form body/);assert.ok(inspectServiceSchema(constrained,'choice').operations[0].unavailableReason);
 const defined=choiceFixture(),shape=defined.paths['/upload'].post.requestBody.content['multipart/form-data'].schema;delete shape.oneOf;shape.$defs={unused:{type:'integer'}};shape.properties.file={$ref:'#/components/schemas/Upload'};defined.components={schemas:{Upload:{type:'string',format:'binary'}}};for(const operation of [extractOperations(defined,'choice')[0],inspectServiceSchema(defined,'choice').operations[0]])assert.equal(operation.bodySchema.properties.file.format,'binary');
});
Then('twelve native multipart root operations preserve file bytes and private authorization',async()=>{
 let calls=0;for(const {operation,strict}of await allModels()) {
  const input=inputs(operation),request=prepareRequest(operation,input);assert.deepEqual(request,prepareRequest(strict,input));const a=await authority(operation);let failure;
  const result=await executeCredentialed(a.descriptor,input,a.binding,a.records,{assertCurrent(){},async fetchRequest(url,init){calls++;try {
   const headers=new Headers(init.headers);assert.equal(headers.get('Content-Type'),null);assert.equal(String(url),'https://multipart-roots.synthetic.example.test/base'+request.path);assert.ok(headers.has('Authorization')||headers.has('X-Auth-Key'));
   if(operation.id.startsWith('jira'))assert.equal(headers.get('X-Atlassian-Token'),'no-check');
   const wire=new Request(String(url),init);assert.match(wire.headers.get('Content-Type'),/multipart\/form-data; boundary=/);const form=await wire.formData();const part=operation.id.startsWith('cloudflare:')?'files':operation.path.includes('/avatar/')?'avatar':'file',files=form.getAll(part);assert.equal(files.length,Array.isArray(request.body[part])?2:1);
   for(const uploaded of files){assert.equal(uploaded.name,file.name);assert.equal(uploaded.type,file.mediaType);assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()),bytes);}if(operation.id.startsWith('cloudflare:'))assert.equal(await form.get('metadata').text(),'{"main_module":"module.js"}');
   if(operation.id.startsWith('groq:'))assert.deepEqual(operation.bodySchema.requiredOneOf,[['file'],['url']]);if(operation.id.startsWith('mistral:'))assert.deepEqual(operation.bodySchema.properties.stream.enum,[false]);
  }catch(error){failure=error;}return Response.json({accepted:true});}});if(failure)throw failure;for(const record of a.records)assert.equal(JSON.stringify(result).includes(record.value),false);
 }assert.equal(calls,12);
});
Then('malformed files for the twelve multipart root operations fail before transport',async()=>{
 for(const {operation}of await allModels()) {
  const input=inputs(operation),key=operation.id.startsWith('cloudflare:')?'body:files':operation.path.includes('/avatar/')?'body:avatar':'body:file',a=await authority(operation),array=operation.bodySchema.properties[key.slice(5)].type==='array';
  for(const invalid of [{}, {...file,size:file.size+1},{...file,size:maxWorkflowUploadBytes+1}]) {
   const values={...input,[key]:JSON.stringify(array?[invalid]:invalid)};assert.throws(()=>prepareRequest(operation,values),InputValidationError);let calls=0;await assert.rejects(()=>executeCredentialed(a.descriptor,values,a.binding,a.records,{assertCurrent(){},async fetchRequest(){calls++;return Response.json({});}}));assert.equal(calls,0);
  }if(array)assert.throws(()=>prepareRequest(operation,{...input,[key]:'[]'}),InputValidationError);
 }
});
Then('a changed multipart required-field choice cannot reuse an earlier credential binding',async()=>{
 const source=choiceFixture();source.components={securitySchemes:{Token:{type:'http',scheme:'bearer'}}};source.security=[{Token:[]}];
 const operation=inspectServiceSchema(source,'choice').operations[0],a=await authority(operation),changed=structuredClone(operation);
 changed.bodySchema.requiredOneOf=[['file'],['model']];const descriptor=await approvedOperation(changed,a.descriptor.origin);assert.notEqual(descriptor.fingerprint,a.descriptor.fingerprint);
 let calls=0;await assert.rejects(()=>executeCredentialed(descriptor,{'body:model':'ab','body:url':'abc'},a.binding,a.records,{assertCurrent(){},async fetchRequest(){calls++;return Response.json({});}}),error=>error.code==='PERMISSION');assert.equal(calls,0);
});
