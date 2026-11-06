// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import operations from '../tests/credential-result-operations.json' with {type:'json'};
import { resultModels,requestFixture,responseFixture,noSecrets,privateVault } from '../tests/credential-results/fixture.mjs';
import { credentialResultProfile,privateResultVersion,readCredentialResultContracts,supportsCredentialResults } from './lib/credential-results.ts';
import { prepareCredentialResults } from './lib/secrets/credential-results.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed,CredentialResponseError } from './lib/secrets/execution.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { VaultError,vaultLimits } from './lib/secrets/types.ts';
import { applySchemaPatches,privateCredentialResults } from './lib/schema-patches.ts';
import { readServiceSchemaUpstream,serviceSchemaDescriptors } from './lib/service-schema-packs.ts';
import { createWorkflowExecution,createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { publishPreparedCatalogs,operationSourceIdentity,operations as installed } from './lib/catalog.ts';
import { catalogs } from './lib/catalog-registry.ts';

const denied=error=>error instanceof VaultError&&error.code==='PERMISSION';
const withheld=secrets=>error=>{assert.ok(error instanceof CredentialResponseError);assert.equal(error.response.body,null);assert.deepEqual(error.response.headers,{});noSecrets([error.message,error.response],secrets);return true;};

Then('all 27 native credential result requests preserve their wire contract and return only references',async()=>{
  const {models}=await resultModels();assert.equal(operations.length,27);
  for(const id of operations){
    const operation=models.get(id);assert.ok(operation,id);assert.equal(operation.unavailableReason,undefined,id);assert.equal(supportsCredentialResults(operation),true);
    const contract=credentialResultProfile(operation),f=await requestFixture(operation),reply=responseFixture(contract);let fetches=0,adoptions=0,checks=0;
    const refs=reply.values.map(()=>({credentialId:crypto.randomUUID(),label:'Acquired synthetic value'}));
    const result=await executeCredentialed(f.descriptor,f.values,f.binding,f.credentials,{variables:f.variables.length?f.variables:undefined,
      assertCurrent(){checks++;},onProgress(){assert.fail('Private result streamed');},onValue(){assert.fail('Private value published');},
      adoptPrivateResults:async acquired=>{adoptions++;assert.deepEqual(acquired.map(item=>item.value),reply.values);return refs;},
      fetchRequest:async(url,init)=>{fetches++;assert.equal(new URL(url).origin,f.descriptor.origin);assert.equal(init.method,operation.method);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
        const path=new URL(url).pathname;assert.ok(!path.includes('{'));assert.equal(init.headers.get('Accept'),'application/json');
        for(const scheme of operation.security?.[f.binding.alternative]??[]){const choice=f.binding.credentials[scheme.name];
          const value=scheme.kind==='basic'?'Basic '+btoa(f.credentials.find(item=>item.id===choice.username).value+':'+f.credentials.find(item=>item.id===choice.password).value)
            :f.credentials.find(item=>item.id===choice).value;
          assert.equal(init.headers.get(scheme.header),scheme.kind==='bearer'?'Bearer '+value:value);}
        return Response.json(reply.body,{status:reply.status,headers:{'x-untrusted-private-result':encodeURIComponent(reply.values[0])}});}});
    assert.equal(fetches,1);assert.equal(adoptions,1);assert.ok(checks>=2);assert.equal(result.response.status,reply.status);
    assert.equal(result.response.headers['x-untrusted-private-result'],undefined);noSecrets(result,[...reply.values,...f.credentials.map(item=>item.value)]);
    const path=contract.responses[0].path;let leaf=result.response.body;
    for(const segment of path)leaf=leaf[segment==='*'?0:segment];assert.deepEqual(leaf,refs[0]);
    let parent=result.response.body;for(const segment of path.slice(0,-1))parent=parent[segment==='*'?0:segment];
    assert.equal(parent.stable_metadata,undefined);
  }
});

Then('private result projections preserve upstream contracts and reject drift and forged profiles',async()=>{
  const {models,documents,contracts}=await resultModels();assert.equal(Object.keys(contracts.profiles).length,47);
  for(const [catalog,pin]of Object.entries(contracts.sources)){
    const native=await readServiceSchemaUpstream(catalog);assert.equal(createHash('sha256').update(JSON.stringify(native)).digest('hex'),pin.sha256);
    const descriptor=serviceSchemaDescriptors.find(item=>item.id===catalog),before=applySchemaPatches(native,descriptor.patches.filter(patch=>patch.id!==privateCredentialResults.id));
    const fixed=applySchemaPatches(before,[privateCredentialResults]),restored=structuredClone(fixed);assert.deepEqual(fixed,documents.get(catalog));
    for(const [id,contract]of Object.entries(contracts.profiles).filter(([,profile])=>profile.catalog===catalog)){
      const target=restored.paths[contract.path][contract.method.toLowerCase()],raw=before.paths[contract.path][contract.method.toLowerCase()];
      assert.deepEqual(target['x-upstream-private-result-responses'],raw.responses,id);target.responses=target['x-upstream-private-result-responses'];delete target['x-upstream-private-result-responses'];delete target['x-operations-private-result'];
      if(contract.exampleOnly)delete target['x-operations-credential-result'];
    }
    assert.deepEqual(restored,before);assert.deepEqual(fixed.components,before.components,'Shared schemas were mutated');
    for(const mutate of[doc=>{doc.info.version='changed';},doc=>{const c=Object.values(contracts.profiles).find(item=>item.catalog===catalog);doc.paths[c.path][c.method.toLowerCase()].operationId='other';},
      doc=>{const c=Object.values(contracts.profiles).find(item=>item.catalog===catalog);doc.paths[c.path][c.method.toLowerCase()]['x-upstream-private-result-responses']={};}]){
      const changed=structuredClone(before);mutate(changed);const prior=JSON.stringify(changed);assert.throws(()=>applySchemaPatches(changed,[privateCredentialResults]),/reviewed source response contract/);assert.equal(JSON.stringify(changed),prior);}
  }
  const original=models.get(operations[0]);
  const markerOnly=structuredClone(original);delete markerOnly.credentialResult;
  await assert.rejects(approvedOperation(markerOnly,'https://api.elevenlabs.io'),denied);assert.throws(()=>prepareRequest(markerOnly,{}),/returns credentials/);
  for(const change of[{method:'DELETE'},{path:'/unknown'},{id:'unknown:token'},{responseStream:'ndjson'},{credentialResult:false},{credentialResultProfile:'arbitrary'}]){
    const changed={...original,...change};assert.equal(supportsCredentialResults(changed),false);await assert.rejects(approvedOperation(changed,'https://api.elevenlabs.io'),denied);}
});

Then('private result extraction handles nullable nested arrays masks and multiple secret leaves',()=>{
  const {profiles}=readCredentialResultContracts(),ref=()=>({credentialId:crypto.randomUUID(),label:'Acquired'});
  const nested=profiles['elevenlabs:get_agent_link_route'];
  for(const body of[{}, {token:null}])assert.deepEqual(prepareCredentialResults(nested,200,body).complete([]),body);
  assert.throws(()=>prepareCredentialResults(nested,200,{token:{}}),VaultError);
  const nestedResult=prepareCredentialResults(nested,200,{token:{agent_id:'agent-1',conversation_token:'token-value',expiration_time_unix_secs:123}});
  assert.equal(nestedResult.complete([ref()]).token.agent_id,'agent-1');
  const webhook=profiles['github:apps/get-webhook-config-for-app'];
  for(const secret of['********','"********"','']){const prepared=prepareCredentialResults(webhook,200,{secret,url:'https://hooks.example.test'});assert.equal(prepared.values.length,0);assert.deepEqual(prepared.complete([]),{secret:null,url:'https://hooks.example.test'});}
  assert.deepEqual(prepareCredentialResults(webhook,200,{url:'https://hooks.example.test',surprise_secret:'unreviewed-value'}).complete([]),{url:'https://hooks.example.test'});
  const array=profiles['github:secret-scanning/list-alerts-for-repo'];
  const prepared=prepareCredentialResults(array,200,[{number:1,secret:'same-private-value'},{number:2,secret:'same-private-value'}, {number:3}]);
  assert.equal(prepared.values.length,1);const reference=ref(),body=prepared.complete([reference]);assert.deepEqual(body[0].secret,reference);assert.deepEqual(body[1].secret,reference);assert.equal(body[2].number,3);
  const multiple=profiles['github:apps/create-from-manifest'],reply=responseFixture(multiple),result=prepareCredentialResults(multiple,201,reply.body);
  assert.equal(result.values.length,3);assert.ok(result.complete(result.values.map(ref)).client_secret.credentialId);
  assert.equal(prepareCredentialResults(array,200,[]).values.length,0);
  assert.throws(()=>prepareCredentialResults(array,200,{secret:'value'}),VaultError);
  assert.throws(()=>prepareCredentialResults(array,200,Array.from({length:vaultLimits.records+1},()=>({secret:'value'}))),VaultError);
});

Then('credential results survive vault lock and unlock without entering public records or transport',async()=>{
  const {models}=await resultModels(),operation=models.get('elevenlabs:public_get_media_info'),f=await requestFixture(operation),vault=await privateVault();
  const secret='signed-url-秘密\ncredentials-653627',previous=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({signed_url:secret,content_type:'audio/mpeg',name:secret,echo:secret});};
  try{
    const result=await vault.session.execute(f.descriptor,f.values,f.binding),reference=result.response.body.signed_url;
    noSecrets(result,[secret]);assert.equal(result.response.body.content_type,'audio/mpeg');assert.equal(result.response.body.name,'');assert.equal(await vault.session.copyCredential(reference.credentialId),secret);
    const summaries=await vault.session.list();assert.equal(summaries.length,1);assert.equal(summaries[0].kind,'secret');assert.equal(Object.hasOwn(summaries[0],'value'),false);
    noSecrets(vault.storage.state,[secret]);noSecrets(await vault.session.backup(),[secret]);
    vault.session.lock();await assert.rejects(vault.session.execute(f.descriptor,f.values,f.binding),error=>error instanceof VaultError&&error.code==='LOCKED');assert.equal(calls,1);
    await vault.session.unlock(vault.proof);assert.equal(await vault.session.copyCredential(reference.credentialId),secret);
    const second=await vault.session.execute(f.descriptor,f.values,f.binding);assert.equal(second.response.body.signed_url.credentialId,reference.credentialId);assert.equal((await vault.session.list()).length,1);
    const transport={id:'private-test:read',method:'GET',path:'/',fields:[],bodyRequired:false,security:[[{name:'Key',kind:'apiKey',header:'x-key'}]]};
    const approved=await approvedOperation(transport,'https://transport.example.test');
    await assert.rejects(vault.session.execute(approved,{}, {alternative:0,fingerprint:approved.fingerprint,credentials:{Key:reference.credentialId}}),error=>error instanceof VaultError&&error.code==='INVALID');assert.equal(calls,2);
  }finally{globalThis.fetch=previous;vault.session.lock();}
});

Then('interrupted acquisitions return a safe unconfirmed result without partial storage',async()=>{
  const {models}=await resultModels(),operation=models.get('elevenlabs:public_get_media_info'),f=await requestFixture(operation),previous=globalThis.fetch;
  const secret='private-unconfirmed-908641';
  try{for(const reason of['lock','cancel','source','conflict']){
    const vault=await privateVault(),controller=new AbortController();let calls=0;
    globalThis.fetch=async()=>{calls++;if(reason==='lock')vault.session.lock();if(reason==='cancel')controller.abort();if(reason==='source')vault.live=false;if(reason==='conflict')vault.storage.fail=true;return Response.json({signed_url:secret});};
    await assert.rejects(vault.session.execute(f.descriptor,f.values,f.binding,controller.signal),withheld([secret]));assert.equal(calls,1);assert.equal(vault.storage.state.snapshot.records.length,0);vault.session.lock();
  }
  const vault=await privateVault();vault.storage.afterSave=()=>vault.session.lock();globalThis.fetch=async()=>Response.json({signed_url:secret});
  await assert.rejects(vault.session.execute(f.descriptor,f.values,f.binding),withheld([secret]));assert.equal(vault.storage.state.snapshot.records.length,1);
  vault.storage.afterSave=undefined;await vault.session.unlock(vault.proof);const [summary]=await vault.session.list();assert.equal(await vault.session.copyCredential(summary.id),secret);vault.session.lock();
  }finally{globalThis.fetch=previous;}
});

Then('failed credential result responses never publish raw bodies headers or stream samples',async()=>{
  const {models}=await resultModels(),operation=models.get('elevenlabs:public_get_media_info'),f=await requestFixture(operation),secret='private-error-result-59208';
  for(const response of[
    ()=>Response.json({signed_url:secret},{status:403,headers:{'x-secret':secret}}),
    ()=>new Response('not-json '+secret,{headers:{'content-type':'application/json','x-secret':secret}}),
    ()=>Response.json({signed_url:123,echo:secret}),()=>Response.json({echo:secret}),
    ()=>Response.json({signed_url:'é'.repeat(vaultLimits.secretBytes)}),()=>Response.json({signed_url:'\ud800'}),
    ()=>new Response('event: token\ndata: '+secret+'\n\n',{headers:{'content-type':'text/event-stream'}})
  ]){let calls=0,adoptions=0;await assert.rejects(executeCredentialed(f.descriptor,f.values,f.binding,[],{assertCurrent(){},
    adoptPrivateResults:async()=>{adoptions++;return[];},onValue(){assert.fail('Private sample escaped');},onProgress(){assert.fail('Private response progress');},
    fetchRequest:async()=>{calls++;return response();}}),withheld([secret]));assert.equal(calls,1);assert.equal(adoptions,0);}
});

Then('credential-producing requests refuse plaintext token inputs and unknown destinations',async()=>{
  const {models}=await resultModels(),operation=models.get('github:apps/check-token'),f=await requestFixture(operation);let calls=0;
  const options={assertCurrent(){},adoptPrivateResults:async()=>[],fetchRequest:async()=>{calls++;return Response.json({token:'new-token'});}};
  await assert.rejects(executeCredentialed(f.descriptor,{'path:client_id':'synthetic','body:access_token':'raw-private-token'},f.binding,f.credentials,options),denied);assert.equal(calls,0);
  await assert.rejects(executeCredentialed(f.descriptor,f.values,f.binding,f.credentials,{assertCurrent(){},fetchRequest:options.fetchRequest}),denied);assert.equal(calls,0);
  const publicOperation=models.get('elevenlabs:public_get_media_info'),publicFixture=await requestFixture(publicOperation);
  await assert.rejects(executeCredentialed(publicFixture.descriptor,{...publicFixture.values,'header:xi-api-key':'raw-private-key'},publicFixture.binding,[],options),denied);assert.equal(calls,0);
  for(const origin of['https://unknown.example.test','http://api.github.com','https://api.github.com/other','https://api.github.com:8443'])await assert.rejects(approvedOperation(operation,origin),denied);
});

Then('public HTTP execution cannot bypass anonymous private result adoption',async()=>{
  const {models,documents}=await resultModels(),operation=models.get('elevenlabs:public_get_media_info'),f=await requestFixture(operation);
  const previous=catalogs.map(catalog=>({catalog,sourceIdentity:operationSourceIdentity(`${catalog.id}:`),operations:installed.filter(operation=>operation.id.startsWith(catalog.id+':'))}));
  const catalog={id:'elevenlabs',name:'Private results fixture',file:'private-results.json',document:documents.get('elevenlabs'),execution:{kind:'http',origin:'https://api.elevenlabs.io'}};
  publishPreparedCatalogs([...previous.filter(entry=>entry.catalog.id!=='elevenlabs'),{catalog,operations:[operation],sourceIdentity:'private-results-test'}]);
  let calls=0;
  try{
    await assert.rejects(createWorkflowRequestExecution(()=>assert.fail('Public credential-result fetch')).execute(operation,f.values),denied);
    const executor=createWorkflowExecution(async(descriptor,values,context)=>{calls++;assert.equal(descriptor.fingerprint,f.descriptor.fingerprint);assert.deepEqual(context.binding,f.binding);return{request:prepareRequest(operation,values),response:{status:200,statusText:'',headers:{},body:{safe:true}}};});
    await assert.rejects(executor.execute(operation,f.values),denied);assert.equal(calls,0);
    const context={binding:f.binding,runId:crypto.randomUUID(),nodeId:crypto.randomUUID()};assert.equal((await executor.execute(operation,f.values,undefined,context)).response.body.safe,true);assert.equal(calls,1);
  }finally{publishPreparedCatalogs(previous);}
});

Then('multiple returned credentials commit together or leave the vault unchanged',async()=>{
  const {models}=await resultModels(),operation=models.get('github:secret-scanning/list-alerts-for-repo'),f=await requestFixture(operation),vault=await privateVault();
  const [stored]=await vault.session.put(null,{label:'Synthetic GitHub account',kind:'secret',value:f.credentials[0].value});
  const scheme=Object.keys(f.binding.credentials)[0];f.binding.credentials[scheme]=stored.id;
  const previous=globalThis.fetch,values=['batch-private-one-92641','batch-private-two-92641'];let calls=0;
  globalThis.fetch=async(_url,init)=>{calls++;assert.equal(init.headers.get('Authorization'),'Bearer '+f.credentials[0].value);return Response.json(values.map((secret,index)=>({number:index+1,secret})));};
  try{
    vault.storage.fail=true;
    await assert.rejects(vault.session.execute(f.descriptor,f.values,f.binding),withheld(values));assert.equal(calls,1);assert.equal(vault.storage.state.snapshot.records.length,1);
    vault.storage.fail=false;
    const result=await vault.session.execute(f.descriptor,f.values,f.binding);assert.equal(calls,2);assert.equal(vault.storage.state.snapshot.records.length,3);noSecrets(result,values);
    for(const [index,row]of result.response.body.entries()){assert.equal(row.number,index+1);assert.equal(await vault.session.copyCredential(row.secret.credentialId),values[index]);}
  }finally{globalThis.fetch=previous;vault.session.lock();}
});
