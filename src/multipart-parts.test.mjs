// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import ids from '../tests/multipart-part-operations.json' with {type:'json'};
import contracts from './lib/multipart-part-contracts.json' with {type:'json'};
import { bindMultipartParts } from './lib/multipart-part-contracts.ts';
import { extractOperations, updateCatalogs } from './lib/catalog.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { encodeWorkflowBinary } from './lib/workflow-binary.ts';
import { createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { approvedOperation, validateApprovedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const text={type:'string'},binary={type:'string',format:'binary'},bytes=Uint8Array.of(0,255,13,10,128);
const file=encodeWorkflowBinary('module.wasm',bytes,'application/wasm');
const nested='--inner-boundary\r\nContent-Disposition: form-data; name="module.wasm"; filename="module.wasm"\r\nContent-Type: application/wasm\r\n\r\nmodule-bytes\r\n--inner-boundary--\r\n';
const bundle=encodeWorkflowBinary('worker.bundle',new TextEncoder().encode(nested),'multipart/form-data');
function fixture(authenticated=false) {
 const schema={type:'object',required:['metadata'],additionalProperties:false,properties:{
  metadata:{type:'object',nullable:true,required:['count'],additionalProperties:false,properties:{count:{type:'integer',minimum:1},label:text}},
  sdp:text,manifest:text,files:{type:'array',minItems:1,maxItems:2,items:binary},bundle:binary,
  mixed:{anyOf:[text,binary]},session:{allOf:[{$ref:'#/components/schemas/Session'}]},scalar:text,constructor:text,['__proto__']:{type:'object',properties:{safe:{type:'boolean'}}},
 }};
 const encoding={metadata:{contentType:'application/json'},sdp:{contentType:'application/sdp'},manifest:{contentType:'application/json','x-operations-json-text':true},scalar:{contentType:'application/json'},
  files:{contentType:'application/wasm, text/plain','x-operations-part-name':'filename'},bundle:{contentType:'multipart/form-data'},session:{contentType:'application/json'},['__proto__']:{contentType:'application/json'}};
 return {openapi:'3.1.0',info:{title:'Multipart parts',version:'1'},servers:[{url:'https://parts.example.test'}],
  components:{schemas:{Session:{type:'object',required:['type'],properties:{type:{type:'string',enum:['realtime']},model:text}}},
   ...(authenticated?{securitySchemes:{Token:{type:'http',scheme:'bearer'}}}:{})},...(authenticated?{security:[{Token:[]}]}:{}),
  paths:{'/parts':{post:{operationId:'send',summary:'Send',requestBody:{required:true,content:{'multipart/form-data':{schema,encoding}}},responses:{200:{description:'Accepted'}}}}}};
}
const models=source=>[extractOperations(source,'parts')[0],inspectServiceSchema(source,'parts').operations[0]];
const values={'body:metadata':'{"count":2,"label":"λ & β"}','body:sdp':'v=0\r\nλ\r\n','body:manifest':'{"index.html":"hash"}','body:session':'{"type":"realtime","model":"gpt-realtime"}','body:scalar':'JSON string λ','body:constructor':'keep-plain','body:__proto__':'{"safe":true}'};
async function checkParts(form) {
 assert.ok(form instanceof FormData);
 assert.equal(form.get('metadata').type,'application/json');assert.deepEqual(JSON.parse(await form.get('metadata').text()),{count:2,label:'λ & β'});
 assert.equal(form.get('sdp').type,'application/sdp');assert.equal(await form.get('sdp').text(),values['body:sdp']);
 assert.equal(form.get('manifest').type,'application/json');assert.equal(await form.get('manifest').text(),values['body:manifest']);
 assert.deepEqual(JSON.parse(await form.get('session').text()),{type:'realtime',model:'gpt-realtime'});
 assert.equal(form.get('constructor'),'keep-plain');assert.deepEqual(JSON.parse(await form.get('__proto__').text()),{safe:true});
 assert.equal(JSON.parse(await form.get('scalar').text()),values['body:scalar']);
}
Then('both multipart parsers send typed JSON and SDP parts through public and private HTTP execution',async()=>{
 const wrapped=fixture(),wrappedMedia=wrapped.paths['/parts'].post.requestBody.content['multipart/form-data'];wrappedMedia.schema={allOf:[wrappedMedia.schema]};
 for(const model of models(wrapped))await checkParts(requestBody(prepareRequest(model,values)));
 for(const authenticated of [false,true]) {
  const source=fixture(authenticated),before=JSON.stringify(source),[operation,inspected]=models(source);
  assert.equal(inspected.unavailableReason,undefined);assert.deepEqual(operation.multipartParts,inspected.multipartParts);
  for(const model of [operation,inspected]) {const prepared=prepareRequest(model,values);await checkParts(requestBody(prepared));}
  const previous=[...catalogs];updateCatalogs([...previous,{id:'parts',name:'Parts',file:'parts.json',document:source,groups:[],execution:{kind:'http',origin:'https://parts.example.test'}}]);
  try {
   let calls=0,failure;const fetchRequest=async(url,init)=>{calls++;try {
    assert.equal(new Headers(init.headers).get('Content-Type'),null);assert.equal(new Headers(init.headers).get('Authorization'),authenticated?'Bearer synthetic-part-token':null);
    const wire=new Request(String(url),init);assert.match(wire.headers.get('Content-Type'),/multipart\/form-data; boundary=/);await checkParts(await wire.formData());
   }catch(error){failure=error;}return Response.json({accepted:true});};
   if(authenticated){const descriptor=await approvedOperation(operation,'https://parts.example.test');await executeCredentialed(descriptor,values,{alternative:0,fingerprint:descriptor.fingerprint,credentials:{Token:'part-token'}},[{id:'part-token',label:'Parts',kind:'secret',value:'synthetic-part-token',grants:[]}],{assertCurrent(){},fetchRequest});}
   else await createWorkflowRequestExecution(fetchRequest).execute(operation,values);
   if(failure)throw failure;assert.equal(calls,1);assert.equal(JSON.stringify(source),before);
  }finally{updateCatalogs(previous);}
 }
});
Then('multipart filename collections and nested bundles preserve names boundaries and file bytes',async()=>{
 for(const operation of models(fixture())) {
  const form=requestBody(prepareRequest(operation,{...values,'body:files':JSON.stringify([file]),'body:bundle':JSON.stringify(bundle),'body:mixed':JSON.stringify(file)}));
  assert.equal(form.has('files'),false);assert.equal(form.get(file.name).name,file.name);assert.deepEqual(new Uint8Array(await form.get(file.name).arrayBuffer()),bytes);
  const inner=form.get('bundle');assert.match(inner.type,/multipart\/form-data; boundary="inner-boundary"/);assert.equal(await inner.text(),nested);
  const decoded=await new Response(inner,{headers:{'Content-Type':inner.type}}).formData();assert.equal(await decoded.get('module.wasm').text(),'module-bytes');
  assert.deepEqual(new Uint8Array(await form.get('mixed').arrayBuffer()),bytes);
  assert.equal(requestBody(prepareRequest(operation,{'body:metadata':'null','body:mixed':'"plain text"'})).get('mixed'),'plain text');
  assert.equal(await requestBody(prepareRequest(operation,{'body:metadata':'null'})).get('metadata').text(),'null');
 }
});
Then('malformed multipart encodings and incompatible values cannot dispatch',()=>{
 for(const [name,encoding]of [['metadata',{headers:{Authorization:{schema:text}}}],['metadata',{style:'deepObject'}],['metadata',{contentType:'application/json\r\nInjected: yes'}],['metadata',{contentType:'*/*'}],['metadata',{contentType:'application/json,application/json'}],['missing',{contentType:'application/json'}]]) {
  const source=fixture();source.paths['/parts'].post.requestBody.content['multipart/form-data'].encoding[name]=encoding;
  assert.throws(()=>extractOperations(source,'parts'),error=>error.message.includes(name));const model=inspectServiceSchema(source,'parts').operations[0];assert.ok(model.unavailableReason?.includes(name));
 }
 for(const operation of models(fixture())) {
  for(const invalid of [{'body:metadata':'{"count":0}'},{'body:metadata':'{"count":1,"unexpected":true}'},{'body:mixed':'{}'},{'body:mixed':'null'},{'body:session':'{"type":"wrong"}'},{'body:files':'[]'}])
   assert.throws(()=>prepareRequest(operation,{...values,...invalid}),InputValidationError);
  for(const bad of [[file,file],[{...file,name:'metadata'}],[encodeWorkflowBinary('bad.png',bytes,'image/png')]])
   assert.throws(()=>requestBody(prepareRequest(operation,{...values,'body:files':JSON.stringify(bad)})),/part|media/i);
  assert.throws(()=>requestBody(prepareRequest(operation,{...values,'body:bundle':JSON.stringify(encodeWorkflowBinary('bad.bundle',bytes,'multipart/form-data'))})),/boundaries/);
 }
 const source=fixture(),media=source.paths['/parts'].post.requestBody.content['multipart/form-data'];delete media.encoding;delete media.schema.properties.mixed;delete media.schema.properties.session;
 assert.throws(()=>extractOperations(source,'parts'),/metadata/);assert.ok(inspectServiceSchema(source,'parts').operations[0].unavailableReason);
 const route=fixture(),operation=route.paths['/parts'].post;route.paths={'/parts/{namespace}':{post:operation}};
 operation.parameters=[{name:'namespace',in:'path',required:true,schema:{type:'string',minLength:2,maxLength:3,readOnly:true,'x-auditable':true}}];
 for(const model of models(route)){assert.equal(prepareRequest(model,{...values,'path:namespace':'ok'}).path,'/parts/ok');assert.throws(()=>prepareRequest(model,{...values,'path:namespace':'long'}),InputValidationError);}
 operation.parameters[0].schema.readOnly='invalid';assert.throws(()=>extractOperations(route,'parts'),/readOnly must be Boolean/);
});
Then('the eight multipart body corrections retain native identities source bodies and alternate media',async()=>{
 let count=0;
 for(const catalog of Object.keys(contracts.sources)) {
  const upstream=await readServiceSchemaUpstream(catalog),before=structuredClone(upstream),document=structuredClone(upstream);bindMultipartParts(document);
  assert.deepEqual(document.info,before.info);assert.deepEqual(document.servers,before.servers);assert.deepEqual(document.components,before.components);assert.deepEqual(document.security,before.security);
  for(const [id,contract]of Object.entries(contracts.operations))if(contract.catalog===catalog) {
   count++;const after=document.paths[contract.path][contract.method.toLowerCase()],prior=before.paths[contract.path][contract.method.toLowerCase()];
   assert.equal(after.operationId,prior.operationId,id);assert.deepEqual(after['x-upstream-multipart-request-body'],prior.requestBody);assert.deepEqual(after.responses,prior.responses);
   assert.deepEqual(Object.keys(after.requestBody.content),['multipart/form-data']);assert.deepEqual(after.parameters,prior.parameters);
   if(catalog==='openai')assert.ok(after['x-upstream-multipart-request-body'].content['application/sdp']);
  }
  assert.throws(()=>bindMultipartParts(document),/reviewed/);const drift=structuredClone(upstream);drift.info.version+='changed';assert.throws(()=>bindMultipartParts(drift),/identity/);
  const driftBody=structuredClone(upstream),entry=Object.values(contracts.operations).find(contract=>contract.catalog===catalog);driftBody.paths[entry.path][entry.method.toLowerCase()].requestBody.required=!entry.requestBody.required;assert.throws(()=>bindMultipartParts(driftBody),/reviewed/);
 }
 assert.equal(count,8);
});
Then('all eight reviewed multipart operations send their declared part types and private authorization',async()=>{
 assert.equal(ids.length,8);let calls=0;
 for(const catalog of Object.keys(contracts.sources)) {
  const document=await readServiceSchema(catalog),scoped=structuredClone(document),selected=new Set(ids);scoped.paths=Object.fromEntries(Object.entries(document.paths).filter(([,item])=>Object.values(item).some(operation=>operation&&selected.has(catalog+':'+operation.operationId))));
  for(const item of Object.values(scoped.paths))for(const method of ['get','post','put','patch','delete','head','options','trace'])if(item[method]&&!selected.has(catalog+':'+item[method].operationId))delete item[method];
  const strict=extractOperations(scoped,catalog),operations=inspectServiceSchema(document,catalog,selected).operations;assert.equal(strict.length,operations.length);
  for(const operation of operations) {
   assert.equal(operation.unavailableReason,undefined,operation.id);const input={};
   for(const field of operation.fields)if(field.required&&field.location!=='body')input[field.key]=field.name.endsWith('_id')?'a'.repeat(32):'fixture';
   if(operation.id.includes('patch-')||operation.id.endsWith('patch-settings'))input['body:settings']='{"compatibility_date":"2026-01-01"}';
   else if(operation.id.includes('put')&&operation.id.includes('content')) {input['body:metadata']='{"main_module":"module.wasm"}';input['body:files']=JSON.stringify([file]);}
   else if(operation.id.includes('create-deployment')){input['body:manifest']='{"index.html":"hash"}';input['body:_worker.bundle']=JSON.stringify(bundle);}
   else if(operation.id.includes('key-value')){input['body:value']=JSON.stringify(file);input['body:metadata']='{"scope":"fixture"}';}
   else if(catalog==='openai'){input['body:sdp']=values['body:sdp'];input['body:session']=values['body:session'];}
   const origin=operationServerUrl(document,operation),descriptor=await approvedOperation(operation,origin),alternative=operation.security.findIndex(option=>option.every(scheme=>scheme.kind!=='unsupported')),records=[],credentials={};
   for(const [index,scheme]of operation.security[alternative].entries()){const id='multipart-part-key-'+index;credentials[scheme.name]=id;records.push({id,label:id,kind:'secret',value:'synthetic-multipart-part-key-'+index,grants:[]});}
   let failure;await executeCredentialed(descriptor,input,{alternative,fingerprint:descriptor.fingerprint,credentials},records,{assertCurrent(){},async fetchRequest(url,init){calls++;try {
    assert.ok(init.body instanceof FormData);assert.equal(new Headers(init.headers).get('Content-Type'),null);for(const scheme of operation.security[alternative])assert.ok(new Headers(init.headers).get(scheme.header));
    const form=await new Request(String(url),init).formData();for(const [name,part]of Object.entries(operation.multipartParts))if(form.has(name)&&part.contentTypes?.length===1)assert.ok(form.get(name).type.startsWith(part.contentTypes[0]));
    if(input['body:files']){assert.equal(form.has('files'),false);assert.deepEqual(new Uint8Array(await form.get('module.wasm').arrayBuffer()),bytes);assert.equal(JSON.parse(await form.get('metadata').text()).main_module,'module.wasm');}
    if(input['body:value'])assert.deepEqual(new Uint8Array(await form.get('value').arrayBuffer()),bytes);
   }catch(error){failure=error;}
    return catalog==='openai'?new Response('v=0\r\n',{status:201,headers:{'Content-Type':'application/sdp'}}):Response.json({success:true,result:{}});
   }});if(failure)throw failure;
   const canonical=strict.find(candidate=>candidate.id===operation.id);assert.deepEqual(prepareRequest(canonical,input),prepareRequest(operation,input));
  }
 }
 assert.equal(calls,8);
});
Then('changed multipart part media cannot reuse an approved credential binding',async()=>{
 const operation=models(fixture(true))[0],descriptor=await approvedOperation(operation,'https://parts.example.test');const changed=structuredClone(operation);changed.multipartParts.sdp.contentTypes=['text/plain'];
 const next=await approvedOperation(changed,'https://parts.example.test');assert.notEqual(descriptor.fingerprint,next.fingerprint);
 let calls=0;await assert.rejects(()=>executeCredentialed(next,values,{alternative:0,fingerprint:descriptor.fingerprint,credentials:{Token:'part-key'}},[{id:'part-key',label:'Parts',kind:'secret',value:'synthetic-part-key',grants:[]}],{assertCurrent(){},async fetchRequest(){calls++;return Response.json({});}}),{code:'PERMISSION'});assert.equal(calls,0);
 await assert.rejects(()=>validateApprovedOperation({...descriptor,operation:changed}),{code:'PERMISSION'});
});
