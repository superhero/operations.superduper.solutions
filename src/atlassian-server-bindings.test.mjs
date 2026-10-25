// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { atlassianServerBindings, providerPathBindings, applySchemaPatches, schemaPatchName } from './lib/schema-patches.ts';
import { atlassianAssetsServer, atlassianServerBindingSources } from './lib/atlassian-server-bindings.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { parseSchemaDocument, operationServerUrl } from './lib/schema-documents.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const assets='atlassian-assets', jsm='jira-service-management-ops', cloud='11223344-a1b2-3b33-c444-def123456789', workspace='g2778e1d-939d-581d-c8e2-9d5g59de456b';
const subscriber='/stakeholder-comms/cloudId/{cloudId}/api/subscribers/delete';
const ids = document => Object.entries(document.paths).flatMap(([path,item]) => Object.entries(item).filter(([method]) => ['get','post','put','patch','delete','head','options','trace'].includes(method)).map(([method,operation]) => [path,method,operation.operationId]));
const inspect=(document,pack,id)=>inspectServiceSchema(document,pack,new Set([id])).operations[0];
async function configured() {
  const document=await readServiceSchema(assets);document.servers[0].variables.cloudId.default=cloud;document.servers[0].variables.workspaceId.default=workspace;return document;
}
function credentials(descriptor) {
  const username=crypto.randomUUID(),password=crypto.randomUUID(),scheme=descriptor.operation.security[0][0];
  return { records:[{id:username,label:'Synthetic token',kind:'secret',value:'atlassian-server-private-canary-9172',grants:[]},
    {id:password,label:'Synthetic password',kind:'secret',value:'atlassian-server-password-canary-9172',grants:[]}],binding:{fingerprint:descriptor.fingerprint,alternative:0,
      credentials:{[scheme.name]:scheme.kind==='basic'?{username,password}:username}} };
}
async function state(kind) {
  const document=await configured(),path=kind==='AQL'?'/object/aql':'/icon/{id}',method=kind==='AQL'?'POST':'GET';
  const operation=inspect(document,assets,`${assets}:${method} ${path}`);assert.equal(operation.unavailableReason,undefined);
  const origin=operationServerUrl(document,operation),descriptor=await approvedOperation(operation,origin);
  return {document,operation,origin,descriptor,authority:credentials(descriptor),values:kind==='AQL'?{'body:qlQuery':'objectType = Office AND Name LIKE SYD','query:maxResults':'10'}:{'path:id':'68'}};
}
Then('the Assets correction preserves its source and requires both server identities',async()=>{
  const raw=await readServiceSchemaUpstream(assets),before=JSON.stringify(raw),document=await readServiceSchema(assets),server=document.servers[0];
  assert.equal(createHash('sha256').update(before).digest('hex'),atlassianServerBindingSources[assets]);assert.equal(serviceSchemaDescriptors.find(value=>value.id===assets).sha256,atlassianServerBindingSources[assets]);
  assert.deepEqual(ids(document),ids(raw));assert.equal(ids(document).length,64);assert.equal(server.url,atlassianAssetsServer);
  assert.equal(server.variables.cloudId.default,'<cloudId>');assert.equal(server.variables.workspaceId.default,'<workspaceId>');
  assert.deepEqual(server.variables.version,raw.servers[0].variables.version);assert.deepEqual(document['x-upstream-servers'],raw.servers);
  const models=inspectServiceSchema(document,assets).operations;assert.equal(models.length,64);
  for(const operation of models)assert.ok(operation.capabilities.issues.some(issue=>issue.area==='endpoint'&&/Assets Cloud ID/.test(issue.message)),operation.id);
  assert.equal(JSON.stringify(raw),before);assert.equal(schemaPatchName(atlassianServerBindings),'Atlassian server identities');
});
Then('configured Assets server variables retain exact HTTPS prefixes and legacy limitations',async()=>{
  const original=await configured();
  // This is the same parse/service-inspection path used by Schemas > Replace.
  const document=parseSchemaDocument(JSON.stringify(original),'configured-assets.json');
  for(const [path,method] of [['/object/aql','POST'],['/icon/{id}','GET'],['/aql/objects','GET']]){
    const operation=inspect(document,assets,`${assets}:${method} ${path}`);assert.equal(operationServerUrl(document,operation),`https://api.atlassian.com/ex/jira/${cloud}/jsm/assets/workspace/${workspace}/v1`);
    assert.equal(operation.id,`${assets}:${method} ${path}`);
  }
  assert.equal(document.paths['/aql/objects'].get.deprecated,true);assert.deepEqual(document.paths['/aql/objects'].get.security,[{connectJWT:[]}]);
  assert.match(document.paths['/aql/objects'].get.description,/deprecated/);assert.deepEqual(document,original);
});
Then('the configured Assets {string} operation prepares its exact private destination',async kind=>{
  const s=await state(kind);let captured;
  await executeCredentialed(s.descriptor,s.values,s.authority.binding,s.authority.records,{assertCurrent(){},fetchRequest:async(url,init)=>{captured={url:String(url),init};return Response.json({accepted:true});}});
  assert.ok(captured);const url=new URL(captured.url);assert.equal(url.origin,'https://api.atlassian.com');
  assert.equal(url.pathname,`/ex/jira/${cloud}/jsm/assets/workspace/${workspace}/v1/${kind==='AQL'?'object/aql':'icon/68'}`);
  assert.equal(new Headers(captured.init.headers).get('Authorization'),`Bearer ${s.authority.records[0].value}`);
  if(kind==='AQL'){assert.deepEqual(JSON.parse(captured.init.body),{qlQuery:'objectType = Office AND Name LIKE SYD'});assert.equal(url.searchParams.get('maxResults'),'10');}
  assert.ok(!captured.url.includes(s.authority.records[0].value));
});
Then('Assets server slots reject missing placeholders and path fragments before private approval',async()=>{
  let calls=0;
  for(const name of ['cloudId','workspaceId'])for(const value of [undefined,'',' ',name,'<unconfigured>','{site}','%7Bsite%7D','../other','site/other','site?x=1','site#other','site\\other','a'.repeat(129)]){
    const document=await configured();document.servers[0].variables[name].default=value;const operation=inspect(document,assets,`${assets}:GET /icon/{id}`);
    assert.ok(operation.unavailableReason);assert.throws(()=>operationServerUrl(document,operation),/Configure the Assets/);
    await assert.rejects(async()=>{const descriptor=await approvedOperation(operation,operationServerUrl(document,operation)),authority=credentials(descriptor);await executeCredentialed(descriptor,{'path:id':'68'},authority.binding,authority.records,{assertCurrent(){},fetchRequest:async()=>{calls++;return Response.json({});}});});
  }assert.equal(calls,0);
  for(const url of ['http://api.atlassian.com/ex/jira/{cloudId}/jsm/assets/workspace/{workspaceId}/v1','https://other.example.test/{cloudId}/{workspaceId}']){
    const document=await configured();document.servers[0].url=url;assert.throws(()=>operationServerUrl(document,{path:'/icon/{id}',method:'GET'}),/reviewed HTTPS server template/);
  }
});
Then('changing either Assets server identity rejects the previous private binding',async()=>{
  const s=await state('icon');let calls=0;
  for(const name of ['cloudId','workspaceId']){
    const document=structuredClone(s.document);document.servers[0].variables[name].default='changed-site-or-workspace';
    const operation=inspect(document,assets,s.operation.id),origin=operationServerUrl(document,operation),descriptor=await approvedOperation(operation,origin);assert.notEqual(origin,s.origin);assert.notEqual(descriptor.fingerprint,s.descriptor.fingerprint);
    await assert.rejects(executeCredentialed(descriptor,s.values,s.authority.binding,s.authority.records,{assertCurrent(){},fetchRequest:async()=>{calls++;return Response.json({});}}),error=>error.code==='PERMISSION');
  }assert.equal(calls,0);
});
Then('the corrected JSM subscriber deletion retains native identity and exact private preparation',async()=>{
  const raw=await readServiceSchemaUpstream(jsm),source=await readServiceSchema(jsm);assert.deepEqual(ids(source),ids(raw));assert.equal(ids(source).length,240);
  assert.equal(source.paths[subscriber].servers,undefined);assert.deepEqual(source.paths[subscriber]['x-upstream-servers'],raw.paths[subscriber].servers);
  const operation=inspect(source,jsm,`${jsm}:POST ${subscriber}`);assert.equal(operation.unavailableReason,undefined);assert.equal(operationServerUrl(source,operation),'https://api.atlassian.com/jsm/ops');
  assert.ok(operation.fields.find(field=>field.name==='cloudId').required);assert.equal(operation.security[1][0].kind,'unsupported');
  const descriptor=await approvedOperation(operation,operationServerUrl(source,operation)),authority=credentials(descriptor);let captured;
  await executeCredentialed(descriptor,{'path:cloudId':cloud,'body:ids':'["subscriber-1","subscriber-2"]'},authority.binding,authority.records,{assertCurrent(){},fetchRequest:async(url,init)=>{captured={url:String(url),init};return Response.json({success:true});}});
  assert.equal(captured.url,`https://api.atlassian.com/jsm/ops/stakeholder-comms/cloudId/${cloud}/api/subscribers/delete`);assert.deepEqual(JSON.parse(captured.init.body),{ids:['subscriber-1','subscriber-2']});assert.match(new Headers(captured.init.headers).get('Authorization'),/^Basic /);
  assert.throws(()=>prepareRequest(operation,{'body:ids':'[]'}),/required/);
  const previous=applySchemaPatches(raw,[providerPathBindings]);previous.paths[subscriber].servers[0].variables={cloudId:{default:cloud}};
  const oldOperation=inspect(previous,jsm,operation.id),oldDescriptor=await approvedOperation(oldOperation,operationServerUrl(previous,oldOperation)),oldAuthority=credentials(oldDescriptor);
  assert.notEqual(oldDescriptor.fingerprint,descriptor.fingerprint);let calls=0;
  await assert.rejects(executeCredentialed(descriptor,{'path:cloudId':cloud,'body:ids':JSON.stringify(['subscriber-1'])},oldAuthority.binding,oldAuthority.records,{assertCurrent(){},fetchRequest:async()=>{calls++;return Response.json({success:true});}}),error=>error.code==='PERMISSION');assert.equal(calls,0);
});
Then('Atlassian server recipes reject drift ambiguous variables and incorrect patch ordering',async()=>{
  const source=await readServiceSchemaUpstream(assets);
  for(const edit of [d=>d.info.version='2',d=>d.servers[0].url='https://other.example.test',d=>d.servers[0].variables.cloudId={default:'guessed'},d=>d.servers[0].variables.workspaceId.default='guessed',d=>d.paths['/icon/{id}'].get.operationId='other']){
    const changed=structuredClone(source);edit(changed);const before=JSON.stringify(changed);assert.throws(()=>applySchemaPatches(changed,[atlassianServerBindings]),/reviewed source contract/);assert.equal(JSON.stringify(changed),before);
  }
  const raw=await readServiceSchemaUpstream(jsm);assert.throws(()=>applySchemaPatches(raw,[atlassianServerBindings]),/reviewed source contract/);
  const changed=applySchemaPatches(raw,[providerPathBindings]);changed.paths[subscriber].servers[0].url='https://other.example.test';assert.throws(()=>applySchemaPatches(changed,[atlassianServerBindings]),/reviewed source contract/);
  assert.throws(()=>applySchemaPatches(source,[atlassianServerBindings,atlassianServerBindings]),/duplicated|reviewed source contract/);
});
Then('Atlassian server qualification leaves Compass and unrelated URL rules intact',async()=>{
  const raw=await readServiceSchemaUpstream('atlassian-compass'),before=JSON.stringify(raw);assert.throws(()=>applySchemaPatches(raw,[atlassianServerBindings]),/reviewed source contract/);assert.equal(JSON.stringify(raw),before);
  const models=inspectServiceSchema(await readServiceSchema('atlassian-compass'),'atlassian-compass').operations;assert.equal(models.length,11);assert.ok(models.every(operation=>!operation.unavailableReason));
  const document={openapi:'3.1.0',info:{title:'Unrelated',version:'1'},servers:[{url:'https://{host}/v{version}',variables:{host:{default:'api.example.test'},version:{default:'2'}}}],paths:{'/items':{get:{operationId:'list',responses:{200:{description:'OK'}}}}}};
  assert.equal(operationServerUrl(document,{path:'/items',method:'GET'}),'https://api.example.test/v2');
});
