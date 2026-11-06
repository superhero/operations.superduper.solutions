// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Before, After, Then } from '@cucumber/cucumber';
import ids from '../tests/tenant-readiness-operations.json' with { type: 'json' };
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { operationBlockReason, operationInsertionBlockReason, readOperationCapabilities } from './lib/operation-capabilities.ts';
import { createSchemaDiscovery } from './lib/schema-index.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { editAssistantWorkspace } from './lib/assistant/workspace.ts';
import { executeAssistantTool } from './lib/assistant/tools.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { installOperationModel, publishPreparedCatalogs, updateCatalogs } from './lib/catalog.ts';
import { createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { createWorkflowRunner } from './lib/workflow-runner.ts';
import { scopeOperationSchema } from './lib/operation-report.ts';
import { applySchemaPatches, assetsImportSourceParameter } from './lib/schema-patches.ts';
import { supportsCredentialResults } from './lib/credential-results.ts';

const methods = ['get','put','post','delete','patch','options','head','trace'];
const identity = document => Object.entries(document.paths).flatMap(([path, item]) => methods.filter(method => item[method])
  .map(method => [item[method].operationId, method, path]));
Before({ tags: '@tenant-readiness' }, function () { this.tenantCatalogs = catalogs; });
After({ tags: '@tenant-readiness' }, function () { updateCatalogs(this.tenantCatalogs); });

Then('all 316 native tenant operations allow insertion and retain their run guards', async () => {
  assert.equal(new Set(ids).size, 316);
  const found = new Set();
  for (const catalog of ['atlassian-assets', 'confluence']) {
    const document = await readServiceSchema(catalog), source = await readServiceSchemaUpstream(catalog);
    const inspected = inspectServiceSchema(document, catalog, new Set(ids)), discovery = createSchemaDiscovery(inspected, 'tenant-source');
    assert.deepEqual(identity(document), identity(source));
    assert.equal(discovery.summary.unavailableCount, 0);
    for (const operation of inspected.operations) {
      assert.ok(ids.includes(operation.id)); found.add(operation.id);
      assert.equal(operationInsertionBlockReason(operation), undefined, operation.id);
      const descriptor = discovery.operations.find(item => item.id === operation.id);
      assert.equal(operationInsertionBlockReason(descriptor), undefined, operation.id);
      assert.ok(operationBlockReason(operation), operation.id);
      assert.ok(readOperationCapabilities(descriptor).requirements.some(item => item.code === 'server'));
      assert.throws(() => prepareRequest(operation, {}), /Configure/);
      await assert.rejects(approvedOperation(operation, 'https://example.test'), error => error.code === 'PERMISSION');
    }
  }
  assert.equal(found.size, 316);
});

function documentFor(server) {
  return { openapi:'3.1.0', info:{title:'Tenant fixture',version:'1'}, servers:[server], paths:{'/items':{get:{
    operationId:'items', summary:'List items', responses:{'200':{description:'OK'}} }}} };
}
const inspect = document => inspectServiceSchema(document, 'tenant-fixture').operations[0];
Then('tenant readiness distinguishes valid unconfigured routes from invalid contracts', () => {
  for (const server of [{url:'https://no-default/v1'}, {url:'https://api.example.test/tenant/{id}',variables:{id:{default:'<tenantId>'}}}]) {
    const document = documentFor(server), operation = inspect(document);
    assert.equal(operationInsertionBlockReason(operation), undefined);
    assert.ok(operationBlockReason(operation));
    assert.throws(() => prepareRequest(operation, {}));
    const broken = structuredClone(document); broken.paths['/items'].get.parameters = [{name:'token',in:'cookie',schema:{type:'string'}}];
    assert.match(operationInsertionBlockReason(inspect(broken)), /cookie/);
  }
  for (const server of [
    {url:'javascript:alert(1)'}, {url:'https://user:password@example.test/{id}',variables:{id:{default:'<tenantId>'}}},
    {url:'https://api.example.test/{id}'}, {url:'https://api.example.test/{id}',variables:{id:{default:4}}},
    {url:'https://api.example.test/{id}',variables:{id:{default:'<tenantId>/../other'}}},
    {url:'https://api.example.test?tenant={id}',variables:{id:{default:'<tenantId>'}}},
    {url:'/relative/without-parent'}, {url:'https://api.example.test/{id}',variables:{id:{default:'<tenantId>',enum:['actual']}}},
  ]) assert.ok(operationInsertionBlockReason(inspect(documentFor(server))), JSON.stringify(server));
  const legacy = { ...inspect(documentFor({url:'https://example.test'})), unavailableReason:'Legacy limitation' };
  assert.equal(operationInsertionBlockReason(legacy), 'Legacy limitation');
});

Then('an unconfigured tenant graph persists its requirements and rejects all dispatch', async () => {
  const document = documentFor({url:'https://no-default/v1'}), inspected = inspectServiceSchema(document,'tenant-fixture');
  const operation = inspected.operations[0], discovery = createSchemaDiscovery(inspected,'tenant-source');
  const schema = scopeOperationSchema(document, operation.path, operation.method, true).schema;
  publishPreparedCatalogs([{catalog:{id:'tenant-fixture',name:inspected.name,file:'tenant.json',document:discovery.document,
    groups:discovery.groups,execution:{kind:'http',origin:''}},operations:discovery.operations,sourceIdentity:'tenant-source'}]);
  installOperationModel({operation,document:schema,origin:'',sourceIdentity:'tenant-source',bytes:1000});
  const workflow = {version:2,id:'tenant-workflow',name:'Tenant workflow',nodes:[],edges:[],viewport:{x:0,y:0,zoom:1},snap:true,curved:false,dashed:false};
  const edited = editAssistantWorkspace(workflow,{kind:'add_operation',workflowId:workflow.id,operationId:operation.id,x:0,y:0},[],{value:operation,schema});
  const result = edited.document ?? edited;
  assert.ok(result.nodes.some(node => node.data.operationId === operation.id));
  const host = {operations:()=>[operation]};
  const search = await executeAssistantTool(host,{tools:true,editing:true,skills:true},'search_operations',{query:'items',limit:10},new AbortController().signal);
  assert.ok(JSON.stringify(search).includes('Configure an absolute server URL'));
  let calls = 0;
  const execution = createWorkflowRequestExecution(async()=>{calls++; return Response.json({});});
  const caller = {...operation,capabilities:{issues:[]}}; delete caller.unavailableReason;
  await assert.rejects(execution.execute(caller,{}), /Configure/);
  await assert.rejects(approvedOperation(operation,'https://configured.example.test'), error => error.code === 'PERMISSION');
  const node = result.nodes.find(node => node.data.operationId === operation.id);
  const runner = createWorkflowRunner(result,node.id,execution);
  assert.throws(()=>runner.next(), /Configure/); assert.equal(calls,0);
});

Then('the Assets import source parameter correction is scoped and preserves private adoption', async () => {
  const native = await readServiceSchemaUpstream('atlassian-assets'), before = JSON.stringify(native);
  const fixed = applySchemaPatches(native,[assetsImportSourceParameter]);
  const path = '/importsource/{importSourceId}/token', operation = fixed.paths[path].post;
  assert.equal(operation.parameters.length,1); assert.equal(operation.parameters[0].name,'importSourceId');
  assert.equal(operation.parameters[0].required,true); assert.equal(operation.parameters[0].schema.minLength,1);
  assert.equal(operation['x-upstream-parameters'],null);
  const restored = structuredClone(fixed); delete restored.paths[path].post.parameters; delete restored.paths[path].post['x-upstream-parameters'];
  assert.deepEqual(restored,native); assert.equal(JSON.stringify(native),before);
  for (const mutate of [value=>{value.info.version='changed';},value=>{value.paths[path].post.parameters=[];},
    value=>{value.paths[path].post.operationId='other';},value=>{value.servers[0].url='https://other.example.test';}]) {
    const changed=structuredClone(native);mutate(changed);
    assert.throws(()=>applySchemaPatches(changed,[assetsImportSourceParameter]), /reviewed source contract/);
  }
  assert.throws(()=>applySchemaPatches(fixed,[assetsImportSourceParameter]), /reviewed source contract/);
  const document = await readServiceSchema('atlassian-assets');
  const selected = inspectServiceSchema(document,'atlassian-assets',new Set([`atlassian-assets:POST ${path}`])).operations[0];
  assert.ok(supportsCredentialResults(selected));
  assert.equal(operationInsertionBlockReason(selected),undefined);
  const descriptor=serviceSchemaDescriptors.find(item=>item.id==='atlassian-assets');
  assert.ok(descriptor.patches.some(patch=>patch.id===assetsImportSourceParameter.id));
});
