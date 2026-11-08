// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Then} from '@cucumber/cucumber';
import contracts from './lib/commerce-authentication-contracts.json' with {type:'json'};
import frozen from '../tests/commerce-asap-operations.json' with {type:'json'};
import catalogSources from './catalogs/services/index.json' with {type:'json'};
import {bindCommerceAuthentication} from './lib/atlassian-commerce-authentication.ts';
import {applySchemaPatches,commerceAuthentication} from './lib/schema-patches.ts';
import {readServiceSchema,readServiceSchemaUpstream} from './lib/service-schema-packs.ts';
import {inspectServiceSchema} from './lib/service-catalog.ts';
import {extractOperationSecurity} from './lib/operation-security.ts';
import {approvedOperation} from './lib/secrets/policy.ts';
import {executeCredentialed} from './lib/secrets/execution.ts';

const catalog='atlassian-commerce';
const patch=document=>applySchemaPatches(document,[commerceAuthentication]);
let cached;
async function models() {
  if (!cached) {
    const document=await readServiceSchema(catalog);
    cached={document,operations:inspectServiceSchema(document,catalog).operations};
  }
  return cached;
}
async function fixture() {
  const {operations}=await models(),operation=operations.find(o=>o.id===catalog+':GET /v2/invoices');
  const descriptor=await approvedOperation(operation,contracts.server);
  const record={id:crypto.randomUUID(),label:'Commerce fixture',value:'SYNTHETIC_COMMERCE_ACCESS_TOKEN_401_29',kind:'secret',grants:[]};
  const binding={fingerprint:descriptor.fingerprint,alternative:0,credentials:{ASAP:record.id}};
  return {operation,descriptor,record,binding};
}
Then('all 40 Commerce operations require their documented access token through both parsers',async()=>{
  const source=await readServiceSchemaUpstream(catalog),before=JSON.stringify(source);
  assert.equal(createHash('sha256').update(before).digest('hex'),contracts.sourceSha256);
  const {document,operations}=await models(),descriptor=catalogSources.find(item=>item.id===catalog);
  assert.deepEqual(document,applySchemaPatches(source,descriptor.patches));assert.equal(JSON.stringify(source),before);
  assert.deepEqual(document.security,[{ASAP:[]}]);assert.deepEqual(document['x-upstream-security'],null);
  assert.deepEqual(document['x-upstream-security-schemes'],null);
  assert.equal(document.components.securitySchemes.ASAP.type,'http');assert.equal(document.components.securitySchemes.ASAP.scheme,'bearer');
  assert.deepEqual(patch(source).paths,source.paths);
  assert.deepEqual(document.paths,applySchemaPatches(source,descriptor.patches.filter(item=>item.id!==commerceAuthentication.id)).paths);
  assert.deepEqual(document.servers,source.servers);
  assert.deepEqual(document.components.schemas,source.components.schemas);
  assert.equal(frozen.length,6);assert.ok(frozen.every(id=>operations.some(o=>o.id===id)));
  const expected=new Set(Object.keys(contracts.operations).map(id=>catalog+':'+id));
  assert.equal(operations.length,40);assert.deepEqual(new Set(operations.map(o=>o.id)),expected);
  for(const model of operations) {
    assert.equal(model.unavailableReason,undefined,model.id);
    assert.deepEqual(model.security,[[{name:'ASAP',kind:'bearer',header:'Authorization'}]],model.id);
    const native=contracts.operations[model.id.slice(catalog.length+1)];
    // Exercise the strict authentication parser on the exact native operation.
    // Native request schemas separately use the canonical service adapter.
    assert.deepEqual(extractOperationSecurity(document,document.paths[native.path][native.method.toLowerCase()]),model.security);
    assert.ok(!model.security.some(option=>option.length===0));
  }
});
Then('Commerce corrections reject changed requirements identities and destinations before mutation',async()=>{
  const source=await readServiceSchemaUpstream(catalog),id='GET /v2/invoices';
  const changes=[
    d=>{d.info.title='other';},d=>{d.info.version='future';},d=>{d.openapi='3.1.0';},
    d=>{d.servers[0].url='https://unrelated.example.test';},d=>{d.security=[];},
    d=>{d.components.securitySchemes={ASAP:{type:'http',scheme:'basic'}};},
    d=>{d.paths['/v2/invoices'].get.security=[];},d=>{d.paths['/v2/invoices'].get.security=[{ASAP:['unknown']}];},
    d=>{d.paths['/v2/invoices'].get.operationId='other';},d=>{delete d.paths['/v2/invoices'];},
    d=>{d.paths['/v2/invoices'].servers=[{url:'https://unrelated.example.test'}];},
    d=>{d.paths['/v2/invoices'].get.parameters.push({in:'header',name:'Authorization',schema:{type:'string'}});},
    d=>{d['x-upstream-security']=null;},d=>{d.paths['/extra']={get:{operationId:id}};},
  ];
  for(const change of changes) {
    const document=structuredClone(source);change(document);const before=JSON.stringify(document);
    assert.throws(()=>bindCommerceAuthentication(document),/reviewed source contract/);assert.equal(JSON.stringify(document),before);
  }
  assert.throws(()=>patch(patch(source)),/reviewed source contract/);
  assert.throws(()=>applySchemaPatches(source,[commerceAuthentication,commerceAuthentication]),/duplicated/);
});
Then('a saved Commerce token authenticates its exact private request without exposing its value',async()=>{
  const f=await fixture();let calls=0;
  const result=await executeCredentialed(f.descriptor,{'header:X-transaction-account':'fixture-account'},f.binding,[f.record],{
    assertCurrent(){},async fetchRequest(url,init){
      calls++;assert.equal(url,contracts.server+'/v2/invoices');assert.equal(init.method,'GET');
      assert.equal(init.headers.get('authorization'),'Bearer '+f.record.value);
      assert.equal(init.headers.get('X-transaction-account'),'fixture-account');
      assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
      return new Response('{"values":[]}',{headers:{'content-type':'application/json'}});
    }
  });
  assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes(f.record.value));
  assert.ok(!JSON.stringify(f.descriptor).includes(f.record.value));
});
Then('missing changed and reflected Commerce credentials cannot bypass approval or expose token values',async()=>{
  const f=await fixture(),values={'header:X-transaction-account':'fixture-account'};
  const never={assertCurrent(){},async fetchRequest(){assert.fail('Unapproved credentials cannot dispatch');}};
  for(const binding of [{...f.binding,credentials:{}},{...f.binding,fingerprint:'changed'},{...f.binding,alternative:1},{...f.binding,credentials:{Other:f.record.id}}])
    await assert.rejects(()=>executeCredentialed(f.descriptor,values,binding,[f.record],never),{code:'PERMISSION'});
  await assert.rejects(()=>executeCredentialed(f.descriptor,values,f.binding,[],never),{code:'PERMISSION'});
  await assert.rejects(()=>executeCredentialed(f.descriptor,values,f.binding,[f.record],{assertCurrent(){throw new Error('revoked');},fetchRequest:never.fetchRequest}));
  const reflected=await executeCredentialed(f.descriptor,values,f.binding,[f.record],{assertCurrent(){},async fetchRequest(){
    return new Response(JSON.stringify({echo:f.record.value}),{headers:{'content-type':'application/json'}});
  }});
  assert.ok(!JSON.stringify(reflected).includes(f.record.value));
});
