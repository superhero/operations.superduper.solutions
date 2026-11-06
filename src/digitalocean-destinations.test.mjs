// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Then} from '@cucumber/cucumber';
import contracts from './lib/digitalocean-destinations.json' with {type:'json'};
import {bindDigitalOceanDestinations,digitalOceanUploadPath,digitalOceanUploadId} from './lib/digitalocean-destinations.ts';
import {applySchemaPatches,digitalOceanDestinations} from './lib/schema-patches.ts';
import {readServiceSchema,readServiceSchemaUpstream} from './lib/service-schema-packs.ts';
import {inspectServiceSchema} from './lib/service-catalog.ts';
import {operationServerUrl} from './lib/schema-documents.ts';
import {approvedOperation} from './lib/secrets/policy.ts';
import {createHttpConnection,httpConnectionReference} from './lib/secrets/http-connections.ts';
import {executeCredentialed,CredentialResponseError} from './lib/secrets/execution.ts';
import {prepareRequest} from './lib/operation-input.ts';
import {encodeWorkflowBinary} from './lib/workflow-binary.ts';
import {credentialResultProfile} from './lib/credential-results.ts';
import {prepareCredentialResults} from './lib/secrets/credential-results.ts';
import {parseDigitalOceanUploadUrl,digitalOceanUploadUrl} from './lib/secrets/digitalocean-upload.ts';
import {updateCatalogs} from './lib/catalog.ts';
import {catalogs} from './lib/catalog-registry.ts';
import {createWorkflowRequestExecution} from './lib/workflow-execution.ts';
import {createOperationGraph} from './lib/workflow-graph.ts';
import {readResponseStream} from './lib/workflow-response-stream.ts';
import {validateWorkflowDocument,parseWorkflowDocument} from './lib/workflow-document.ts';

const producer='digitalocean:inference_create_batch_file',agent='digitalocean:agentInference_create_chat_completion';
const origin='https://batch-inference.nyc3.digitaloceanspaces.com',agentHost='fixture-agent.agents.do-ai.run';
const fileId='28a6baad-e043-4fb5-9825-3f7c704de5f4',signature='a123'.repeat(16),sessionToken='SYNTHETIC_STORAGE_SESSION_TOKEN_84571';
const bytes=new TextEncoder().encode('{"custom_id":"α","body":{"text":"Hi"}}\n{"custom_id":"β","body":{"text":"Bye"}}\r\n');
const file=encodeWorkflowBinary('requests-λ.jsonl',bytes,'application/x-ndjson');
function signedURL({host=origin,issued=Date.now()-1000,expires=900,headers='host'}={}){
  const date=new Date(issued).toISOString().replace(/[-:]|\.\d{3}/g,'');
  return `${host}/uploads/${fileId}.jsonl?x-meta=a%2fb+z&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent('FIXTUREACCESS/'+date.slice(0,8)+'/nyc3/s3/aws4_request')}&X-Amz-Date=${date}&X-Amz-Expires=${expires}&X-Amz-SignedHeaders=${encodeURIComponent(headers)}&X-Amz-Signature=${signature}&X-Amz-Security-Token=${sessionToken}`;
}
const safe=(value,url)=>{const text=JSON.stringify(value);for(const secret of[url,signature,sessionToken,encodeURIComponent(url)])assert.ok(!text.includes(secret),'A signed upload credential escaped its private boundary');};
let base;
async function document(){return base??=await readServiceSchema('digitalocean');}
async function model(id,configured=true){
  const doc=structuredClone(await document());
  if(configured){doc.paths[digitalOceanUploadPath].put.servers[0].variables.upload_origin.default=origin;doc.paths['/api/v1/chat/completions'].post.servers[0].variables.agent_url.default=agentHost;}
  const operation=inspectServiceSchema(doc,'digitalocean',new Set([id])).operations.find(o=>o.id===id);
  assert.ok(operation&&(configured?!operation.unavailableReason:operation.capabilities.issues.every(issue=>issue.code==='configuration-required')),`${id}: ${operation?.unavailableReason}`);return {doc,operation};
}
const record=(value,label='Private fixture')=>({id:crypto.randomUUID(),label,kind:'secret',value,grants:[]});
async function authorize(id,credential,saved=true){
  const {doc,operation}=await model(id),descriptor=await approvedOperation(operation,operationServerUrl(doc,operation));
  const alternative=operation.security.findIndex(option=>option.length===1&&option[0].kind!=='unsupported');assert.ok(alternative>=0);
  const name=operation.security[alternative][0].name,manual={alternative,fingerprint:descriptor.fingerprint,credentials:{[name]:credential.id}};
  if(!saved)return {descriptor,operation,credential,binding:manual};
  const connection=await createHttpConnection({label:'Destination fixture',account:'Fixture account',format:'schema'},descriptor,manual,[credential]);
  credential.connections=[connection];
  return {descriptor,operation,credential,connection,binding:{alternative,fingerprint:descriptor.fingerprint,credentials:{},connection:httpConnectionReference(connection)}};
}
const uploadValues=(type)=>({'body:$':JSON.stringify(file),...(type?{'header:Content-Type':type}:{})});
async function invoke(f,values,fetchRequest,extra={}){
  let fetchError;
  const result=await executeCredentialed(f.descriptor,values,f.binding,[f.credential],{assertCurrent(){},...extra,fetchRequest:async(...args)=>{try{return await fetchRequest(...args);}catch(error){fetchError=error;throw error;}}}).catch(error=>{throw fetchError??error;});
  return result;
}
Then('DigitalOcean destination adapters retain their pinned declarations and expose configuration requirements',async()=>{
  const native=await readServiceSchemaUpstream('digitalocean'),before=JSON.stringify(native);assert.equal(createHash('sha256').update(before).digest('hex'),contracts.source.sha256);
  const patched=applySchemaPatches(native,[digitalOceanDestinations]),restored=structuredClone(patched);assert.equal(JSON.stringify(native),before);
  for(const [id,c]of Object.entries(contracts.operations)){
    const op=patched.paths[c.path][c.method.toLowerCase()];assert.equal(op.operationId,id);assert.deepEqual(op.requestBody,c.requestBody);
    assert.deepEqual(op['x-upstream-digitalocean-destination'].servers,c.servers);restored.paths[c.path][c.method.toLowerCase()]=structuredClone(native.paths[c.path][c.method.toLowerCase()]);
  }
  assert.deepEqual(restored,native);
  for(const id of[agent,digitalOceanUploadId]){
    const {operation}=await model(id,false);assert.ok(operation.capabilities.requirements.some(r=>r.code==='server'));
    assert.ok(operation.capabilities.requirements.some(r=>r.code==='credentials'));
    assert.ok(operation.capabilities.issues.every(issue=>issue.code==='configuration-required'));
  }
});
Then('DigitalOcean destination corrections reject source drift before any mutation',async()=>{
  const raw=await readServiceSchemaUpstream('digitalocean');
  for(const change of[d=>d.info.version='other',d=>d.servers=[{url:'https://unreviewed.example.test'}],d=>d.paths[digitalOceanUploadPath].put.security=[{bearer_auth:[]}],d=>d.paths['/v1/batches/files'].post.responses['201'].content['application/json'].schema.properties.upload_url.type='object']){
    const doc=structuredClone(raw);change(doc);const before=JSON.stringify(doc);assert.throws(()=>bindDigitalOceanDestinations(doc),/reviewed native source/);assert.equal(JSON.stringify(doc),before);
  }
});
Then('a DigitalOcean file intent returns a credential reference and public storage origin without its signed URL',async()=>{
  const url=signedURL(),f=await authorize(producer,record('SYNTHETIC_INFERENCE_ACCESS_KEY_84571'),false);let adopted,calls=0;
  const expires=new Date(Date.now()+60000).toISOString(),reference={credentialId:crypto.randomUUID(),label:'Signed file upload'};
  const result=await invoke(f,{'body:file_name':'requests.jsonl'},async(target,init)=>{
    calls++;assert.equal(target,'https://inference.do-ai.run/v1/batches/files');assert.equal(init.headers.get('Authorization'),`Bearer ${f.credential.value}`);
    assert.deepEqual(JSON.parse(init.body),{file_name:'requests.jsonl'});return Response.json({file_id:fileId,upload_url:url,expires_at:expires,unreviewed_echo:url},{status:201,headers:{Location:url}});
  },{adoptPrivateResults:async values=>{adopted=values;return[reference];}});
  assert.equal(calls,1);assert.equal(adopted.length,1);const envelope=JSON.parse(adopted[0].value);
  assert.equal(envelope.url,url);assert.equal(envelope.expiresAt,Date.parse(expires));assert.equal(envelope.kind,'digitalocean-upload');
  assert.deepEqual(result.response.body,{file_id:fileId,upload_origin:origin,upload_url:reference,expires_at:expires});assert.equal(result.response.headers.location,undefined);safe(result,url);
});
Then('malformed expired and failed DigitalOcean file intents withhold all unadopted response material',async()=>{
  const url=signedURL(),f=await authorize(producer,record('SYNTHETIC_INFERENCE_ACCESS_KEY_84571'),false);let adoptions=0;
  for(const body of[{file_id:fileId,upload_url:'https://unreviewed.example.test/token'},{file_id:'not-a-uuid',upload_url:url},{file_id:fileId,upload_url:url,expires_at:'invalid'}, {file_id:fileId,upload_url:signedURL({issued:Date.now()-1000000}),expires_at:null}]){
    await assert.rejects(invoke(f,{'body:file_name':'requests.jsonl'},async()=>Response.json(body,{status:201}),{adoptPrivateResults:async()=>{adoptions++;return[];}}));
  }
  await assert.rejects(invoke(f,{'body:file_name':'requests.jsonl'},async()=>Response.json({upload_url:url},{status:403,headers:{Location:url}}),{adoptPrivateResults:async()=>{adoptions++;return[];}}),error=>{assert.ok(error instanceof CredentialResponseError);safe(error.response,url);assert.equal(error.response.body,null);return true;});assert.equal(adoptions,0);
});
Then('DigitalOcean signed uploads use their bound storage origin and never forward an account token',async()=>{
  for(const saved of[true,false])for(const type of[undefined,'application/octet-stream','application/x-ndjson']){
    const url=signedURL({headers:type?'content-type;host':'host'}),f=await authorize(digitalOceanUploadId,record(url),saved);let calls=0;
    const result=await invoke(f,uploadValues(type),async(target,init)=>{
      calls++;assert.equal(target,url);assert.equal(init.method,'PUT');assert.equal(init.headers.has('Authorization'),false);assert.equal(init.headers.has('Cookie'),false);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
      assert.equal(init.headers.get('Content-Type'),type??'application/octet-stream');assert.deepEqual(new Uint8Array(await init.body.arrayBuffer()),bytes);
      return Response.json({uploaded:true,reflected_url:url,signature,sessionToken});
    });assert.equal(calls,1);assert.equal(result.response.body.uploaded,true);safe(result,url);assert.equal(result.request.path,digitalOceanUploadPath);
  }
});
Then('DigitalOcean upload validation rejects unsafe hosts altered signatures expired capabilities and wrong connection origins',async()=>{
  const url=signedURL(),{descriptor}=await authorize(digitalOceanUploadId,record(url));
  const invalid=[url.replace('https:','http:'),url.replace('batch-inference.nyc3.digitaloceanspaces.com','evil.example.test'),url.replace('batch-inference.nyc3.digitaloceanspaces.com','127.0.0.1'),url+'#fragment',url.replace('https://','https://user:pass@'),url.replace(signature,'bad'),url+'&X-Amz-Signature='+signature,url.replace('AWS4-HMAC-SHA256','unknown'),url.replace('%2Fs3%2F','%2Fec2%2F'),url.replace('X-Amz-Expires=900','X-Amz-Expires=604801'),signedURL({issued:Date.now()-1000000})];
  for(const value of invalid)assert.throws(()=>digitalOceanUploadUrl(descriptor,digitalOceanUploadPath,value));
  const wrong=signedURL({host:'https://other-bucket.nyc3.digitaloceanspaces.com'});assert.throws(()=>digitalOceanUploadUrl(descriptor,digitalOceanUploadPath,wrong));
  let calls=0;const f=await authorize(digitalOceanUploadId,record(signedURL({issued:Date.now()-1000000})));
  await assert.rejects(invoke(f,uploadValues(),async()=>{calls++;return new Response('');}));
  assert.throws(()=>prepareRequest(f.operation,uploadValues('application/octet-stream\r\nAuthorization: leaked')));assert.equal(calls,0);
});
Then('the privately adopted DigitalOcean file intent can authorize its exact upload and retains the shorter expiry',async()=>{
  const url=signedURL(),{operation}=await model(producer),expires=new Date(Date.now()+30000).toISOString();
  const prepared=prepareCredentialResults(credentialResultProfile(operation),201,{file_id:fileId,upload_url:url,expires_at:expires});
  const reference={credentialId:crypto.randomUUID(),label:'Signed upload'},publicBody=prepared.complete([reference]);safe(publicBody,url);assert.equal(publicBody.upload_origin,origin);
  const credential={...record(prepared.values[0].value),id:reference.credentialId},f=await authorize(digitalOceanUploadId,credential,false);
  assert.equal(parseDigitalOceanUploadUrl(credential.value).expiresAt,Date.parse(expires));assert.throws(()=>parseDigitalOceanUploadUrl(credential.value,Date.parse(expires)));
  let calls=0;await invoke(f,uploadValues(),async(target)=>{calls++;assert.equal(target,url);return new Response('',{status:200});});assert.equal(calls,1);
});
Then('DigitalOcean agent requests bind their configured key and origin and support bounded opt-in streaming',async()=>{
  const key='SYNTHETIC_AGENT_ACCESS_KEY_84571',f=await authorize(agent,record(key));const values={'query:agent':'true','body:model':'ignored','body:messages':'[{"role":"user","content":"Hello"}]'};
  const request=prepareRequest(f.operation,values);assert.equal(request.body.stream,false);assert.throws(()=>prepareRequest(f.operation,{...values,'query:agent':'false'}));
  let calls=0;const plain=await invoke(f,values,async(target,init)=>{calls++;assert.equal(target,`https://${agentHost}/api/v1/chat/completions?agent=true`);assert.equal(init.headers.get('Authorization'),`Bearer ${key}`);assert.equal(init.headers.get('Accept'),'application/json');assert.equal(JSON.parse(init.body).stream,false);return Response.json({choices:[{message:{content:'Hello Ω'}}]});});assert.ok(JSON.stringify(plain.response.body).includes('Hello Ω'));
  let samples=0;const chunk={id:'fixture-chat',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{content:'Streamed Ω'},finish_reason:null}]};
  const stream=await invoke(f,{...values,'body:stream':'true'},async(target,init)=>{calls++;assert.equal(init.headers.get('Accept'),'text/event-stream');assert.equal(JSON.parse(init.body).stream,true);return new Response('data: '+JSON.stringify(chunk)+'\n\ndata: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});},{onValue:sample=>{samples++;assert.ok(JSON.stringify(sample.body).includes('Streamed Ω'));}});
  assert.equal(calls,2);assert.equal(samples,0);assert.equal(stream.response.body.object,'chat.completion');assert.equal(stream.response.body.choices[0].message.content,'Streamed Ω');assert.ok(!JSON.stringify([plain,stream]).includes(key));
  const changed=structuredClone(f.descriptor);changed.origin='https://other-agent.agents.do-ai.run';let unexpected=0;
  await assert.rejects(executeCredentialed(changed,values,f.binding,[f.credential],{assertCurrent(){},fetchRequest:async()=>{unexpected++;return Response.json({});}}));assert.equal(unexpected,0);
});
Then('unconfigured or public DigitalOcean uploads cannot bypass their private connection or send an account credential',async()=>{
  const {doc,operation}=await model(digitalOceanUploadId,false);assert.throws(()=>operationServerUrl(doc,operation));
  const url=signedURL(),f=await authorize(digitalOceanUploadId,record(url),false);let calls=0;
  await invoke(f,uploadValues(),async()=>{calls++;return new Response('');});assert.equal(calls,1);
  const configured=await model(digitalOceanUploadId),previous=[...catalogs],partial={...configured.doc,paths:{[digitalOceanUploadPath]:configured.doc.paths[digitalOceanUploadPath]}};
  updateCatalogs([...previous.filter(item=>item.id!=='digitalocean'),{id:'digitalocean',name:'DigitalOcean fixture',file:'digitalocean-fixture.json',document:partial,groups:[],execution:{kind:'http',origin}}]);
  try{await assert.rejects(createWorkflowRequestExecution(async()=>{calls++;return new Response('');}).execute(configured.operation,uploadValues(),undefined,{binding:f.binding,runId:crypto.randomUUID(),nodeId:'upload'}));assert.equal(calls,1);}finally{updateCatalogs(previous);}
  const graph=createOperationGraph((await model(producer)).operation,{x:0,y:0},'digitalocean-fixture',await document());
  assert.ok(graph.nodes.length>0);const serialized=JSON.stringify(graph);assert.ok(serialized.includes('upload_origin'));safe(graph,url);
  const saved=validateWorkflowDocument({version:2,id:crypto.randomUUID(),name:'Private file intent',...graph,viewport:{x:0,y:0,zoom:1},snap:true,curved:true,dashed:false});assert.deepEqual(parseWorkflowDocument(JSON.stringify(saved)),saved);
});

Then('DigitalOcean chat streaming assembles split text tool arguments and usage and rejects truncated or inconsistent frames',async()=>{
  const base={id:'fixture',object:'chat.completion.chunk',created:1,model:'fixture-model'};
  const frame=choices=>({...base,choices});
  const chunks=[frame([{index:0,delta:{role:'assistant',content:'Hello '},finish_reason:null},{index:1,delta:{role:'assistant',tool_calls:[{index:0,id:'call_',type:'function',function:{name:'look',arguments:'{'}}]},finish_reason:null}]),
    frame([{index:0,delta:{content:'Ω'},finish_reason:'stop'},{index:1,delta:{tool_calls:[{index:0,id:'fixture',function:{name:'up',arguments:'"x":1}'}}]},finish_reason:'tool_calls'}]),
    {...base,choices:[],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}}];
  const text=chunks.map(c=>'data: '+JSON.stringify(c)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n';
  const encoded=new TextEncoder().encode(text),body=new ReadableStream({start(controller){for(let i=0;i<encoded.length;i+=7)controller.enqueue(encoded.slice(i,i+7));controller.close();}});
  const result=await readResponseStream(new Response(body),'openai-chat',new AbortController().signal);
  assert.equal(result.body.object,'chat.completion');assert.equal(result.body.choices[0].message.content,'Hello Ω');
  assert.deepEqual(result.body.choices[1].message.tool_calls,[{id:'call_fixture',type:'function',function:{name:'lookup',arguments:'{"x":1}'}}]);
  assert.deepEqual(result.body.usage,{prompt_tokens:2,completion_tokens:3,total_tokens:5});assert.equal(result.stream.events,4);
  for(const bad of[text.replace('data: [DONE]\r\n\r\n',''), 'data: '+JSON.stringify(chunks[0])+'\n\ndata: [DONE]\n\n',
    'data: '+JSON.stringify(chunks[0])+'\n\ndata: '+JSON.stringify({...chunks[1],id:'different'})+'\n\ndata: [DONE]\n\n',
    'data: '+JSON.stringify({...base,choices:'invalid'})+'\n\ndata: [DONE]\n\n'])await assert.rejects(readResponseStream(new Response(bad),'openai-chat',new AbortController().signal));
});
