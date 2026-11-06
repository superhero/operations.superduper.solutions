// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import ids from '../tests/atlassian-file-operations.json' with {type:'json'};
import data from './lib/atlassian-file-parts.json' with {type:'json'};
import { bindAtlassianFiles } from './lib/atlassian-file-parts.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { extractOperations } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { encodeWorkflowBinary, maxWorkflowUploadBytes } from './lib/workflow-binary.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1cAAAAASUVORK5CYII='),x=>x.charCodeAt(0));
const xml=new TextEncoder().encode('<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://saml.example.test"/>');
const selected=new Set(ids),verbs=new Set(['get','post','put','patch','delete','head','options','trace']);
const originalOperation=(document,contract)=>document.paths[contract.path][contract.method.toLowerCase()];
function scoped(document,catalog) {
 const result=structuredClone(document);result.paths=Object.fromEntries(Object.entries(result.paths).flatMap(([path,item])=>{
  const entries=Object.entries(item).filter(([method,value])=>!verbs.has(method)||selected.has(catalog+':'+value.operationId));
  return entries.some(([method])=>verbs.has(method))?[[path,Object.fromEntries(entries)]]:[];
 }));return result;
}
function fileFor(id) {return id.startsWith('crowd-dc:')?encodeWorkflowBinary('metadata.xml',xml,'application/xml'):encodeWorkflowBinary('original-avatar.png',png,'image/png');}
function values(operation) {
 const contract=data.operations[operation.id],input={['body:'+contract.part]:JSON.stringify(fileFor(operation.id)),'header:X-Atlassian-Token':'no-check'};
 for(const field of operation.fields)if(field.location==='path')input[field.key]=field.name==='type'?'project':field.name==='projectIdOrKey'?'DEMO':'7';
 if(operation.id.startsWith('bamboo:'))input['query:os_authType']='basic';
 return input;
}
async function authority(operation,catalog,document) {
 const template=new URL(operationServerUrl(document,operation));const origin='https://'+catalog+'.synthetic.example.test'+template.pathname.replace(/\/$/,'');
 const descriptor=await approvedOperation(operation,origin),alternative=operation.security.findIndex(option=>option.length===1&&option[0].kind==='basic');assert.ok(alternative>=0);
 const scheme=operation.security[alternative][0],records=[{id:crypto.randomUUID(),label:'Upload user',kind:'secret',value:'synthetic-upload-user-991',grants:[]},{id:crypto.randomUUID(),label:'Upload password',kind:'secret',value:'synthetic-upload-pass-991',grants:[]}];
 return {descriptor,records,binding:{alternative,fingerprint:descriptor.fingerprint,credentials:{[scheme.name]:{username:records[0].id,password:records[1].id}}},origin};
}
Then('the eight Atlassian file corrections preserve shared Java schemas identities security and upstream requests',async()=>{
 assert.equal(ids.length,8);assert.equal(new Set(ids).size,8);let corrected=0;
 for(const catalog of Object.keys(data.sources)) {
  const source=await readServiceSchemaUpstream(catalog),before=JSON.stringify(source),document=structuredClone(source);bindAtlassianFiles(document);
  assert.deepEqual(document.components,source.components);assert.deepEqual(document.security,source.security);assert.deepEqual(document.servers,source.servers);
  for(const [id,contract]of Object.entries(data.operations))if(contract.catalog===catalog) {
   corrected++;const operation=originalOperation(document,contract),original=originalOperation(source,contract),record=operation['x-upstream-atlassian-file-request'];
   assert.equal(operation.operationId,original.operationId,id);assert.deepEqual(record.requestBody,original.requestBody);assert.deepEqual(record.parameters,original.parameters??null);assert.deepEqual(record.security,original.security??null);assert.deepEqual(operation.responses,original.responses);assert.deepEqual(operation.security,original.security??[{basic:[]}]);
   const schema=operation.requestBody.content['multipart/form-data'].schema;assert.deepEqual(Object.keys(schema.properties),[contract.part]);assert.equal(schema.properties[contract.part].format,'binary');assert.deepEqual(schema.required,[contract.part]);assert.equal(operation.requestBody.required,true);assert.equal(schema.additionalProperties,false);
   assert.deepEqual(operation.parameters.find(x=>x.name==='X-Atlassian-Token').schema,{type:'string',enum:['no-check'],default:'no-check'});
   operation.requestBody=record.requestBody;if(record.parameters===null)delete operation.parameters;else operation.parameters=record.parameters;if(record.security===null)delete operation.security;else operation.security=record.security;delete operation.servers;delete operation['x-upstream-atlassian-file-request'];
  }
  assert.deepEqual(document,source);assert.equal(JSON.stringify(source),before);
 }
 assert.equal(corrected,8);
});
Then('Atlassian file corrections reject changed declarations atomically',async()=>{
 for(const catalog of Object.keys(data.sources)) {
  const source=await readServiceSchemaUpstream(catalog),contracts=Object.values(data.operations).filter(x=>x.catalog===catalog),target=contracts.at(-1);
  for(const change of [document=>document.info.version+='changed',document=>document.components.schemas.FilePart.properties.inputStream.type='string',document=>originalOperation(document,target).requestBody.content['multipart/form-data'].schema={type:'object'},document=>delete document.paths[target.path],document=>document.servers[0].url='https://other.example.test',document=>originalOperation(document,target).parameters=[{name:'X-Atlassian-Token',in:'header',schema:{type:'string'}}],document=>originalOperation(document,target).security=[],document=>document.components.securitySchemes.basic.scheme='bearer',document=>document.security=[{basic:[]}]]) {
   const document=structuredClone(source);change(document);const before=JSON.stringify(document);assert.throws(()=>bindAtlassianFiles(document),/reviewed native contract/);assert.equal(JSON.stringify(document),before);
  }
  const applied=structuredClone(source);bindAtlassianFiles(applied);assert.throws(()=>bindAtlassianFiles(applied),/reviewed native contract/);
 }
});
Then('all eight native Atlassian file operations send named bytes XSRF headers and private credentials',async()=>{
 let count=0;
 for(const catalog of Object.keys(data.sources)) {
  const document=await readServiceSchema(catalog),models=inspectServiceSchema(document,catalog,selected).operations,strict=extractOperations(scoped(document,catalog),catalog);assert.equal(models.length,strict.length);
  for(const operation of models) {
   assert.equal(operation.unavailableReason,undefined,operation.id);const contract=data.operations[operation.id],input=values(operation),file=fileFor(operation.id),a=await authority(operation,catalog,document);
   assert.deepEqual(operation.fields.filter(x=>x.location==='body').map(x=>x.name),[contract.part]);assert.deepEqual(prepareRequest(operation,input),prepareRequest(strict.find(x=>x.id===operation.id),input));
   let failure;const output=await executeCredentialed(a.descriptor,input,a.binding,a.records,{assertCurrent(){},async fetchRequest(url,init){count++;try {
    const headers=new Headers(init.headers);assert.equal(headers.get('Content-Type'),null);assert.equal(headers.get('X-Atlassian-Token'),'no-check');assert.equal(headers.get('Authorization'),'Basic '+btoa(a.records[0].value+':'+a.records[1].value));
    const expected=contract.path.replace(/\{([^}]+)\}/g,(_,name)=>encodeURIComponent(input['path:'+name]))+(catalog==='bamboo'?'?os_authType=basic':'');assert.equal(String(url),a.origin+expected);assert.equal(new URL(url).pathname.includes('/rest/rest/'),false);
    const encoded=new Request(String(url),init);assert.match(encoded.headers.get('Content-Type'),/multipart\/form-data; boundary=/);const form=await encoded.formData();assert.deepEqual([...form.keys()],[contract.part]);const uploaded=form.get(contract.part);assert.equal(uploaded.name,file.name);assert.equal(uploaded.type,file.mediaType);assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()),catalog==='crowd-dc'?xml:png);
   }catch(error){failure=error;}return Response.json({accepted:true});}});if(failure)throw failure;for(const record of a.records)assert.equal(JSON.stringify(output).includes(record.value),false);
  }
 }
 assert.equal(count,8);
});
Then('Atlassian file uploads reject missing malformed oversized and obsolete Java field inputs before dispatch',async()=>{
 for(const catalog of Object.keys(data.sources)) {
  const document=await readServiceSchema(catalog);for(const operation of inspectServiceSchema(document,catalog,selected).operations) {
   assert.equal(operation.unavailableReason,undefined,operation.id);const contract=data.operations[operation.id],input=values(operation),file=fileFor(operation.id),a=await authority(operation,catalog,document),key='body:'+contract.part;
   for(const invalid of [undefined,null,'{}',JSON.stringify({inputStream:{}}),JSON.stringify({...file,size:file.size+1}),JSON.stringify({...file,size:maxWorkflowUploadBytes+1})]) {
    const values={...input};if(invalid===undefined)delete values[key];else values[key]=invalid;assert.throws(()=>prepareRequest(operation,values),InputValidationError);
    let calls=0;await assert.rejects(()=>executeCredentialed(a.descriptor,values,a.binding,a.records,{assertCurrent(){},async fetchRequest(){calls++;return Response.json({});}}));assert.equal(calls,0);
   }
   const obsolete={'header:X-Atlassian-Token':'no-check','body:inputStream':'{}'};for(const [name,value]of Object.entries(input))if(name.startsWith('path:'))obsolete[name]=value;assert.throws(()=>requestBody(prepareRequest(operation,obsolete)),InputValidationError);
  }
 }
});
