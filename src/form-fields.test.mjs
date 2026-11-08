// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import data from './lib/form-field-contracts.json' with {type:'json'};
import ids from '../tests/form-field-operations.json' with {type:'json'};
import { bindFormFields } from './lib/form-field-contracts.ts';
import { readServiceSchema,readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperations } from './lib/catalog.ts';
import { encodeWorkflowBinary,maxWorkflowUploadBytes } from './lib/workflow-binary.ts';
import { prepareRequest,InputValidationError } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { createHttpConnection } from './lib/secrets/http-connections.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
const selected=new Set(ids),verbs=['get','post','put','patch','delete','head','options','trace'];
const bytes=new Uint8Array([0,255,128,10,13,65]),file=encodeWorkflowBinary('fixture.png',bytes,'image/png');
const native=(document,c)=>document.paths[c.path][c.method.toLowerCase()];
const fixture=(properties,encoding)=>({openapi:'3.1.0',info:{title:'Form unions',version:'1'},servers:[{url:'https://forms.example.test'}],components:{securitySchemes:{Token:{type:'http',scheme:'bearer'}}},security:[{Token:[]}],paths:{'/form':{post:{operationId:'form',responses:{200:{description:'ok'}},requestBody:{required:true,content:{'multipart/form-data':{schema:{type:'object',properties,additionalProperties:false},encoding}}}}}}});
const style=kind=>({'x-operations-form-style':kind});
const models=source=>[extractOperations(source,'forms')[0],inspectServiceSchema(source,'forms').operations[0]];
async function formFor(operation,input) {return new Request('https://forms.example.test',{method:'POST',body:requestBody(prepareRequest(operation,input))}).formData();}
Then('all thirteen form corrections preserve source identities schemas and request preimages',async()=>{
 let count=0;for(const catalog of Object.keys(data.sources)) {
  const source=await readServiceSchemaUpstream(catalog),document=structuredClone(source);bindFormFields(document);assert.deepEqual(document.components,source.components);assert.deepEqual(document.servers,source.servers);
  for(const [id,c]of Object.entries(data.operations))if(c.catalog===catalog){count++;const operation=native(document,c),before=native(source,c);assert.equal(operation.operationId,before.operationId,id);assert.deepEqual(operation.security,before.security);assert.deepEqual(operation.responses,before.responses);assert.deepEqual(operation['x-upstream-form-field-body'],before.requestBody);operation.requestBody=operation['x-upstream-form-field-body'];delete operation['x-upstream-form-field-body'];}
  assert.deepEqual(document,source);
 }assert.equal(count,13);assert.equal(new Set(ids).size,13);
});
Then('changed native form fields cannot be partially corrected',async()=>{
 for(const catalog of Object.keys(data.sources)) {
  const source=await readServiceSchemaUpstream(catalog),last=Object.values(data.operations).filter(c=>c.catalog===catalog).at(-1);
  for(const change of [d=>d.info.version+='changed',d=>delete d.paths[last.path],d=>native(d,last).requestBody={content:{}},d=>native(d,last)['x-upstream-form-field-body']={}]) {
   const document=structuredClone(source);change(document);const before=JSON.stringify(document);assert.throws(()=>bindFormFields(document),/reviewed native contract/);assert.equal(JSON.stringify(document),before);
  }bindFormFields(source);assert.throws(()=>bindFormFields(source),/reviewed native contract/);
 }
});
Then('qualified scalar and repeated form unions preserve types bounds exclusivity and uniqueness',async()=>{
 const source=fixture({scalar:{anyOf:[{type:'boolean'},{type:'string',enum:['music_v1','music_v2']}]},repeat:{oneOf:[{type:'string',enum:['word','segment']},{type:'array',items:{type:'string',enum:['word','segment']},uniqueItems:true,minItems:1,maxItems:2}]}},{scalar:style('scalar'),repeat:style('repeat')});
 for(const operation of models(source)) {
  for(const [raw,expected]of [['false','false'],['true','true'],['"music_v2"','music_v2']])assert.equal((await formFor(operation,{'body:scalar':raw})).get('scalar'),expected);
  assert.deepEqual((await formFor(operation,{'body:repeat':'["word","segment"]'})).getAll('repeat'),['word','segment']);
  for(const [name,raw]of [['scalar','"wrong"'],['scalar','5'],['repeat','[]'],['repeat','["word","word"]'],['repeat','["word","segment","word"]'],['repeat','"bad"']])assert.throws(()=>prepareRequest(operation,{['body:'+name]:raw}),InputValidationError);
 }
 const overlap=fixture({value:{oneOf:[{type:'integer'},{type:'number'}]}},{value:style('scalar')});for(const operation of models(overlap)){assert.throws(()=>prepareRequest(operation,{'body:value':'1'}),InputValidationError);assert.equal((await formFor(operation,{'body:value':'1.5'})).get('value'),'1.5');}
});
Then('bracketed multipart options preserve structure and reject unqualified encodings',async()=>{
 const config={anyOf:[{type:'string',enum:['auto']},{type:'object',required:['type'],additionalProperties:false,properties:{type:{type:'string',enum:['server_vad']},threshold:{type:'number',minimum:0,maximum:1}}}]};
 const source=fixture({config,tags:{type:'array',items:{type:'string'}}},{config:style('brackets'),tags:style('brackets')});for(const operation of models(source)) {
  const form=await formFor(operation,{'body:config':'{"type":"server_vad","threshold":0.5}','body:tags':'["one","two"]'});assert.equal(form.get('config[type]'),'server_vad');assert.equal(form.get('config[threshold]'),'0.5');assert.deepEqual(form.getAll('tags[]'),['one','two']);assert.equal((await formFor(operation,{'body:config':'"auto"'})).get('config'),'auto');
  for(const raw of ['{}','{"type":"wrong"}','{"type":"server_vad","threshold":2}','{"type":"server_vad","extra":true}'])assert.throws(()=>prepareRequest(operation,{'body:config':raw}),InputValidationError);
 }
 for(const change of [media=>media.encoding.config={'x-operations-form-style':'unqualified'},media=>media.encoding.config={...style('brackets'),contentType:'application/json'},media=>media.schema.properties.config={type:'object',properties:{nested:{type:'array',items:{type:'string',format:'binary'}}}}]) {
  const changed=structuredClone(source);change(changed.paths['/form'].post.requestBody.content['multipart/form-data']);assert.throws(()=>extractOperations(changed,'forms'),/config/);assert.ok(inspectServiceSchema(changed,'forms').operations[0].unavailableReason?.includes('config'));
 }
 for(const reverse of [false,true]) {
  const properties={config,'config[type]':{type:'string'}},colliding=fixture(reverse?Object.fromEntries(Object.entries(properties).reverse()):properties,{config:style('brackets')});
  for(const operation of models(colliding))assert.throws(()=>requestBody(prepareRequest(operation,{'body:config':'{"type":"server_vad"}','body:config[type]':'wrong'})),/collid/);
 }
});
Then('typed JSON text fields retain their part type without becoming file uploads',async()=>{
 const source=fixture({metadata:{type:'array',items:{type:'object',properties:{format:{type:'string',enum:['srt']}},required:['format'],additionalProperties:false},maxItems:2},file:{type:'string',format:'binary'},scalar:{type:'string'}},{metadata:{...style('json-text'),contentType:'application/json'},scalar:style('json-text')});
 for(const operation of models(source)) {
  const prepared=prepareRequest(operation,{'body:metadata':'[{"format":"srt"}]','body:scalar':'all','body:file':JSON.stringify(file)}),body=requestBody(prepared);assert.ok(body instanceof Blob);assert.match(body.type,/multipart\/form-data; boundary=operations-/);const raw=await body.text();assert.match(raw,/name="metadata"\r\nContent-Type: application\/json\r\n\r\n\[{"format":"srt"}\]/);assert.doesNotMatch(raw,/name="metadata"; filename/);
  const form=await new Request('https://forms.example.test',{method:'POST',body}).formData();assert.equal(typeof form.get('metadata'),'string');assert.deepEqual(JSON.parse(form.get('metadata')),[{format:'srt'}]);assert.equal(form.get('scalar'),'"all"');assert.deepEqual(new Uint8Array(await form.get('file').arrayBuffer()),bytes);assert.equal(form.get('file').name,file.name);
 }
});
let nativePromise;
function nativeModels() {return nativePromise??=(async()=>{
 const result=[];for(const catalog of Object.keys(data.sources)){const document=await readServiceSchema(catalog);for(const operation of inspectServiceSchema(document,catalog,selected).operations){assert.equal(operation.unavailableReason,undefined,operation.id);result.push(operation);}}
 assert.equal(result.length,13);return result;
})();}
function values(operation) {
 const input={};for(const field of operation.fields)if(field.required){input[field.key]=field.format==='binary'?JSON.stringify(file):field.enum?.[0]!==undefined?String(field.enum[0]):field.name==='AccountSid'?'AC'+'a'.repeat(32):field.name==='CallSid'?'CA'+'a'.repeat(32):field.type==='json'?JSON.stringify(file):field.name==='StatusCallback'?'https://callback.example.test':field.name==='model_id'?'scribe_v1':field.name==='model'?'whisper-1':field.name==='code'?'fixture-code':'123456789012345678';}
 if(operation.id==='discord:create_guild_sticker'){input['body:name']='Fixture';input['body:tags']='fixture';}
 if(operation.id==='elevenlabs:speech_to_text'){Object.assign(input,{'body:file':JSON.stringify(file),'body:additional_formats':'[{"format":"srt","include_speakers":true,"include_timestamps":true}]','body:webhook_metadata':'{"request_id":"fixture"}','body:entity_detection':'["pii"]','body:entity_redaction':'"pii"'});}
 if(operation.id==='elevenlabs:upload_song')input['body:extract_composition_plan']='"music_v2"';
 if(operation.id==='mistral:files_api_routes_upload_file')input['body:visibility']='workspace';
 if(operation.id==='openai:createImageVariation')input['body:model']='dall-e-2';
 if(operation.id==='openai:createTranscription')Object.assign(input,{'body:chunking_strategy':'{"type":"server_vad","threshold":0.5}','body:timestamp_granularities':'["word","segment"]'});
 if(operation.id==='telegram:setChatPhoto')input['body:chat_id']='-100123456789';
 if(operation.id.startsWith('together:'))input['body:timestamp_granularities']='["word","segment"]';
 if(operation.id==='twilio:CreatePayments')input['body:Parameter']='{"name":"fixture"}';
 return input;
}
async function authority(operation) {
 const origin=operation.privatePath?'https://api.telegram.org':operation.id.startsWith('discord:')?'https://discord.com/api/v10':'https://native-forms.synthetic.example.test',descriptor=await approvedOperation(operation,origin),alternative=operation.security.findIndex(option=>option.length&&option.every(scheme=>['basic','bearer','apiKey'].includes(scheme.kind)));assert.ok(alternative>=0,operation.id);
 const records=[],credentials={};for(const scheme of operation.security[alternative]){const secret=()=>{const record={id:crypto.randomUUID(),label:'Form fixture',kind:'secret',value:operation.privatePath?'123456789:synthetic_form_token_971':'synthetic-form-token-'+records.length+'-971',grants:[]};records.push(record);return record.id;};credentials[scheme.name]=scheme.kind==='basic'?{username:secret(),password:secret()}:secret();}
 const binding={alternative,credentials,fingerprint:descriptor.fingerprint};if(operation.privatePath||operation.id.startsWith('discord:')){const connection=await createHttpConnection({label:'Form fixture',account:'Synthetic',format:operation.privatePath?'schema':'discord-bot'},descriptor,binding,records);records[0].connections=[connection];binding.credentials={};binding.connection={id:connection.id,revision:connection.revision,fingerprint:connection.fingerprint};}
 return {descriptor,binding,records};
}
Then('all thirteen native form operations send their qualified payloads through private HTTP execution',async()=>{
 let calls=0;for(const operation of await nativeModels()) {
  const input=values(operation),a=await authority(operation),prepared=prepareRequest(operation,input);let failure;const result=await executeCredentialed(a.descriptor,input,a.binding,a.records,{assertCurrent(){},async fetchRequest(url,init){calls++;try {
   const headers=new Headers(init.headers);if(operation.privatePath)assert.equal(String(url),'https://api.telegram.org/bot'+a.records[0].value+operation.path);else assert.ok(headers.has('Authorization')||headers.has('xi-api-key'));
   if(operation.id.startsWith('discord:'))assert.equal(headers.get('Authorization'),'Bot '+a.records[0].value);
   if(operation.bodyMediaType==='application/x-www-form-urlencoded'){assert.equal(new URLSearchParams(String(init.body)).get('Parameter'),'{"name":"fixture"}');}
   else {assert.equal(headers.get('Content-Type'),null);const wire=new Request(String(url),init),form=await wire.formData();assert.match(wire.headers.get('Content-Type'),/multipart\/form-data; boundary=/);
    for(const field of operation.fields.filter(f=>f.format==='binary'&&input[f.key])){const uploaded=form.get(field.name);assert.equal(uploaded.name,file.name);assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()),bytes);}
    if(operation.id==='elevenlabs:speech_to_text'){assert.equal(typeof form.get('additional_formats'),'string');assert.deepEqual(JSON.parse(form.get('additional_formats')),[{format:'srt',include_speakers:true,include_timestamps:true}]);assert.equal(form.get('webhook_metadata'),'{"request_id":"fixture"}');assert.equal(form.get('entity_detection'),'["pii"]');assert.equal(form.get('entity_redaction'),'"pii"');}
    if(operation.id==='elevenlabs:upload_song')assert.equal(form.get('extract_composition_plan'),'music_v2');
    if(operation.id==='mistral:files_api_routes_upload_file')assert.equal(form.get('visibility'),'workspace');
    if(operation.id==='openai:createTranscription'){assert.equal(form.get('chunking_strategy[type]'),'server_vad');assert.equal(form.get('chunking_strategy[threshold]'),'0.5');assert.deepEqual(form.getAll('timestamp_granularities[]'),['word','segment']);}
    if(operation.privatePath)assert.equal(form.get('chat_id'),'-100123456789');
    if(operation.id.startsWith('together:')){assert.deepEqual(form.getAll('timestamp_granularities'),['word','segment']);assert.deepEqual(new Uint8Array(await form.get('file').arrayBuffer()),bytes);}
   }
  }catch(error){failure=error;}return Response.json({accepted:true});}}).catch(error=>{throw new Error(operation.id+': '+error.message,{cause:error});});if(failure)throw failure;for(const record of a.records)assert.equal(JSON.stringify(result).includes(record.value),false);assert.equal(result.request.path,prepared.path);
 }assert.equal(calls,13);
});
Then('invalid native form union values and corrupt file envelopes cannot dispatch',async()=>{
 for(const operation of await nativeModels()) {
  const input=values(operation),a=await authority(operation),invalid=[];
  for(const field of operation.fields.filter(f=>f.format==='binary'))for(const value of [{}, {...file,size:file.size+1}, {...file,size:maxWorkflowUploadBytes+1}])invalid.push({...input,[field.key]:JSON.stringify(value)});
  if(operation.id==='elevenlabs:speech_to_text'){invalid.push({...input,'body:additional_formats':'[{"format":"wrong"}]'},{...input,'body:additional_formats':JSON.stringify(Array(11).fill({format:'txt'}))});}
  if(operation.id==='elevenlabs:upload_song')invalid.push({...input,'body:extract_composition_plan':'"wrong"'});
  if(operation.id==='mistral:files_api_routes_upload_file')invalid.push({...input,'body:visibility':'wrong'});
  if(operation.id==='openai:createTranscription')invalid.push({...input,'body:chunking_strategy':'{"type":"wrong"}'});
  if(operation.privatePath)invalid.push({...input,'body:chat_id':'{}'},{...input,'body:chat_id':'1.5'});
  if(operation.id.startsWith('together:'))for(const [key,value]of [['file','"file:///local"'],['file','{}'],['timestamp_granularities','[]'],['timestamp_granularities','["word","word"]']])invalid.push({...input,['body:'+key]:value});
  for(const value of invalid){assert.throws(()=>prepareRequest(operation,value),InputValidationError);let calls=0;await assert.rejects(()=>executeCredentialed(a.descriptor,value,a.binding,a.records,{assertCurrent(){},async fetchRequest(){calls++;return Response.json({});}}));assert.equal(calls,0);}
 }
 for(const operation of (await nativeModels()).filter(o=>o.id.startsWith('together:'))){const input={...values(operation),'body:file':'"https://audio.example.test/a.wav"'};assert.equal((await formFor(operation,input)).get('file'),'https://audio.example.test/a.wav');}
});
Then('changed form wire styles cannot reuse earlier private authority',async()=>{
 const operation=models(fixture({value:{anyOf:[{type:'string'},{type:'boolean'}]}},{value:style('scalar')}))[0],a=await authority(operation),changed=structuredClone(operation);changed.multipartParts.value.kind='brackets';const descriptor=await approvedOperation(changed,a.descriptor.origin);assert.notEqual(descriptor.fingerprint,a.descriptor.fingerprint);let calls=0;await assert.rejects(()=>executeCredentialed(descriptor,{'body:value':'true'},a.binding,a.records,{assertCurrent(){},async fetchRequest(){calls++;return Response.json({});}}),e=>e.code==='PERMISSION');assert.equal(calls,0);
});
