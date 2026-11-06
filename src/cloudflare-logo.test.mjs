// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Then} from '@cucumber/cucumber';
import {bindCloudflareLogo,cloudflareLogoSourceSha256} from './lib/multipart-file-contracts.ts';
import {applySchemaPatches,cloudflareLogoUpload} from './lib/schema-patches.ts';
import {readServiceSchema,readServiceSchemaUpstream} from './lib/service-schema-packs.ts';
import {inspectServiceSchema} from './lib/service-catalog.ts';
import {prepareRequest,InputValidationError} from './lib/operation-input.ts';
import {requestBody} from './lib/request-body.ts';
import {encodeWorkflowBinary,maxWorkflowUploadBytes} from './lib/workflow-binary.ts';
import {operationServerUrl} from './lib/schema-documents.ts';
import {createOperationGraph} from './lib/workflow-graph.ts';
import {validateWorkflowDocument,parseWorkflowDocument} from './lib/workflow-document.ts';
import {approvedOperation} from './lib/secrets/policy.ts';
import {executeCredentialed} from './lib/secrets/execution.ts';

const path='/accounts/{account_id}/brand-protection/logos',id='cloudflare:postAccountsAccountIdBrandProtectionLogos';
const bytes=Uint8Array.of(137,80,78,71,0,255,13,10,43,37,128),file=encodeWorkflowBinary('logo-λ.png',bytes,'image/png');
const values={'path:account_id':'fixture-account','body:image':JSON.stringify(file)};
const patch=document=>applySchemaPatches(document,[cloudflareLogoUpload]);
let cached;
async function model(){
  if(!cached){const document=await readServiceSchema('cloudflare');const operation=inspectServiceSchema(document,'cloudflare',new Set([id])).operations.find(o=>o.id===id);assert.ok(operation && !operation.unavailableReason);cached={document,operation};}
  return cached;
}
async function assertFile(form){
  assert.ok(form instanceof FormData);assert.deepEqual([...form.keys()],['image']);
  const image=form.get('image');assert.equal(image.name,file.name);assert.equal(image.type,'image/png');
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()),bytes);
}
Then('the Cloudflare logo uses its pinned SDK multipart wire contract without changing other source data',async()=>{
  const source=await readServiceSchemaUpstream('cloudflare'),before=JSON.stringify(source);
  assert.equal(createHash('sha256').update(before).digest('hex'),cloudflareLogoSourceSha256);
  assert.match(inspectServiceSchema(source,'cloudflare',new Set([id])).operations[0].unavailableReason,/Binary fields require/);
  const corrected=patch(source),original=source.paths[path].post;
  assert.deepEqual(corrected.paths[path].post['x-upstream-logo-request-body'],original.requestBody);
  assert.deepEqual(corrected.paths[path].post.requestBody,{...original.requestBody,content:{'multipart/form-data':original.requestBody.content['application/x-www-form-urlencoded']}});
  const restored=structuredClone(corrected);delete restored.paths[path].post['x-upstream-logo-request-body'];restored.paths[path].post.requestBody=original.requestBody;
  assert.deepEqual(restored,source);assert.equal(JSON.stringify(source),before);
  const {document,operation}=await model();assert.equal(operation.bodyMediaType,'multipart/form-data');
  const field=operation.fields.find(f=>f.key==='body:image');assert.equal(field.schema.format,'binary');assert.equal(field.required,false);
  const graph=createOperationGraph(operation,{x:0,y:0},'logo-fixture',document);
  const saved=validateWorkflowDocument({version:2,id:crypto.randomUUID(),name:'Logo upload',...graph,viewport:{x:0,y:0,zoom:1},snap:true,curved:true,dashed:false});
  assert.deepEqual(parseWorkflowDocument(JSON.stringify(saved)),saved);
});
Then('changed logo identities destinations and file declarations are rejected before mutation',async()=>{
  const source=await readServiceSchemaUpstream('cloudflare');
  const changes=[d=>{d.info.version='future';},d=>{d.servers[0].url='https://other.example.test';},
    d=>{d.paths[path].post.operationId='other';},d=>{delete d.paths[path];},
    d=>{d.paths[path].post.requestBody.required=false;},d=>{d.paths[path].post.requestBody.content={'multipart/form-data':{schema:{type:'object'}}};},
    d=>{d.components.schemas['brand-protection-api_ImageFile'].properties.image.format='byte';},
    d=>{d.paths[path].post['x-upstream-logo-request-body']={};}];
  for(const change of changes){const document=structuredClone(source);change(document);const before=JSON.stringify(document);assert.throws(()=>bindCloudflareLogo(document),/reviewed source contract/);assert.equal(JSON.stringify(document),before);}
  assert.throws(()=>patch(patch(source)),/reviewed source contract/);
});
Then('logo multipart bodies preserve file bytes names and media while rejecting invalid file envelopes',async()=>{
  const {operation}=await model(),request=prepareRequest(operation,values),body=requestBody(request);
  await assertFile(body);
  const wire=new Request('https://fixture.example.test/upload',{method:'POST',body});
  assert.match(wire.headers.get('content-type'),/^multipart\/form-data; boundary=/);await assertFile(await wire.formData());
  const large={...file,size:maxWorkflowUploadBytes+1,base64:Buffer.alloc(maxWorkflowUploadBytes+1).toString('base64')};
  for(const invalid of [{...file,base64:'invalid!'},large,{...file,name:'bad\r\nname.png'},'logo.png'])
    assert.throws(()=>prepareRequest(operation,{...values,'body:image':JSON.stringify(invalid)}),error=>error instanceof InputValidationError && error.fieldKey==='body:image');
});
Then('an authenticated logo upload sends a file part with unchanged queries and no public token value',async()=>{
  const {document,operation}=await model(),alternative=operation.security.findIndex(option=>option.length===1&&option[0].kind==='bearer');assert.ok(alternative>=0);
  const descriptor=await approvedOperation(operation,operationServerUrl(document,operation)),scheme=operation.security[alternative][0];
  const record={id:crypto.randomUUID(),label:'Logo fixture',value:'SYNTHETIC_LOGO_ACCESS_TOKEN_8312',kind:'secret',grants:[]};
  const binding={alternative,fingerprint:descriptor.fingerprint,credentials:{[scheme.name]:record.id}};let calls=0;
  const result=await executeCredentialed(descriptor,{...values,'query:tag':'fixture logo','query:match_type':'exact','query:threshold':'0'},binding,[record],{assertCurrent(){},async fetchRequest(address,init){
    calls++;const url=new URL(address);assert.equal(url.origin,'https://api.cloudflare.com');assert.equal(url.pathname,'/client/v4/accounts/fixture-account/brand-protection/logos');
    assert.equal(url.searchParams.get('threshold'),'0');assert.equal(url.searchParams.get('tag'),'fixture logo');assert.equal(url.searchParams.get('match_type'),'exact');
    assert.equal(new Headers(init.headers).get('authorization'),'Bearer '+record.value);assert.equal(new Headers(init.headers).get('content-type'),null);
    await assertFile(init.body);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
    return new Response('{"id":1,"tag":"fixture logo","upload_path":"fixture"}',{status:201,headers:{'content-type':'application/json'}});
  }});
  assert.equal(calls,1);assert.ok(!JSON.stringify(result).includes(record.value));
});
