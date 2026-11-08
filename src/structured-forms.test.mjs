// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import data from './lib/structured-form-contracts.json' with {type:'json'};
import ids from '../tests/structured-form-operations.json' with {type:'json'};
import { bindStructuredForms } from './lib/structured-form-contracts.ts';
import { readServiceSchema,readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperations } from './lib/catalog.ts';
import { gitlabJsonFormProfile,configureGitlabJsonForm,useGitlabJsonBody } from './lib/gitlab-form.ts';
import { encodeWorkflowBinary,maxWorkflowUploadBytes } from './lib/workflow-binary.ts';
import { prepareRequest,InputValidationError } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { vaultVariablePlaceholder } from './lib/secrets/variables.ts';
const selected=new Set(ids),bytes=new Uint8Array([0,255,128,10,13,65]),file=encodeWorkflowBinary('fixture.png',bytes,'image/png');
const native=(document,c)=>document.paths[c.path][c.method.toLowerCase()];
Then('thirteen structured form corrections retain fields schemas identities and reversible preimages',async()=>{
 let count=0;for(const catalog of Object.keys(data.sources)) {
  const source=await readServiceSchemaUpstream(catalog),document=structuredClone(source);bindStructuredForms(document);assert.deepEqual(document.components,source.components);assert.deepEqual(document.servers,source.servers);
  for(const [id,c]of Object.entries(data.operations))if(c.catalog===catalog){count++;const operation=native(document,c),before=native(source,c);assert.equal(operation.operationId,before.operationId,id);assert.deepEqual(operation.parameters,before.parameters);assert.deepEqual(operation.security,before.security);assert.deepEqual(operation.responses,before.responses);assert.deepEqual(operation['x-upstream-structured-form'],before.requestBody);
   if(c.mode==='json')assert.ok(operation.requestBody.content['application/json']);operation.requestBody=operation['x-upstream-structured-form'];delete operation['x-upstream-structured-form'];delete operation['x-operations-gitlab-form'];
  }assert.deepEqual(document,source);
 }assert.equal(count,13);assert.equal(new Set(ids).size,13);
});
Then('changed structured form contracts fail before any request is rewritten',async()=>{
 for(const catalog of Object.keys(data.sources)) {
  const source=await readServiceSchemaUpstream(catalog),c=Object.values(data.operations).filter(c=>c.catalog===catalog).at(-1);
  for(const change of [d=>d.info.version+='changed',d=>delete d.paths[c.path],d=>native(d,c).requestBody={content:{}},d=>native(d,c)['x-upstream-structured-form']={},d=>native(d,c)['x-operations-gitlab-form']=gitlabJsonFormProfile]) {
   const document=structuredClone(source);change(document);const before=JSON.stringify(document);assert.throws(()=>bindStructuredForms(document),/reviewed native contract/);assert.equal(JSON.stringify(document),before);
  }bindStructuredForms(source);assert.throws(()=>bindStructuredForms(source),/reviewed native contract/);
 }
});
function rackFixture() {
 const schema={type:'object',additionalProperties:false,properties:{records:{type:'array',minItems:1,items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},enabled:{type:'boolean'},avatar:{type:'string',format:'binary'}}}}}};
 return {openapi:'3.1.0',info:{title:'Rack',version:'1'},servers:[{url:'https://rack.example.test'}],paths:{'/rack':{post:{operationId:'rack',responses:{200:{description:'ok'}},requestBody:{required:true,content:{'multipart/form-data':{schema,encoding:{records:{'x-operations-form-style':'rack'}}}}}}}}};
}
Then('Rack form parts preserve indexed objects nested binary bytes and field boundaries',async()=>{
 const source=rackFixture();for(const operation of [extractOperations(source,'rack')[0],inspectServiceSchema(source,'rack').operations[0]]) {
  assert.equal(operation.unavailableReason,undefined);assert.deepEqual(operation.multipartParts.records.binaryPaths,[[-1,'avatar']]);const input={'body:records':JSON.stringify([{name:'one',avatar:file},{enabled:false}])},prepared=prepareRequest(operation,input),form=await new Request('https://rack.example.test',{method:'POST',body:requestBody(prepared)}).formData();assert.equal(form.get('records[0][name]'),'one');assert.equal(form.get('records[1][enabled]'),'false');assert.equal(form.has('records[][name]'),false);assert.deepEqual(new Uint8Array(await form.get('records[0][avatar]').arrayBuffer()),bytes);
  for(const value of [[],[null],[{}],[{name:null}],[{avatar:{}}]])assert.throws(()=>prepareRequest(operation,{'body:records':JSON.stringify(value)}),InputValidationError);
  const forged=structuredClone(operation);forged.multipartParts.records.binaryPaths=[[-1,'name']];assert.throws(()=>prepareRequest(forged,input),/part representation/);
 }
});
let nativePromise;
function nativeModels(){return nativePromise??=(async()=>{const result=[];for(const catalog of Object.keys(data.sources)){const document=await readServiceSchema(catalog);for(const operation of inspectServiceSchema(document,catalog,selected).operations){assert.equal(operation.unavailableReason,undefined,operation.id);result.push(operation);}}assert.equal(result.length,13);return result;})();}
function values(operation,files=true) {
 const input={};for(const field of operation.fields)if(field.required){input[field.key]=field.format==='binary'?JSON.stringify(file):field.name==='account_id'?'a'.repeat(32):field.name==='id'||field.name==='user_id'?'7':field.name==='purpose'?'assistants':field.type==='object'?'{}':field.type==='array'?'[]':'fixture';}
 if(operation.id.startsWith('cloudflare:')){input['body:metadata']='{"reference":"fixture","nested":{"ok":true}}';if(operation.id.includes('upload-an-image'))input['body:url']='https://assets.example.test/image.png';}
 if(operation.id==='replicate:files.create'){input['body:metadata']='{"reference":"fixture"}';input['body:content']=JSON.stringify(file);}
 if(operation.id==='openai:createFile')input['body:expires_after']='{"anchor":"created_at","seconds":3600}';
 if(operation.id==='gitlab:postApiV4BulkImports'){input['body:configuration']='{"url":"https://source.example.test","access_token":"fixture-source-token"}';input['body:entities']='[{"source_type":"group_entity","source_full_path":"source/group","destination_namespace":"destination","destination_slug":"group"}]';}
 if(operation.bodyEncoding){
  if(operation.bodySchema.properties.default_branch_protection_defaults){input['body:default_branch_protection_defaults']='{"allowed_to_push":[{"access_level":40}],"allow_force_push":false}';input['body:foundational_agents_statuses']='[{"reference":"one","enabled":true},{"reference":"two","enabled":false}]';input['body:ai_settings_attributes']='{"prompt_injection_protection_level":"log_only"}';}
  if(operation.bodySchema.properties.container_expiration_policy_attributes){input['body:container_expiration_policy_attributes']='{"cadence":"7d","keep_n":5,"enabled":false}';input['body:topics']='["one","two"]';}
  if(operation.bodySchema.properties.override_params){input['body:override_params']=JSON.stringify({description:'Fixture',...(files?{avatar:file}:{}),topics:['one','two']});}
  if(files&&operation.fields.some(f=>f.key==='body:avatar'))input['body:avatar']=JSON.stringify(file);
  if(!files)for(const field of operation.fields.filter(f=>f.format==='binary'))delete input[field.key];
 }
 return input;
}
async function authority(operation) {
 const descriptor=await approvedOperation(operation,'https://structured.synthetic.example.test'),alternative=operation.security.findIndex(option=>option.length&&option.every(s=>['basic','bearer','apiKey'].includes(s.kind)));assert.ok(alternative>=0,operation.id);const records=[],credentials={};for(const scheme of operation.security[alternative]){const secret=()=>{const r={id:crypto.randomUUID(),label:'Structured fixture',kind:'secret',value:'structured-private-token-'+records.length+'-971',grants:[]};records.push(r);return r.id;};credentials[scheme.name]=scheme.kind==='basic'?{username:secret(),password:secret()}:secret();}return{descriptor,records,binding:{alternative,credentials,fingerprint:descriptor.fingerprint}};
}
Then('GitLab forms select JSON without files and retain nullable and empty values',async()=>{
 for(const operation of (await nativeModels()).filter(o=>o.bodyEncoding)) {
  const input=values(operation,false);if(operation.bodySchema.required?.includes('file')){assert.throws(()=>prepareRequest(operation,input),InputValidationError);continue;}
  const key=operation.bodySchema.properties.override_params?'override_params':operation.bodySchema.properties.default_branch_protection_defaults?'default_branch_protection_defaults':'container_expiration_policy_attributes';input['body:'+key]='null';if(operation.bodySchema.properties.topics)input['body:topics']='[]';
  const prepared=prepareRequest(operation,input);assert.equal(prepared.contentType,undefined,operation.id);assert.equal(prepared.multipartParts,undefined);const encoded=JSON.parse(requestBody(prepared));assert.equal(encoded[key],null);if(operation.bodySchema.properties.topics)assert.deepEqual(encoded.topics,[]);
 }
});
Then('thirteen native structured operations send validated bodies and private credentials',async()=>{
 let calls=0;for(const operation of await nativeModels()){const input=values(operation),prepared=prepareRequest(operation,input),a=await authority(operation);let failure;const result=await executeCredentialed(a.descriptor,input,a.binding,a.records,{assertCurrent(){},async fetchRequest(url,init){calls++;try {
  const headers=new Headers(init.headers);assert.ok(headers.has('Authorization')||headers.has('PRIVATE-TOKEN'));if(prepared.contentType==='multipart/form-data'){
   assert.equal(headers.get('Content-Type'),null);const form=await new Request(String(url),init).formData();
   for(const field of operation.fields.filter(f=>f.format==='binary'&&input[f.key]))assert.deepEqual(new Uint8Array(await form.get(field.name).arrayBuffer()),bytes);
   if(operation.id.startsWith('cloudflare:')||operation.id.startsWith('replicate:')){assert.equal(typeof form.get('metadata'),'string');assert.equal(JSON.parse(form.get('metadata')).reference,'fixture');}
   if(operation.id==='openai:createFile'){assert.equal(form.get('expires_after[anchor]'),'created_at');assert.equal(form.get('expires_after[seconds]'),'3600');}
   if(operation.bodyEncoding){if(input['body:override_params']){assert.equal(form.get('override_params[description]'),'Fixture');assert.deepEqual(new Uint8Array(await form.get('override_params[avatar]').arrayBuffer()),bytes);}if(input['body:foundational_agents_statuses']){assert.equal(form.get('foundational_agents_statuses[0][reference]'),'one');assert.equal(form.get('foundational_agents_statuses[1][enabled]'),'false');assert.equal(form.get('default_branch_protection_defaults[allowed_to_push][0][access_level]'),'40');}if(input['body:topics'])assert.deepEqual(form.getAll('topics[]'),['one','two']);}
  }else{assert.equal(headers.get('Content-Type'),'application/json');assert.deepEqual(JSON.parse(String(init.body)),prepared.body);assert.equal(JSON.parse(String(init.body)).entities[0].source_type,'group_entity');}
 }catch(error){failure=error;}return Response.json({accepted:true});}}).catch(error=>{throw new Error(operation.id+': '+error.message,{cause:error});});if(failure)throw failure;for(const record of a.records)assert.equal(JSON.stringify(result).includes(record.value),false);
 }assert.equal(calls,13);
});
Then('malformed structured fields and files cannot reach a private HTTP endpoint',async()=>{
 for(const operation of await nativeModels()){const input=values(operation),a=await authority(operation),cases=[];for(const field of operation.fields.filter(f=>f.format==='binary'))for(const bad of [{},{...file,size:file.size+1},{...file,size:maxWorkflowUploadBytes+1}])cases.push({...input,[field.key]:JSON.stringify(bad)});
  if(operation.id.startsWith('cloudflare:')||operation.id.startsWith('replicate:'))cases.push({...input,'body:metadata':'[]'});
  if(operation.id==='openai:createFile')for(const seconds of [3599,2592001])cases.push({...input,'body:expires_after':JSON.stringify({anchor:'created_at',seconds})});
  if(operation.bodyEncoding){if(input['body:override_params'])cases.push({...input,'body:override_params':JSON.stringify({avatar:{}})});if(input['body:foundational_agents_statuses'])cases.push({...input,'body:foundational_agents_statuses':'[{"reference":"one","enabled":"wrong"}]'});if(input['body:topics'])cases.push({...input,'body:topics':'[]'});}
  if(operation.id==='gitlab:postApiV4BulkImports')cases.push({...input,'body:entities':'[{"source_type":"wrong"}]'});
  for(const value of cases){assert.throws(()=>prepareRequest(operation,value),InputValidationError);let calls=0;await assert.rejects(()=>executeCredentialed(a.descriptor,value,a.binding,a.records,{assertCurrent(){},async fetchRequest(){calls++;return Response.json({});}}));assert.equal(calls,0);}
 }
});
Then('a private source token can populate a GitLab bulk import JSON field without appearing in output',async()=>{
 const operation=(await nativeModels()).find(o=>o.id==='gitlab:postApiV4BulkImports'),input=values(operation),a=await authority(operation),source={id:crypto.randomUUID(),label:'Source token',kind:'secret',value:'private-source-gitlab-token-971',grants:[]};a.records.push(source);input['body:configuration']=JSON.stringify({url:'https://source.example.test',access_token:vaultVariablePlaceholder});let calls=0;
 const result=await executeCredentialed(a.descriptor,input,a.binding,a.records,{variables:[{key:'body:configuration',path:['access_token'],credentialId:source.id}],assertCurrent(){},async fetchRequest(url,init){calls++;assert.equal(JSON.parse(String(init.body)).configuration.access_token,source.value);return Response.json({id:1,status:'created'});}});assert.equal(calls,1);assert.equal(JSON.stringify(result).includes(source.value),false);
});
Then('changed GitLab form profiles and nested file paths invalidate private authority',async()=>{
 const operation=(await nativeModels()).find(o=>o.id==='gitlab:postApiV4ProjectsImport'),a=await authority(operation),changed=structuredClone(operation);delete changed.bodyEncoding;const descriptor=await approvedOperation(changed,a.descriptor.origin);assert.notEqual(descriptor.fingerprint,a.descriptor.fingerprint);let calls=0;await assert.rejects(()=>executeCredentialed(descriptor,values(operation),a.binding,a.records,{assertCurrent(){},async fetchRequest(){calls++;return Response.json({});}}),e=>e.code==='PERMISSION');assert.equal(calls,0);
 const forged=structuredClone(operation);forged.multipartParts.override_params.binaryPaths=[['description']];await assert.rejects(()=>approvedOperation(forged,a.descriptor.origin),e=>e.code==='PERMISSION');const route=structuredClone(operation);route.path='/api/v4/unreviewed';await assert.rejects(()=>approvedOperation(route,a.descriptor.origin),e=>e.code==='PERMISSION');
});

Then('GitLab form selection validates its profile and preserves field schema fallbacks',()=>{
 const field={key:'body:resource',name:'resource',label:'Resource',description:'',location:'body',required:false,type:'object',schema:{type:'object',properties:{attachment:{type:'string',format:'binary'}}}};
 const operation={id:'gitlab:postApiV4Projects',method:'POST',path:'/api/v4/projects',fields:[field],bodyMediaType:'multipart/form-data',bodySchema:{type:'object'}};
 assert.throws(()=>configureGitlabJsonForm({...operation},'future-profile'),/Unknown GitLab request body encoding/);
 assert.throws(()=>configureGitlabJsonForm({...operation,path:'/other'},gitlabJsonFormProfile),/reviewed native route/);
 configureGitlabJsonForm(operation,gitlabJsonFormProfile);
 assert.throws(()=>useGitlabJsonBody({...operation,path:'/other'},{}),/reviewed contract/);
 assert.equal(useGitlabJsonBody(operation,{'body:resource':JSON.stringify({attachment:file})}),false);
 const missingSchema={...operation,fields:[{...field,schema:undefined}]};
 assert.equal(useGitlabJsonBody(missingSchema,{'body:resource':'{"ordinary":"value"}'}),true);
 assert.equal(useGitlabJsonBody(operation,{'body:resource':'{"ordinary":"value"}'}),true);
});
