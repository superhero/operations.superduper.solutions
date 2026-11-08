// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import data from './lib/gmail-message-contracts.json' with { type: 'json' };
import ids from '../tests/gmail-message-operations.json' with { type: 'json' };
import { bindGmailMessages } from './lib/gmail-message-contracts.ts';
import { gmailMessageProfile, gmailMimeInputKey, gmailRelatedBody } from './lib/gmail-message.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperations, updateCatalogs, operationForId } from './lib/catalog.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { encodeWorkflowBinary, fileMediaType, maxWorkflowUploadBytes } from './lib/workflow-binary.ts';
import { createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { createOperationGraph, isWorkflowConnection } from './lib/workflow-graph.ts';
import { readWorkflowFile } from './lib/workflow-file.ts';
import { parseWorkflowDocument } from './lib/workflow-document.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { createHttpConnection } from './lib/secrets/http-connections.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { vaultVariablePlaceholder } from './lib/secrets/variables.ts';
const selected = new Set(ids), encoder = new TextEncoder();
const bytes = encoder.encode('From: sender@example.test\r\nTo: recipient@example.test\r\nSubject: Fixture\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nHello 世界 🌍\r\n');
const file = encodeWorkflowBinary('fixture.eml', bytes);
const raw = file.base64.replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const native = (document, contract) => document.paths[contract.path][contract.method.toLowerCase()];
Then('six Gmail body corrections retain shared schemas authentication and reversible media declarations', async () => {
  const source = await readServiceSchemaUpstream('google-gmail'), document = structuredClone(source); bindGmailMessages(document);
  assert.deepEqual(document.components,source.components); assert.deepEqual(document.servers,source.servers);
  for (const contract of Object.values(data.operations)) { const operation = native(document,contract), original = native(source,contract);
    assert.deepEqual(operation.security,original.security); assert.deepEqual(operation.parameters,original.parameters); assert.deepEqual(operation.responses,original.responses);
    assert.deepEqual(operation['x-upstream-gmail-body'],original.requestBody); assert.equal(operation.operationId,original.operationId);
    assert.deepEqual(Object.keys(operation.requestBody.content),['application/json']); assert.deepEqual(operation.requestBody.content['application/json'],Object.values(original.requestBody.content)[0]);
    operation.requestBody = operation['x-upstream-gmail-body']; delete operation['x-upstream-gmail-body']; delete operation['x-operations-gmail-message'];
  }
  assert.deepEqual(document,source); assert.equal(selected.size,6);
});
Then('changed Gmail identities resources and upload contracts reject before correction', async () => {
  const source = await readServiceSchemaUpstream('google-gmail'), last = Object.values(data.operations).at(-1);
  for (const change of [d => d.info.version+='changed', d => d.servers[0].url='https://other.example.test', d => delete d.paths[last.path],
    d => native(d,last).operationId+='changed', d => native(d,last).servers=[{url:'https://other.example.test'}], d => native(d,last).requestBody={content:{}},
    d => d.components.schemas.Message.properties.raw.type='number', d => native(d,last)['x-operations-gmail-message']=gmailMessageProfile]) {
    const document = structuredClone(source); change(document); const before = JSON.stringify(document); assert.throws(() => bindGmailMessages(document),/reviewed source/); assert.equal(JSON.stringify(document),before);
  }
  bindGmailMessages(source); assert.throws(() => bindGmailMessages(source),/reviewed source/);
});
let modelsPromise;
function models() { return modelsPromise ??= (async () => {
  const document = await readServiceSchema('google-gmail'), narrow = structuredClone(document); narrow.paths={};
  for (const contract of Object.values(data.operations)) (narrow.paths[contract.path]??={})[contract.method.toLowerCase()]=native(document,contract);
  const service = inspectServiceSchema(document,'google-gmail',selected).operations, strict = extractOperations(narrow,'google-gmail');
  for (const list of [service,strict]) { assert.equal(list.length,6); for (const operation of list) assert.equal(operation.unavailableReason,undefined,operation.id); }
  return {service,strict,document};
})(); }
function resource(operation, media=false) {
  if (operation.id.endsWith('drafts.send')) return {id:'fixture-draft'};
  if (operation.id.includes('.drafts.')) return {message:media?{}:{raw}};
  return media?{labelIds:['INBOX']}:{raw};
}
function values(operation, mode='json') {
  const result={'path:userId':'me'}; if (operation.fields.some(field=>field.key==='path:id')) result['path:id']='fixture-draft';
  if (mode!=='media') result['body:$']=JSON.stringify(resource(operation,mode==='related'));
  if (mode!=='json') result[gmailMimeInputKey]=JSON.stringify(file);
  return result;
}
Then('six Gmail operations expose qualified resource and MIME fields without changing canonical paths', async () => {
  const all=await models();for (const operations of [all.service,all.strict]) for (const operation of operations) {
    assert.equal(operation.path,data.operations[operation.id].path); assert.equal(operation.gmailMessage,gmailMessageProfile);
    assert.equal(operation.fields.find(field=>field.key===gmailMimeInputKey).format,'binary');
    const graph=createOperationGraph(operation,{x:0,y:0},'gmail-fixture',all.document);
    assert.ok(graph.nodes.some(node=>node.type==='data'&&node.data.fields.some(field=>field.type==='Binary'&&field.label==='MIME message')));
    for (const mode of ['json','media','related']) { const prepared=prepareRequest(operation,values(operation,mode)); assert.equal(prepared.path.startsWith('/upload/'),mode!=='json'); assert.equal(prepared.query.uploadType,mode==='json'?undefined:mode==='media'?'media':'multipart'); }
  }
  assert.equal(fileMediaType('message.EML'),'message/rfc822');
});
async function checkRelated(body, metadata, expectedFile=file, expectedBytes=bytes) {
  assert.ok(body instanceof Blob); const boundary=/boundary=([a-z0-9-]+)/i.exec(body.type)?.[1]; assert.ok(boundary); assert.match(body.type,/^multipart\/related;/);
  const prefix=encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${expectedFile.mediaType}\r\n\r\n`), suffix=encoder.encode(`\r\n--${boundary}--\r\n`), payload=new Uint8Array(await body.arrayBuffer());
  assert.deepEqual(payload.subarray(0,prefix.length),prefix); assert.deepEqual(payload.subarray(prefix.length,payload.length-suffix.length),expectedBytes); assert.deepEqual(payload.subarray(payload.length-suffix.length),suffix);
}
async function authority(operation, saved=false) {
  const descriptor=await approvedOperation(operation,'https://gmail.googleapis.com'), alternative=operation.security.findIndex(option=>option.length&&option.every(scheme=>scheme.kind==='bearer')); assert.ok(alternative>=0,operation.id);
  const records=[], credentials={}; for (const scheme of operation.security[alternative]) { const record={id:crypto.randomUUID(),label:'Gmail fixture',kind:'secret',value:'private-gmail-token-'+records.length+'-971',grants:[]};records.push(record);credentials[scheme.name]=record.id; }
  const binding={alternative,credentials,fingerprint:descriptor.fingerprint};
  if (saved) { const connection=await createHttpConnection({label:'Gmail fixture',account:'Synthetic',format:'schema'},descriptor,binding,records);records[0].connections=[connection];binding.credentials={};binding.connection={id:connection.id,revision:connection.revision,fingerprint:connection.fingerprint}; }
  return {descriptor,records,binding};
}
Then('native Gmail private requests retain JSON simple MIME and metadata with MIME wire contracts', async () => {
  let count=0;for (const operation of (await models()).service) for (const mode of ['json','media','related']) {
    if (operation.id.endsWith('drafts.send')&&mode==='media') continue; // Sending an existing draft uses its JSON ID, including with MIME media.
    const input=values(operation,mode), prepared=prepareRequest(operation,input), a=await authority(operation);let failure;
    const result=await executeCredentialed(a.descriptor,input,a.binding,a.records,{assertCurrent(){},async fetchRequest(url,init){count++;try {
      assert.equal(init.method,operation.method);assert.equal(new URL(url).pathname,prepared.path);assert.equal(new URL(url).searchParams.get('uploadType'),mode==='json'?null:mode==='media'?'media':'multipart');assert.match(new Headers(init.headers).get('Authorization'),/^Bearer private-gmail-token-/);
      if (mode==='json') {assert.equal(new Headers(init.headers).get('Content-Type'),'application/json');assert.deepEqual(JSON.parse(String(init.body)),resource(operation));}
      else if (mode==='media') {assert.equal(new Headers(init.headers).get('Content-Type'),'message/rfc822');assert.deepEqual(new Uint8Array(await init.body.arrayBuffer()),bytes);}
      else {assert.equal(new Headers(init.headers).get('Content-Type'),null);const wire=new Request(String(url),init);assert.equal(wire.headers.get('Content-Type'),init.body.type);await checkRelated(init.body,resource(operation,true));}
    }catch(error){failure=error;}return Response.json({id:'fixture-result'});}}).catch(error=>{throw new Error(operation.id+' '+mode+': '+error.message,{cause:error});});if(failure)throw failure;for(const record of a.records)assert.equal(JSON.stringify(result).includes(record.value),false);
  }assert.equal(count,17);
});
Then('Gmail related uploads retain UTF8 metadata and exact bounded message bytes', async () => {
  const operation=(await models()).service.find(operation=>operation.id.endsWith('messages.import'));
  for(const mediaType of ['message/rfc822','message/global','message/vnd.wfa.wsc']) {
    const typed={...file,mediaType}, input={...values(operation,'related'),'body:$':JSON.stringify({labelIds:['INBOX'],threadId:'世界'}),[gmailMimeInputKey]:JSON.stringify(typed)},prepared=prepareRequest(operation,input);
    await checkRelated(requestBody(prepared),{labelIds:['INBOX'],threadId:'世界'},typed);
  }
  const fullBytes=new Uint8Array(maxWorkflowUploadBytes).fill(255), full=encodeWorkflowBinary('full.eml',fullBytes,'message/rfc822');await checkRelated(gmailRelatedBody({metadata:{labelIds:['INBOX']},file:full}),{labelIds:['INBOX']},full,fullBytes);
});
Then('malformed Gmail files resources and upload overrides fail before private HTTP', async () => {
  for(const operation of (await models()).service) {const a=await authority(operation), valid=values(operation,'media'), invalid=[{'path:userId':'me'}, {...valid,'body:$':'[]'}, {...valid,'query:uploadType':'resumable'}, {...valid,'body:unexpected':'value'}];
    for(const bad of [{}, {...file,size:file.size+1}, {...file,base64:'invalid'}, {...file,size:maxWorkflowUploadBytes+1}, {...file,mediaType:'application/json'}, encodeWorkflowBinary('empty.eml',new Uint8Array(),'message/rfc822')])invalid.push({...valid,[gmailMimeInputKey]:JSON.stringify(bad)});
    for(const input of invalid) {assert.throws(()=>prepareRequest(operation,input),InputValidationError);let calls=0;await assert.rejects(()=>executeCredentialed(a.descriptor,input,a.binding,a.records,{assertCurrent(){},async fetchRequest(){calls++;return Response.json({});}}));assert.equal(calls,0);}
  }
});
Then('changed Gmail paths body profiles and MIME limits cannot reuse approved credentials', async () => {
  const operation=(await models()).service[0],a=await authority(operation);
  for(const change of [o=>o.gmailMessage='unknown',o=>o.path='/upload'+o.path,o=>o.id+='changed',o=>o.method='DELETE',o=>o.fields.find(field=>field.key===gmailMimeInputKey).schema.maxLength++]) {const forged=structuredClone(operation);change(forged);await assert.rejects(()=>approvedOperation(forged,a.descriptor.origin),error=>error.code==='PERMISSION');}
  const changed=structuredClone(operation);changed.bodySchema.properties.$.properties.extra={type:'string'};const descriptor=await approvedOperation(changed,a.descriptor.origin);assert.notEqual(descriptor.fingerprint,a.descriptor.fingerprint);let calls=0;await assert.rejects(()=>executeCredentialed(descriptor,values(changed),a.binding,a.records,{assertCurrent(){},async fetchRequest(){calls++;return Response.json({});}}),error=>error.code==='PERMISSION');assert.equal(calls,0);
});
Then('a saved Gmail connection resolves private draft metadata inside a related upload', async () => {
  const operation=(await models()).service.find(operation=>operation.id.endsWith('drafts.send')),a=await authority(operation,true),secret={id:crypto.randomUUID(),label:'Draft ID',kind:'secret',value:'private-draft-id-971',grants:[]};a.records.push(secret);
  const input={...values(operation,'related'),'body:$':JSON.stringify({id:vaultVariablePlaceholder})};let calls=0;
  const result=await executeCredentialed(a.descriptor,input,a.binding,a.records,{variables:[{key:'body:$',path:['id'],credentialId:secret.id}],assertCurrent(){},async fetchRequest(url,init){calls++;await checkRelated(init.body,{id:secret.value});return Response.json({id:'sent',echo:secret.value});}});
  assert.equal(calls,1);assert.equal(JSON.stringify(result).includes(secret.value),false);assert.equal(result.response.redacted,true);
});
Then('the anonymous HTTP executor preserves the related upload boundary and both parts', async () => {
  const path='/gmail/v1/users/{userId}/messages/send', source={openapi:'3.0.0',info:{title:'Gmail transport fixture',version:'1'},servers:[{url:'https://gmail.synthetic.example.test'}],paths:{[path]:{post:{operationId:'gmail.users.messages.send','x-operations-gmail-message':gmailMessageProfile,parameters:[{name:'userId',in:'path',required:true,schema:{type:'string'}}],requestBody:{required:true,content:{'application/json':{schema:{type:'object',properties:{labelIds:{type:'array',items:{type:'string'}}}}}}},responses:{200:{description:'ok',content:{'application/json':{schema:{type:'object'}}}}}}}}};
  const previous=[...catalogs];updateCatalogs([...previous.filter(catalog=>catalog.id!=='google-gmail'),{id:'google-gmail',name:'Gmail fixture',file:'gmail-fixture.json',document:source,groups:[],execution:{kind:'http',origin:'https://gmail.synthetic.example.test'}}]);
  try {
    const operation=operationForId('google-gmail:gmail.users.messages.send'),graph=createOperationGraph(operation,{x:600,y:0},'send',source),metadata={labelIds:['INBOX']};
    const inputFiles=[{id:'mime',type:'file',position:{x:0,y:0},data:{file:readWorkflowFile('fixture.eml',bytes)}},{id:'metadata',type:'file',position:{x:0,y:200},data:{file:readWorkflowFile('metadata.json',encoder.encode(JSON.stringify(metadata)),'application/json')}}];
    const edges=inputFiles.map((node,index)=>{const label=index===0?'MIME message':'Message resource',target=graph.nodes.find(node=>node.type==='data'&&node.data.direction==='inputs'&&node.data.fields.some(field=>field.label===label)),field=target.data.fields.find(field=>field.label===label);return{id:'map-'+node.id,kind:'mapping',source:node.id,sourceHandle:'value',target:target.id,targetHandle:field.id};});
    const nodes=[...inputFiles,...graph.nodes],allEdges=[...graph.edges,...edges];for(const edge of edges)assert.equal(isWorkflowConnection(edge,nodes,allEdges.filter(candidate=>candidate!==edge)),true,edge.id);
    const document=parseWorkflowDocument(JSON.stringify({version:3,id:'gmail-flow',name:'Gmail fixture',nodes,edges:allEdges,viewport:{x:0,y:0,zoom:1},snap:true,curved:true,dashed:false}));
    let calls=0;const execution=createWorkflowRequestExecution(async(url,init)=>{calls++;assert.equal(new Headers(init.headers).get('Content-Type'),null);assert.equal(new URL(url).searchParams.get('uploadType'),'multipart');await checkRelated(init.body,metadata);return Response.json({id:'fixture'});});
    const runner=createWorkflowRunner(document,'send',execution),visit=runner.next();assert.deepEqual(JSON.parse(visit.values[gmailMimeInputKey]),file);assert.deepEqual(JSON.parse(visit.values['body:$']),metadata);await runner.submit({...visit.values,'path:userId':'me'});assert.equal(calls,1);
  }finally{updateCatalogs(previous);}
});
