// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {Then} from '@cucumber/cucumber';
import contracts from './lib/atlassian-relative-contracts.json' with {type:'json'};
import {bindAtlassianRelativeServers,requiresConnectJwt} from './lib/atlassian-relative-servers.ts';
import {readServiceSchema,readServiceSchemaUpstream,serviceSchemaDescriptors} from './lib/service-schema-packs.ts';
import {applySchemaPatches,atlassianRelativeServers} from './lib/schema-patches.ts';
import {inspectServiceSchema} from './lib/service-catalog.ts';
import {createSchemaDiscovery} from './lib/schema-index.ts';
import {operationServerUrl} from './lib/schema-documents.ts';
import {operationBlockReason,operationInsertionBlockReason,readOperationCapabilities} from './lib/operation-capabilities.ts';
import {securityRequiresCredentials} from './lib/operation-security.ts';
import {prepareRequest,additionalBodyField} from './lib/operation-input.ts';
import {appendRequestQuery} from './lib/query-serialization.ts';
import {approvedOperation} from './lib/secrets/policy.ts';
import {executeCredentialed,CredentialResponseError} from './lib/secrets/execution.ts';
import {createHttpConnection,httpConnectionReference,connectionCredentialIds} from './lib/secrets/http-connections.ts';
import {credentialResultProfile} from './lib/credential-results.ts';
import {encodeWorkflowBinary} from './lib/workflow-binary.ts';
import {createWorkflowRequestExecution} from './lib/workflow-execution.ts';
import {multipartPartEncodings} from './lib/multipart-parts.ts';

const confluence='atlassian-confluence-v1',focus='atlassian-focus',migration='atlassian-app-migration';
const site='relative-fixture',cloudId='7b1dc88b-26c6-4091-945e-c22d51e25a4b';
const migrationId=migration+':GET /transfer/recent';
const moduleId=confluence+':POST /wiki/rest/atlassian-connect/1/app/module/dynamic';
const dataId=migration+':GET /data/{s3Key}';
const fileBytes=new TextEncoder().encode('Exact attachment Ω\r\n\u0000\u00ff');
const file=encodeWorkflowBinary('attachment-λ.bin',fileBytes,'application/octet-stream');
const cache=new Map();
const document=async catalog=>{if(!cache.has(catalog))cache.set(catalog,await readServiceSchema(catalog));return structuredClone(cache.get(catalog));};
function configured(doc,index=0){doc.servers=[structuredClone(doc.servers[index])];for(const [key,v]of Object.entries(doc.servers[0].variables))v.default=key==='site'?site:cloudId;return doc;}
async function model(catalog,id,index=0){const doc=configured(await document(catalog),index),operation=inspectServiceSchema(doc,catalog,new Set([id])).operations.find(o=>o.id===id);assert.ok(operation,id);assert.equal(operationBlockReason(operation),undefined,`${id}: ${operationBlockReason(operation)}`);return {doc,operation,origin:operationServerUrl(doc,operation)};}
const record=(value)=>({id:crypto.randomUUID(),label:'Synthetic private fixture',kind:'secret',value,grants:[]});
const rawJwt=(url,method)=>{
  const u=new URL(url),path=u.pathname.replace(/^\/wiki(?=\/)/,'').replace(/\/$/,'')||'/';
  const canonical=[...u.searchParams].sort(([a,av],[b,bv])=>a===b?av.localeCompare(bv):a.localeCompare(b)).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
  const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
  const body=encode({alg:'HS256',typ:'JWT'})+'.'+encode({iss:'fixture-connect-app',iat:now,exp:now+180,qsh:createHash('sha256').update(method+'&'+path+'&'+canonical).digest('hex')});
  return body+'.'+createHmac('sha256','SYNTHETIC_CONNECT_INSTALLATION_SECRET_85317').update(body).digest('base64url');
};
function target(f,values={}){const request=prepareRequest(f.operation,values),url=new URL(f.origin+request.path);appendRequestQuery(url,request);return url.href;}
async function authorize(f,kind,values={},saved=false){
  const alternative=f.operation.security.findIndex(a=>a.length===1&&a[0].kind===kind);assert.ok(alternative>=0,kind);
  const scheme=f.operation.security[alternative][0],jwt=rawJwt(target(f,values),f.operation.method);
  const records=kind==='basic'?[record('fixture@example.test'),record('SYNTHETIC_API_TOKEN_85317')]:[record(kind==='apiKey'?'JWT '+jwt:'SYNTHETIC_OAUTH_TOKEN_85317')];
  const descriptor=await approvedOperation(f.operation,f.origin),binding={fingerprint:descriptor.fingerprint,alternative,credentials:{[scheme.name]:kind==='basic'?{username:records[0].id,password:records[1].id}:records[0].id}};
  if(saved){const connection=await createHttpConnection({label:'Relative fixture',account:'Fixture account',format:'schema'},descriptor,binding,records);const owner=records.find(r=>r.id===connectionCredentialIds(connection)[0]);assert.ok(owner);owner.connections=[connection];return {...f,descriptor,records,jwt,binding:{fingerprint:descriptor.fingerprint,alternative,credentials:{},connection:httpConnectionReference(connection)}};}
  return {...f,descriptor,records,binding,jwt};
}
async function invoke(f,values,fetchRequest,extra={}){
  let caught;
  try{return await executeCredentialed(f.descriptor,values,f.binding,f.records,{assertCurrent(){},...extra,fetchRequest:async(...args)=>{try{return await fetchRequest(...args);}catch(error){caught=error;throw error;}}});}
  catch(error){throw caught??error;}
}
function safe(value,f){const text=JSON.stringify(value);for(const r of f.records)assert.ok(!text.includes(r.value));assert.ok(!text.includes(f.jwt));}

Then('all 167 relative Atlassian operations retain their identities and can be inserted before destination configuration',async()=>{
  let total=0,jwt=0;
  for(const [catalog,c]of Object.entries(contracts.sources)){
    const native=await readServiceSchemaUpstream(catalog),before=JSON.stringify(native),doc=await document(catalog);
    assert.equal(createHash('sha256').update(before).digest('hex'),c.sha256);
    const descriptor=serviceSchemaDescriptors.find(s=>s.id===catalog);assert.ok(descriptor.patches.some(p=>p.id===atlassianRelativeServers.id));
    assert.equal(doc['x-upstream-relative-atlassian'].servers.length,c.servers.length);
    assert.deepEqual(doc['x-upstream-relative-atlassian'].servers,c.servers);
    const inspected=inspectServiceSchema(doc,catalog),discovery=createSchemaDiscovery(inspected,'relative-source');
    assert.equal(inspected.operations.length,Object.keys(c.operations).length);assert.equal(discovery.summary.unavailableCount,0);
    for(const operation of inspected.operations){
      const id=operation.id.slice(catalog.length+1),source=c.operations[id];assert.ok(source,id);
      assert.equal(operation.path,catalog===focus?source.path.slice('/focus'.length):source.path);assert.equal(operation.method,source.method);
      assert.equal(operationInsertionBlockReason(operation),undefined,operation.id);assert.ok(operationBlockReason(operation),operation.id);
      const tiny=discovery.operations.find(o=>o.id===operation.id);assert.equal(operationInsertionBlockReason(tiny),undefined);assert.ok(readOperationCapabilities(tiny).requirements.some(r=>r.code==='server'));
      assert.throws(()=>prepareRequest(operation,{}),/Configure/);await assert.rejects(approvedOperation(operation,'https://unrelated.example.test'),e=>e.code==='PERMISSION');
      if(requiresConnectJwt(operation)){jwt++;assert.equal(securityRequiresCredentials(operation.security),true);assert.deepEqual(operation.security,[[{name:'ConnectJWT',kind:'apiKey',header:'Authorization'}]]);}
    }
    assert.equal(JSON.stringify(native),before);total+=inspected.operations.length;
  }
  assert.equal(total,167);assert.equal(jwt,16);
});

Then('relative Atlassian corrections reject changed routes authentication bodies and server declarations before mutation',async()=>{
  for(const catalog of Object.keys(contracts.sources)){
    const native=await readServiceSchemaUpstream(catalog),first=Object.values(native.paths).flatMap(item=>Object.values(item).filter(o=>o&&typeof o==='object'&&o.operationId))[0];
    for(const change of[d=>d.servers[0].url='https://unexpected.example.test',d=>d.info.version='other',d=>{const o=Object.values(d.paths).flatMap(Object.values).find(o=>o?.operationId===first.operationId);o.security=[{Anonymous:[]}];}]){
      const changed=structuredClone(native);change(changed);const before=JSON.stringify(changed);assert.throws(()=>bindAtlassianRelativeServers(changed),/reviewed native contract/);assert.equal(JSON.stringify(changed),before);
    }
    const corrected=applySchemaPatches(native,[atlassianRelativeServers]),before=JSON.stringify(corrected);assert.throws(()=>bindAtlassianRelativeServers(corrected));assert.equal(JSON.stringify(corrected),before);
  }
  const native=await readServiceSchemaUpstream(confluence),changed=structuredClone(native);changed.paths['/wiki/rest/api/content/{id}/child/attachment'].put.requestBody.content['multipart/form-data'].schema.properties.file.type='number';const before=JSON.stringify(changed);assert.throws(()=>bindAtlassianRelativeServers(changed));assert.equal(JSON.stringify(changed),before);
});

Then('relative Atlassian corrections preserve non-operation path metadata',async()=>{
  for(const catalog of Object.keys(contracts.sources)){
    const source=await readServiceSchemaUpstream(catalog),item=Object.values(source.paths)[0];item.summary='Owned path metadata';
    bindAtlassianRelativeServers(source);assert.equal(item.summary,'Owned path metadata');
  }
});

Then('Confluence Focus and App Migration use their documented site cloud and product bases without duplicated paths',async()=>{
  for(const [catalog,id,kind,expected]of[
    [confluence,confluence+':GET /wiki/rest/api/audit','basic',[`https://${site}.atlassian.net/wiki/rest/api/audit`,`https://api.atlassian.com/ex/confluence/${cloudId}/wiki/rest/api/audit`]],
    [focus,focus+':GET /focus/v1/organizations','basic',[`https://${site}.atlassian.net/gateway/api/focus/v1/organizations`,`https://api.atlassian.com/focus/cloud/${cloudId}/v1/organizations`]],
    [migration,migrationId,'apiKey',[`https://${site}.atlassian.net/rest/atlassian-connect/1/migration/transfer/recent`,`https://${site}.atlassian.net/wiki/rest/atlassian-connect/1/migration/transfer/recent`]],
  ])for(const index of[0,1]){
    const actualKind=index===1&&kind==='basic'?'bearer':kind,f=await authorize(await model(catalog,id,index),actualKind,{},true);let calls=0;
    const result=await invoke(f,{},async(url,init)=>{calls++;assert.equal(new URL(url).origin+new URL(url).pathname,expected[index]);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
      const auth=init.headers.get('Authorization');assert.equal(auth,actualKind==='basic'?'Basic '+Buffer.from(f.records[0].value+':'+f.records[1].value).toString('base64'):actualKind==='apiKey'?'JWT '+f.jwt:'Bearer '+f.records[0].value);
      return Response.json({ok:true});});assert.equal(calls,1);assert.equal(result.response.body.ok,true);safe(result,f);
  }
});

Then('relative Atlassian destinations reject malformed identifiers unconfigured models and changed credential approvals',async()=>{
  for(const catalog of Object.keys(contracts.sources)){
    const doc=await document(catalog),id=catalog+':'+Object.keys(contracts.sources[catalog].operations)[0];
    for(const value of['../other','host.atlassian.net','x%2Fy','x@evil.test','x/../other','x?query=1',' x','a'.repeat(129)]){
      const changed=structuredClone(doc),slot=Object.keys(changed.servers[0].variables)[0];changed.servers[0].variables[slot].default=value;
      const op=inspectServiceSchema(changed,catalog,new Set([id])).operations[0];assert.ok(operationInsertionBlockReason(op),value);await assert.rejects(approvedOperation(op,'https://unrelated.example.test'));
    }
    for(const change of[d=>{d.servers[0].variables.site.enum=['actual-site'];},d=>{d.servers[0].url='__proto__';d.servers[0].variables={'[object Object]':{default:'<[object Object]>'}};}]){
      const changed=structuredClone(doc);change(changed);const op=inspectServiceSchema(changed,catalog,new Set([id])).operations[0];assert.ok(operationInsertionBlockReason(op),'Malformed configuration must remain an insertion blocker');
    }
  }
  const f=await authorize(await model(migration,migrationId),'apiKey'),other=await approvedOperation(f.operation,f.origin.replace(site,'other-fixture'));let calls=0;
  await assert.rejects(executeCredentialed(other,{},f.binding,f.records,{assertCurrent(){},fetchRequest:async()=>{calls++;return Response.json({});}}));assert.equal(calls,0);
  await assert.rejects(approvedOperation(f.operation,'https://evil.example.test/rest/atlassian-connect/1/migration'));
  await assert.rejects(approvedOperation({...f.operation,security:[]},f.origin),e=>e.code==='PERMISSION');
});

Then('all three Confluence attachment operations send exact file bytes Unicode comments boolean minor edits and XSRF headers',async()=>{
  const ids=Object.entries(contracts.sources[confluence].operations).filter(([,c])=>c.requestBody?.content?.['multipart/form-data']).map(([id])=>confluence+':'+id);assert.equal(ids.length,3);
  for(const [index,id]of ids.entries()){
    const values={'path:id':'123','path:attachmentId':'456','body:file':JSON.stringify(file),'body:comment':'Comment Ω\nsecond line','body:minorEdit':'false','header:X-Atlassian-Token':'nocheck'};
    const f=await authorize(await model(confluence,id),index%2?'bearer':'basic',values);
    const result=await invoke(f,values,async(url,init)=>{assert.equal(init.headers.get('X-Atlassian-Token'),'nocheck');assert.ok(init.body instanceof FormData);assert.equal(init.body.get('minorEdit'),'false');const comment=init.body.get('comment');assert.equal(await comment.text(),values['body:comment']);assert.match(comment.type,/^text\/plain;\s*charset=utf-8$/);assert.deepEqual(new Uint8Array(await init.body.get('file').arrayBuffer()),fileBytes);return Response.json({results:[]});});safe(result,f);
    assert.throws(()=>prepareRequest(f.operation,{...values,'header:X-Atlassian-Token':'wrong'}));
  }
  const schema={type:'object',properties:{text:{type:'string'}}};assert.equal(multipartPartEncodings(schema,{text:{contentType:'text/plain; charset=utf-8'}}).text.kind,'text');
  for(const type of['text/plain; charset=latin-1','text/plain;\r\ncharset=utf-8','text/plain; filename=secret','application/json; charset=utf-8','text/plain; charset=utf-8\r\nAuthorization: secret'])assert.throws(()=>multipartPartEncodings(schema,{text:{contentType:type}}));
});

Then('Confluence dynamic module requests retain arbitrary module definitions with private Connect authentication',async()=>{
  const f=await model(confluence,moduleId),body={webItems:[{key:'fixture-item',location:'system.admin/globalsettings',url:'/fixture',name:{value:'Fixture Ω'}}],adminPages:[{key:'fixture-page',url:'/settings',name:{value:'Settings'}}]};
  const fields=Object.keys(body).map(name=>additionalBodyField(f.operation,name,'array'));assert.ok(fields.every(Boolean));f.operation.fields.push(...fields);
  const values=Object.fromEntries(Object.entries(body).map(([name,value])=>['body:'+name,JSON.stringify(value)]));
  assert.equal(f.operation.bodyMediaType,'application/json');assert.deepEqual(prepareRequest(f.operation,values).body,body);const a=await authorize(f,'apiKey',values);
  const result=await invoke(a,values,async(url,init)=>{assert.equal(init.headers.get('Authorization'),'JWT '+a.jwt);assert.deepEqual(JSON.parse(init.body),body);assert.equal(init.headers.get('Content-Type'),'application/json');return Response.json(body);});assert.deepEqual(result.response.body,body);safe(result,a);
  assert.throws(()=>prepareRequest(f.operation,{'body:webItems':'[7]'}));
});

Then('App Migration privately adopts returned signed URLs and withholds failed adoption results',async()=>{
  const values={'path:s3Key':'1534df75-69fb-4d8f-97d9-269b3bdf1be8'},f=await authorize(await model(migration,dataId),'apiKey',values),signed='https://fixture-bucket.s3.amazonaws.com/data.zip?X-Amz-Signature=SYNTHETIC_PRIVATE_CAPABILITY_85317';
  assert.ok(credentialResultProfile(f.operation));const reference={credentialId:crypto.randomUUID(),label:'Migration data URL'};let adopted=0;
  const fetchRequest=async()=>Response.json({url:signed},{headers:{'X-Reflected-URL':signed}});
  const result=await invoke(f,values,fetchRequest,{adoptPrivateResults:async batch=>{adopted++;assert.equal(batch.length,1);assert.equal(batch[0].value,signed);return [reference];}});
  assert.equal(adopted,1);assert.deepEqual(result.response.body.url,reference);assert.ok(!JSON.stringify(result).includes(signed));safe(result,f);
  await assert.rejects(invoke(f,values,fetchRequest),e=>e.code==='PERMISSION');
  await assert.rejects(invoke(f,values,fetchRequest,{adoptPrivateResults:async()=>{throw new Error(signed);}}),e=>!String(e).includes(signed)&&!JSON.stringify(e).includes(signed));
});

Then('Connect JWT requests reject missing malformed cross-origin and public credentials without exposing raw token values',async()=>{
  const f=await authorize(await model(migration,migrationId),'apiKey');let calls=0;
  for(const value of['Bearer '+f.jwt,f.jwt,'JWT bad',f.records[0].value+'\r\nInjected: bad']){
    const changed=structuredClone(f);changed.records[0].value=value;await assert.rejects(invoke(changed,{},async()=>{calls++;return Response.json({});}));
  }
  await assert.rejects(invoke({...f,binding:{...f.binding,credentials:{}}},{},async()=>{calls++;return Response.json({});}));assert.equal(calls,0);
  const execution=createWorkflowRequestExecution(async()=>{calls++;return Response.json({});});await assert.rejects(execution.execute(f.operation,{}));assert.equal(calls,0);
  const result=await invoke(f,{},async()=>Response.json({rawToken:f.jwt,fullHeader:'JWT '+f.jwt}));safe(result,f);
  await assert.rejects(invoke(f,{},async()=>Response.json({message:f.jwt},{status:403})),e=>e instanceof CredentialResponseError&&!JSON.stringify(e.response).includes(f.jwt));
});
