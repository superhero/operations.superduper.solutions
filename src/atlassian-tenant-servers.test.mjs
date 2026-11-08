// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import ids from '../tests/server-variable-operations.json' with {type:'json'};
import { atlassianTenantServerSources } from './lib/atlassian-tenant-servers.ts';
import { applySchemaPatches, atlassianTenantServers, schemaPatchName } from './lib/schema-patches.ts';
import { readServiceSchema, readServiceSchemaUpstream, serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { operationBlockReason, operationInsertionBlockReason, readOperationCapabilities } from './lib/operation-capabilities.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';

const cloud = '11223344-a1b2-4333-b444-def123456789';
const selections = [
  ['atlassian-customer-service-management','/api/v1/product',{},'/jsm/csm/cloudid/'],
  ['atlassian-forms','/export/{exportId}',{'path:exportId':'export-1'},'/jira/forms/cloud/'],
  ['atlassian-migration-utilities','/jobs/status',{'query:product':'jira','query:productURL':'https://synthetic.atlassian.net'},'/links/v1/'],
];
const inspect = (document,catalog,id) => inspectServiceSchema(document,catalog,new Set([id])).operations[0];
const configure = document => {
  for (const server of document.servers) for (const variable of Object.values(server.variables)) variable.default=cloud;
  return document;
};

Then('all 100 Atlassian tenant operations preserve their contracts and insertion readiness', async()=>{
  const found = new Set(); assert.equal(new Set(ids).size,100);
  for (const catalog of Object.keys(atlassianTenantServerSources)) {
    const native=await readServiceSchemaUpstream(catalog),document=await readServiceSchema(catalog);
    assert.deepEqual(document.paths,native.paths); assert.deepEqual(document.components,native.components);
    assert.deepEqual(document.security,native.security); assert.deepEqual(document['x-upstream-servers'],native.servers);
    assert.deepEqual(document.servers.map(server=>server.url),native.servers.map(server=>server.url));
    for (const operation of inspectServiceSchema(document,catalog,new Set(ids)).operations) {
      found.add(operation.id); assert.equal(operationInsertionBlockReason(operation),undefined,operation.id);
      assert.match(operationBlockReason(operation),/Configure the (Cloud|Site) ID/);
      assert.ok(readOperationCapabilities(operation).requirements.some(item=>item.code==='server'));
      assert.throws(()=>operationServerUrl(document,operation),/Configure/);
      await assert.rejects(approvedOperation(operation,'https://api.atlassian.com'),error=>error.code==='PERMISSION');
    }
  }
  assert.deepEqual(found,new Set(ids));
});

Then('Atlassian tenant declarations are pinned scoped and atomic', async()=>{
  assert.equal(schemaPatchName(atlassianTenantServers),'Atlassian tenant server variables');
  for (const catalog of Object.keys(atlassianTenantServerSources)) {
    const native=await readServiceSchemaUpstream(catalog),before=JSON.stringify(native);
    const descriptor=serviceSchemaDescriptors.find(item=>item.id===catalog);
    assert.equal(createHash('sha256').update(before).digest('hex'),atlassianTenantServerSources[catalog]);
    assert.ok(descriptor.patches.some(patch=>patch.id===atlassianTenantServers.id));
    const fixed=applySchemaPatches(native,[atlassianTenantServers]),restored=structuredClone(fixed);
    restored.servers=restored['x-upstream-servers']; delete restored['x-upstream-servers'];
    assert.deepEqual(restored,native); assert.equal(JSON.stringify(native),before);
    for (const mutate of [
      value=>{value.info.version='new';},value=>{value.info.title='Other';},value=>{value.openapi='3.2.0';},
      value=>{value.servers[0].url='https://other.example.test/{cloudId}';},
      value=>{value.servers[0].variables={cloudId:{default:cloud}};},
      value=>{value['x-upstream-servers']=[];},
      value=>{const item=Object.values(value.paths)[0];item.servers=[{url:'https://other.example.test'}];},
      value=>{const item=Object.values(value.paths)[0];const operation=Object.values(item).find(value=>value?.operationId);operation.operationId='other';},
    ]) {
      const changed=structuredClone(native);mutate(changed);const snapshot=JSON.stringify(changed);
      assert.throws(()=>applySchemaPatches(changed,[atlassianTenantServers]),/reviewed source contract/);
      assert.equal(JSON.stringify(changed),snapshot);
    }
    assert.throws(()=>applySchemaPatches(fixed,[atlassianTenantServers]),/reviewed source contract/);
  }
});

Then('Atlassian tenant identities are validated before private dispatch and bound to approval', async()=>{
  let calls=0;
  for (const [catalog,path,values,prefix] of selections) {
    const document=configure(await readServiceSchema(catalog)),id=`${catalog}:GET ${path}`;
    const operation=inspect(document,catalog,id),origin=operationServerUrl(document,operation);
    assert.equal(operationBlockReason(operation),undefined);
    const expectedPrefix=prefix+cloud,expectedOrigin='https://api.atlassian.com'+expectedPrefix;
    assert.equal(origin,expectedOrigin);
    const descriptor=await approvedOperation(operation,origin),alternative=operation.security.findIndex(option=>option.length&&option.every(scheme=>['basic','bearer','apiKey'].includes(scheme.kind)));
    assert.ok(alternative>=0);
    const credentials=[],choices={};
    const secret=(label)=>{const record={id:crypto.randomUUID(),label,kind:'secret',value:`atlassian-variable-canary-${credentials.length}-257392`,grants:[]};credentials.push(record);return record.id;};
    for (const scheme of operation.security[alternative]) choices[scheme.name]=scheme.kind==='basic'?{username:secret('Username'),password:secret('Password')}:secret(scheme.name);
    const binding={alternative,fingerprint:descriptor.fingerprint,credentials:choices};
    const result=await executeCredentialed(descriptor,values,binding,credentials,{assertCurrent(){},fetchRequest:async(url,init)=>{
      calls++;const request=new URL(url);assert.equal(request.origin,'https://api.atlassian.com');
      assert.equal(request.pathname,expectedPrefix+path.replace('{exportId}','export-1'));
      assert.match(new Headers(init.headers).get('Authorization'),/^(Bearer|Basic) /);
      if (catalog==='atlassian-migration-utilities') {assert.equal(request.searchParams.get('product'),'jira');assert.equal(request.searchParams.get('productURL'),values['query:productURL']);}
      return Response.json({ok:true,echo:credentials.map(item=>item.value)});
    }});
    for (const credential of credentials) assert.equal(JSON.stringify(result).includes(credential.value),false);
    for (const value of ['',undefined,Object.keys(document.servers[0].variables)[0],'<cloudId>','<siteId>','../other','a/b','a?b=1','a#b','a\\b','%2e%2e','a'.repeat(129)]) {
      const changed=structuredClone(document),slot=Object.keys(changed.servers[0].variables)[0];changed.servers[0].variables[slot].default=value;
      const unavailable=inspect(changed,catalog,id);assert.ok(operationBlockReason(unavailable),String(value));
      assert.throws(()=>operationServerUrl(changed,unavailable));
      await assert.rejects(approvedOperation(unavailable,origin),error=>error.code==='PERMISSION');
    }
    const changed=structuredClone(document),slot=Object.keys(changed.servers[0].variables)[0];changed.servers[0].variables[slot].default='22334455-b1c2-4333-b444-def123456789';
    const current=inspect(changed,catalog,id),next=await approvedOperation(current,operationServerUrl(changed,current));
    assert.notEqual(next.fingerprint,descriptor.fingerprint);
    await assert.rejects(executeCredentialed(next,values,binding,credentials,{assertCurrent(){},fetchRequest:async()=>{calls++;return Response.json({});}}),error=>error.code==='PERMISSION');
    if (catalog==='atlassian-forms') {
      const other=structuredClone(document);other.servers.reverse();
      assert.equal(operationServerUrl(other,operation),`https://api.atlassian.com/ex/jira/${cloud}/forms`);
    }
  }
  assert.equal(calls,3);
});
