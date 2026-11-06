// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import ids from '../tests/literal-query-operations.json' with {type:'json'};
import { extractOperations, updateCatalogs } from './lib/catalog.ts';
import { catalogs } from './lib/catalog-registry.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { validateSchemaDocument, operationServerUrl } from './lib/schema-documents.ts';
import { literalQueryRoute, betaWorkPrivateIds } from './lib/literal-query.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { createWorkflowRequestExecution } from './lib/workflow-execution.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { credentialResultProfile } from './lib/credential-results.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { encodeWorkflowBinary } from './lib/workflow-binary.ts';
import { requestFixture, privateVault, noSecrets } from '../tests/credential-results/fixture.mjs';

const origin='https://routes.example.test/api';
function fixture(authenticated=false) {
  const operation=id=>({operationId:id,summary:id,parameters:[
    {name:'id',in:'path',required:true,schema:{type:'string'}},
    {name:'q',in:'query',schema:{type:'string'}},
    {name:'tag',in:'query',schema:{type:'array',items:{type:'string'}}}],
    responses:{200:{description:'Success',content:{'application/json':{schema:{type:'object'}}}}}});
  return {openapi:'3.0.3',info:{title:'Query variants',version:'1'},servers:[{url:origin}],
    ...(authenticated?{security:[{Token:[]}],components:{securitySchemes:{Token:{type:'http',scheme:'bearer'}}}}:{}),
    paths:{'/items/{id}':{get:operation('plain')},'/items/{id}?beta=true':{get:operation('beta')}}};
}
const inputs={'path:id':'id-λ','query:q':'λ + &/?#','query:tag':'["a,b","c d"]'};
function assertUrl(address) {
  const url=new URL(address);assert.equal(url.origin,'https://routes.example.test');assert.equal(url.pathname,'/api/items/id-%CE%BB');
  assert.deepEqual(url.searchParams.getAll('beta'),['true']);assert.equal(url.searchParams.get('q'),inputs['query:q']);assert.deepEqual(url.searchParams.getAll('tag'),['a,b','c d']);
}
Then('beta variants retain their native paths while both executors send the selector exactly once',async()=>{
  for(const authenticated of [false,true]) {
    const document=fixture(authenticated),strict=validateSchemaDocument(document,'query-variants').operations,canonical=inspectServiceSchema(document,'query-variants').operations;
    assert.equal(strict.length,2);assert.equal(canonical.length,2);assert.deepEqual(strict.map(op=>op.id),canonical.map(op=>op.id));
    for(const operation of [strict[1],canonical[1]]) {
      assert.equal(operation.path,'/items/{id}?beta=true');const request=prepareRequest(operation,inputs);
      assert.equal(request.path,'/items/id-%CE%BB');assert.equal(request.query.beta,'true');
    }
    const operation=canonical[1],token='beta-route-private-key-9913';let calls=0;
    const fetchRequest=async(address,init)=>{calls++;assertUrl(address);assert.equal(new Headers(init.headers).get('Authorization'),authenticated?'Bearer '+token:null);return Response.json({ok:true,...(authenticated?{echo:token}:{})});};
    if(authenticated) {
      const descriptor=await approvedOperation(operation,origin),binding={alternative:0,fingerprint:descriptor.fingerprint,credentials:{Token:'token'}};
      const result=await executeCredentialed(descriptor,inputs,binding,[{id:'token',label:'Token',kind:'secret',value:token,grants:[]}],{assertCurrent(){},fetchRequest});noSecrets(result,[token]);
      const plain=await approvedOperation({...operation,path:'/items/{id}'},origin);assert.notEqual(plain.fingerprint,descriptor.fingerprint);
      await assert.rejects(executeCredentialed(plain,inputs,binding,[],{assertCurrent(){}}),error=>error.code==='PERMISSION');
    } else {
      const previous=[...catalogs];
      try {updateCatalogs([...previous,{id:'query-variants',name:'Query variants',file:'query.json',document,groups:[],execution:{kind:'http',origin}}]);
        const result=await createWorkflowRequestExecution(fetchRequest).execute(operation,inputs);assert.equal(result.response.body.ok,true);
      } finally {updateCatalogs(previous);}
    }
    assert.equal(calls,1);
  }
});
Then('beta route validation rejects unreviewed selectors unsafe paths and editable selector collisions',async()=>{
  for(const path of ['/items/{id}?beta=false','/items/{id}?beta=true&beta=false','/items/{id}?beta=true#extra','/items/{id}?Action=unknown','//evil.test/items/{id}?beta=true','/items/../{id}?beta=true']) {
    const document=fixture();document.paths={[path]:{get:document.paths['/items/{id}?beta=true'].get}};
    assert.throws(()=>validateSchemaDocument(document,'query-variants'),undefined,path);
    const operation=inspectServiceSchema(document,'query-variants').operations[0];
    await assert.rejects(approvedOperation(operation,origin),error=>error.code==='PERMISSION');
  }
  const collision=fixture();collision.paths['/items/{id}?beta=true'].get.parameters.push({name:'beta',in:'query',schema:{type:'boolean'}});
  assert.throws(()=>validateSchemaDocument(collision,'query-variants'),/Fixed query parameter "beta"/);
  assert.match(inspectServiceSchema(collision,'query-variants').operations[1].unavailableReason,/Fixed query parameter "beta"/);
  const operation=extractOperations(fixture(true),'query-variants')[1],changed={...operation,fields:[...operation.fields,{key:'query:beta',name:'beta',label:'Beta',description:'',location:'query',type:'boolean',required:false}]};
  assert.throws(()=>prepareRequest(changed,{...inputs,'query:beta':'false'}),error=>error instanceof InputValidationError&&error.fieldKey==='query:beta');
  await assert.rejects(approvedOperation(changed,origin),error=>error.code==='PERMISSION');
  const queryAuth={...operation,security:[[{name:'Key',kind:'apiKey',query:'beta'}]]},descriptor=await approvedOperation(queryAuth,origin);
  await assert.rejects(executeCredentialed(descriptor,inputs,{alternative:0,fingerprint:descriptor.fingerprint,credentials:{Key:'key'}},
    [{id:'key',label:'Key',kind:'secret',value:'fixed-query-credential',grants:[]}],{assertCurrent(){},fetchRequest:()=>assert.fail('Selector credential override fetched')}),error=>error.code==='PERMISSION');
  assert.equal(literalQueryRoute('/items?beta=true?x=y'),undefined);assert.equal(literalQueryRoute('/items?beta=%74rue'),undefined);
});
Then('all 127 beta operations have qualified canonical routes and unchanged source identities',async()=>{
  assert.equal(new Set(ids).size,127);const found=new Set();
  for(const catalog of ['anthropic','openai']) {
    const document=await readServiceSchema(catalog),native=await readServiceSchemaUpstream(catalog);
    assert.deepEqual(Object.keys(document.paths),Object.keys(native.paths));
    for(const operation of inspectServiceSchema(document,catalog,new Set(ids)).operations) {
      assert.equal(operation.unavailableReason,undefined,operation.id);found.add(operation.id);
      const raw=native.paths[operation.path][operation.method.toLowerCase()];assert.equal(operation.id,catalog+':'+raw.operationId);
      assert.ok(operation.path.endsWith('?beta=true'));assert.equal(literalQueryRoute(operation.path).path.includes('?'),false);
    }
  }
  assert.deepEqual(found,new Set(ids));
});
Then('both native beta skill requests send files array parts and retain the beta selector',async()=>{
  const selected=new Set(ids.filter(id=>id==='anthropic:beta_create_skill_v1_skills_post'||id==='anthropic:beta_create_skill_version_v1_skills__skill_id__versions_post'));
  const document=await readServiceSchema('anthropic'),data=new TextEncoder().encode('---\nname: fixture\ndescription: fixture\n---\nHello');let calls=0;
  for(const operation of inspectServiceSchema(document,'anthropic',selected).operations) {
    const descriptor=await approvedOperation(operation,operationServerUrl(document,operation)),values={'header:anthropic-version':'2023-06-01','body:files[]':JSON.stringify([encodeWorkflowBinary('SKILL.md',data,'text/markdown')])};
    for(const field of operation.fields)if(field.location==='path')values[field.key]='skill-fixture';
    const binding={alternative:0,fingerprint:descriptor.fingerprint,credentials:{[operation.security[0][0].name]:'key'}};
    await executeCredentialed(descriptor,values,binding,[{id:'key',label:'Key',kind:'secret',value:'beta-skill-private-key',grants:[]}],{assertCurrent(){},async fetchRequest(address,init){calls++;
      assert.deepEqual(new URL(address).searchParams.getAll('beta'),['true']);assert.equal(new Headers(init.headers).get('Content-Type'),null);
      const parts=init.body.getAll('files[]');assert.equal(parts.length,1);assert.equal(init.body.get('files'),null);assert.equal(parts[0].name,'SKILL.md');assert.deepEqual(new Uint8Array(await parts[0].arrayBuffer()),data);return Response.json({id:'skill-fixture'});}});
  }
  assert.equal(calls,2);
});
Then('all six beta work result routes persist credential payloads privately and survive vault reload',async()=>{
  const document=await readServiceSchema('anthropic'),operations=inspectServiceSchema(document,'anthropic',betaWorkPrivateIds).operations;assert.equal(operations.length,6);
  for(const operation of operations) {
    const f=await requestFixture(operation),contract=credentialResultProfile(operation),path=contract.responses[0].path,secret='beta-work-秘密\n'+operation.id;
    const body=path[0]==='data'?{data:[{secret}]}:{secret},vault=await privateVault(),previous=globalThis.fetch;let calls=0;
    f.values['header:anthropic-version']='2023-06-01';
    try {
      const aliases=new Map();
      for(const record of f.credentials){const summaries=await vault.session.put(null,{label:record.label,kind:record.kind,value:record.value});aliases.set(record.id,summaries.find(item=>item.label===record.label).id);}
      for(const scheme of operation.security[f.binding.alternative]){f.binding.credentials[scheme.name]=aliases.get(f.binding.credentials[scheme.name]);await vault.session.grant(null,f.binding.credentials[scheme.name],scheme.name,f.descriptor);}
      globalThis.fetch=async(address,init)=>{calls++;assert.deepEqual(new URL(address).searchParams.getAll('beta'),['true']);assert.equal(new URL(address).origin,'https://api.anthropic.com');return Response.json(body);};
      const result=await vault.session.execute(f.descriptor,f.values,f.binding,undefined,undefined,()=>assert.fail('Private progress published'),()=>assert.fail('Private payload published'));
      const reference=path[0]==='data'?result.response.body.data[0].secret:result.response.body.secret;
      assert.ok(reference.credentialId);assert.equal(await vault.session.copyCredential(reference.credentialId),secret);noSecrets(result,[secret,...f.credentials.map(record=>record.value)]);
      noSecrets(vault.storage.state,[secret]);noSecrets(await vault.session.backup(),[secret]);
      vault.session.lock();await vault.session.unlock(vault.proof);assert.equal(await vault.session.copyCredential(reference.credentialId),secret);assert.equal(calls,1);
    } finally {globalThis.fetch=previous;vault.session.lock();}
  }
});
Then('native beta Responses sends exact selectors for JSON and terminal SSE without exposing credentials',async()=>{
  const document=await readServiceSchema('openai'),operation=inspectServiceSchema(document,'openai',new Set(['openai:beta_createResponse'])).operations[0];
  assert.equal(operation.responseStream,'openai-responses');const descriptor=await approvedOperation(operation,operationServerUrl(document,operation));
  const token='beta-responses-private-key-9913',credentials=[{id:'key',label:'Key',kind:'secret',value:token,grants:[]}],binding={alternative:0,fingerprint:descriptor.fingerprint,credentials:{[operation.security[0][0].name]:'key'}};
  const terminal={id:'resp_fixture',object:'response',status:'completed',output:[],text:'λ '+token};let calls=0;
  for(const stream of [false,true]) {
    const logical={model:'gpt-4.1',input:'Hello',stream},values=operation.bodyValue?{'body:$':JSON.stringify(logical)}:{};
    if(!operation.bodyValue)for(const [name,value]of Object.entries(logical)){const field=operation.fields.find(field=>field.key==='body:'+name);assert.ok(field,name);values[field.key]=field.type==='json'||typeof value==='object'?JSON.stringify(value):String(value);}
    const result=await executeCredentialed(descriptor,values,binding,credentials,{assertCurrent(){},async fetchRequest(address,init){calls++;
      const url=new URL(address);assert.equal(url.pathname,'/v1/responses');assert.deepEqual(url.searchParams.getAll('beta'),['true']);
      assert.equal(new Headers(init.headers).get('Accept'),stream?'text/event-stream':'application/json');assert.equal(JSON.parse(init.body).stream,stream);
      return stream?new Response('event: response.completed\r\ndata: '+JSON.stringify({type:'response.completed',response:terminal})+'\r\n\r\n',{headers:{'Content-Type':'text/event-stream'}}):Response.json(terminal);}});
    assert.equal(result.response.body.id,'resp_fixture');noSecrets(result,[token]);
  }
  assert.equal(calls,2);
});
