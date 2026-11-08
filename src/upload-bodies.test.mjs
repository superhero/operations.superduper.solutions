// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Then} from '@cucumber/cucumber';
import {vi} from 'vitest';
import {uploadBodyContracts,uploadBodySources,bindUploadBodies,googleMediaProfile,rawUploadProfile} from './lib/upload-body-contracts.ts';
import {applySchemaPatches,uploadBodyContractsPatch} from './lib/schema-patches.ts';
import {readServiceSchema,readServiceSchemaUpstream} from './lib/service-schema-packs.ts';
import {inspectServiceSchema,serviceInputSchema} from './lib/service-catalog.ts';
import {prepareRequest} from './lib/operation-input.ts';
import {requestBody} from './lib/request-body.ts';
import {encodeWorkflowBinary,maxWorkflowUploadBytes} from './lib/workflow-binary.ts';
import {validUploadModel,configureMediaUpload,mediaUploadMode,prepareMediaUpload,googleRelatedBody} from './lib/media-upload.ts';
import {configureGmailMessage,gmailMessageProfile,gmailMessageMode,prepareGmailMessage,gmailRelatedBody,validGmailMessage} from './lib/gmail-message.ts';
import {createOperationGraph} from './lib/workflow-graph.ts';
import {operationServerUrl} from './lib/schema-documents.ts';
import {approvedOperation} from './lib/secrets/policy.ts';
import {executeCredentialed} from './lib/secrets/execution.ts';

const entries=Object.entries(uploadBodyContracts),google=entries.filter(([,c])=>c.kind==='google-media');
const bytes=Uint8Array.of(0,255,13,10,128,43,37,195,169,1,2,3),cache=new Map();
async function model(id){
  const c=uploadBodyContracts[id];let document=cache.get(c.catalog);
  if(!document){document=await readServiceSchema(c.catalog);cache.set(c.catalog,document);}
  const operation=inspectServiceSchema(document,c.catalog,new Set([id])).operations.find(o=>o.id===id);
  assert.ok(operation&&!operation.unavailableReason,`${id}: ${operation?.unavailableReason}`);return {document,operation};
}
function parameters(operation){
  const values={};
  for(const field of operation.fields.filter(f=>f.location!=='body'&&(f.required||f.defaultValue!==undefined))){
    let value=field.defaultValue;
    if(value===undefined){
      value=field.type==='array'?['snippet']:field.type==='integer'||field.type==='number'?1:field.type==='boolean'?false
        :field.name==='did'?'did:plc:fixtureaccount':field.name==='type'?'issuetype':field.name==='part'?'snippet'
        :field.name==='parent'?operation.id.startsWith('google-chat:')?'spaces/fixture-space':'projects/fixture-project/locations/us-central1/repositories/fixture-repository':'fixture';
    }
    values[field.key]=typeof value==='string'?value:JSON.stringify(value);
  }
  return values;
}
function mediaFile(c){
  const type=c.kind==='google-media'?(c.catalog==='google-youtube'&&c.path.includes('captions')?'text/xml':c.path.includes('videos')?'video/mp4':'image/png')
    :c.contentType??(c.catalog==='jira'?'image/png':'application/octet-stream');
  return encodeWorkflowBinary('upload-λ.bin',bytes,type);
}
function metadata(c){
  if(c.operationId.includes('kfpArtifacts'))return {description:'Keep this metadata Ω',tags:['stable','v2']};
  if(c.catalog==='google-chat')return {filename:'original-λ.bin'};
  if(c.catalog==='google-drive')return {name:'original-λ.bin',description:'Keep this metadata Ω',appProperties:{classification:'fixture'}};
  if(c.operationId==='youtube.videos.insert')return {snippet:{title:'Full metadata Ω',description:'Preserved',tags:['fixture']},status:{privacyStatus:'private'}};
  return {};
}
async function relatedParts(body){
  assert.ok(body instanceof Blob);
  const wire=new Request('https://fixture.example.test/upload',{method:'POST',body});
  const type=wire.headers.get('content-type');assert.match(type,/^multipart\/related; boundary=/);
  const boundary=type.split('boundary=')[1],raw=Buffer.from(await wire.arrayBuffer()).toString('latin1');
  const chunks=raw.split('--'+boundary);assert.equal(chunks.length,4);assert.equal(chunks[0],'');assert.equal(chunks[3],'--\r\n');
  const parts=chunks.slice(1,3).map(part=>{assert.ok(part.startsWith('\r\n')&&part.endsWith('\r\n'));const split=part.indexOf('\r\n\r\n');assert.ok(split>0);return {headers:part.slice(2,split),body:Buffer.from(part.slice(split+4,-2),'latin1')};});
  assert.equal(parts[0].headers,'Content-Type: application/json; charset=UTF-8');
  return {metadata:JSON.parse(parts[0].body.toString('utf8')),file:new Uint8Array(parts[1].body),mediaHeader:parts[1].headers};
}
Then('all 44 upload body contracts retain their original declarations and have usable canonical models',async()=>{
  assert.equal(entries.length,44);
  for(const [catalog,contract]of Object.entries(uploadBodySources)){
    const raw=await readServiceSchemaUpstream(catalog),before=JSON.stringify(raw);
    assert.equal(createHash('sha256').update(before).digest('hex'),contract.sha256);
    const patched=applySchemaPatches(raw,[uploadBodyContractsPatch]);assert.equal(JSON.stringify(raw),before);
    for(const [id,c]of entries.filter(([,c])=>c.catalog===catalog)){
      const op=patched.paths[c.path][c.method.toLowerCase()];assert.deepEqual(op['x-upstream-upload-body'],c.requestBody);
      const original=raw.paths[c.path][c.method.toLowerCase()],rest=structuredClone(op);
      for(const key of ['requestBody','servers','parameters','security','x-upstream-upload-body','x-upstream-upload-parameters','x-upstream-video-upload','x-operations-google-media','x-operations-raw-upload'])delete rest[key];
      const originalRest=structuredClone(original);for(const key of ['requestBody','servers','parameters','security'])delete originalRest[key];assert.deepEqual(rest,originalRest,id);
      const {operation}=await model(id);assert.equal(operation.id,id);
      if(c.kind==='google-media')assert.deepEqual(operation.fields.find(f=>f.key==='body:$').schema,serviceInputSchema(c.schema,raw,false));
      if(c.kind==='binary'||c.kind==='google-media')assert.equal(validUploadModel(operation),true,id);
    }
  }
});
Then('upload body corrections reject changed source identities shapes and destinations before mutation',async()=>{
  for(const [catalog]of Object.entries(uploadBodySources)){
    const raw=await readServiceSchemaUpstream(catalog),[,c]=entries.find(([,c])=>c.catalog===catalog);
    for(const change of [d=>d.info.version='unreviewed',d=>d.servers=[{url:'https://unreviewed.example.test'}],d=>d.paths[c.path][c.method.toLowerCase()].operationId='unreviewed',d=>d.paths[c.path][c.method.toLowerCase()].requestBody={content:{}}]){
      const document=structuredClone(raw);change(document);const before=JSON.stringify(document);
      assert.throws(()=>bindUploadBodies(document),/reviewed native declaration/);assert.equal(JSON.stringify(document),before);
    }
  }
});
Then('wildcard JSON text and multipart bodies retain typed values and Atlassian upload headers',async()=>{
  for(const id of ['jira-dc:PUT /api/2/filter/{id}/columns','jira-service-management-dc:PUT /api/2/filter/{id}/columns']){
    const {operation}=await model(id),request=prepareRequest(operation,{...parameters(operation),'body:columns':'["summary","description"]'});
    assert.equal(operation.bodyMediaType,'application/json');assert.deepEqual(JSON.parse(requestBody(request)),{columns:['summary','description']});
  }
  const {operation:text}=await model('bitbucket-dc:POST /api/latest/markup/preview'),content='**Bold**\nUnicode Ω';
  assert.equal(requestBody(prepareRequest(text,{...parameters(text),'body:$':content})),content);
  const {operation:hook}=await model('bitbucket-dc:PUT /api/latest/hook-scripts/{scriptId}');
  const request=prepareRequest(hook,{...parameters(hook),'body:content':'#!/bin/sh\nprintf λ\n','body:name':'Hook Ω','body:description':'Preserve fields'});
  assert.equal(request.headers['X-Atlassian-Token'],'no-check');
  const wire=new Request('https://fixture.example.test/hook',{method:'PUT',body:requestBody(request)}),form=await wire.formData();
  assert.equal(await form.get('content').text(),'#!/bin/sh\nprintf λ\n');assert.equal(form.get('content').type,'text/plain');assert.equal(form.get('name'),'Hook Ω');assert.equal(form.get('description'),'Preserve fields');
});
Then('reviewed raw uploads preserve exact bytes and reject malformed or unsupported files',async()=>{
  for(const [id,c]of entries.filter(([,c])=>c.kind==='binary')){
    const {operation}=await model(id),file=mediaFile(c),values={...parameters(operation),'body:$':JSON.stringify(file)},request=prepareRequest(operation,values),body=requestBody(request);
    assert.equal(request.bodyFormat,'binary');assert.equal(request.contentType,c.contentType??file.mediaType);assert.deepEqual(new Uint8Array(await body.arrayBuffer()),bytes);
    if(!c.requestBody.required){const omitted=prepareRequest(operation,parameters(operation));assert.equal(omitted.body,undefined);assert.equal(requestBody(omitted),null);}
    if(c.catalog==='jira')assert.equal(request.headers['X-Atlassian-Token'],'no-check');
    for(const changed of [{...file,base64:'invalid!'},{...file,size:file.size+1},{...file,name:'bad\r\nfilename'},{...file,size:maxWorkflowUploadBytes+1,base64:Buffer.alloc(maxWorkflowUploadBytes+1).toString('base64')}])
      assert.throws(()=>prepareRequest(operation,{...values,'body:$':JSON.stringify(changed)}));
    if(c.catalog==='jira')assert.throws(()=>prepareRequest(operation,{...values,'body:$':JSON.stringify({...file,mediaType:'image/svg+xml'})}),/reviewed media contract/);
  }
});
Then('all reviewed Google uploads send full JSON metadata before exact media bytes on their native upload paths',async()=>{
  assert.equal(google.length,14);
  for(const [id,c]of google){
    const {operation}=await model(id),resource=metadata(c),file=mediaFile(c),base=parameters(operation);
    const request=prepareRequest(operation,{...base,'body:$':JSON.stringify(resource),'body:$media':JSON.stringify(file)});
    const parts=await relatedParts(requestBody(request));assert.deepEqual(parts.metadata,resource,id);assert.deepEqual(parts.file,bytes,id);
    const expected=c.discovery.mediaUpload.protocols.simple.path.replaceAll('{+parent}',base['path:parent']).replace('{fileId}',base['path:fileId']);
    assert.equal(request.path,expected,id);assert.equal(request.query.uploadType,'multipart');assert.equal(request.path.includes('%2F'),false);
    const plain=prepareRequest(operation,{...base,'body:$':JSON.stringify(resource)});assert.deepEqual(JSON.parse(requestBody(plain)),resource);assert.equal(plain.query.uploadType,undefined);
    const media=prepareRequest(operation,{...base,'body:$media':JSON.stringify(file)});assert.equal(media.bodyFormat,'binary');assert.equal(media.query.uploadType,'media');assert.deepEqual(new Uint8Array(await requestBody(media).arrayBuffer()),bytes);
  }
});
Then('authenticated Google uploads retain query values and redact credentials without implicit retries',async()=>{
  for(const [id,c]of google){
    const {document,operation}=await model(id),alternative=operation.security.findIndex(option=>option.length===1&&option[0].kind==='bearer');assert.ok(alternative>=0,id);
    const descriptor=await approvedOperation(operation,operationServerUrl(document,operation)),scheme=operation.security[alternative][0];
    const record={id:crypto.randomUUID(),label:'Upload fixture',value:'SYNTHETIC_GOOGLE_UPLOAD_TOKEN_8312',kind:'secret',grants:[]};
    const binding={alternative,fingerprint:descriptor.fingerprint,credentials:{[scheme.name]:record.id}};let calls=0,fetchError;
    const values={...parameters(operation),'body:$':JSON.stringify(metadata(c)),'body:$media':JSON.stringify(mediaFile(c))};
    const result=await executeCredentialed(descriptor,values,binding,[record],{assertCurrent(){},fetchRequest:async(url,init)=>{
      try{calls++;const target=new URL(url);assert.equal(target.origin,c.discovery.rootUrl.replace(/\/$/,''));assert.equal(target.pathname,prepareRequest(operation,values).path);assert.equal(target.searchParams.get('uploadType'),'multipart');
        for(const [key,value]of Object.entries(prepareRequest(operation,values).query))if(typeof value==='string')assert.equal(target.searchParams.get(key),value);
        assert.equal(init.headers.get('Authorization'),`Bearer ${record.value}`);assert.equal(init.headers.has('Content-Type'),false);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
        const parts=await relatedParts(init.body);assert.deepEqual(parts.metadata,metadata(c));assert.deepEqual(parts.file,bytes);return Response.json({uploaded:true,reflection:record.value});
      }catch(error){fetchError=error;throw error;}
    }}).catch(error=>{throw fetchError??error;});
    assert.equal(calls,1);assert.equal(result.response.body.uploaded,true);assert.ok(!JSON.stringify(result).includes(record.value));
    await assert.rejects(executeCredentialed(descriptor,values,binding,[record],{assertCurrent(){},fetchRequest:async()=>{calls++;return Response.json({error:record.value},{status:403});}}),error=>{assert.ok(!JSON.stringify(error.response).includes(record.value));return true;});assert.equal(calls,2);
  }
});
Then('upload preparation rejects changed modes unsafe resource paths and stale body models',async()=>{
  const [id,c]=google.find(([,c])=>c.catalog==='gcp-artifactregistry'),{operation}=await model(id),base={...parameters(operation),'body:$':JSON.stringify(metadata(c)),'body:$media':JSON.stringify(mediaFile(c))};
  for(const changed of [{'query:uploadType':'resumable'},{'query:upload_protocol':'raw'},{'query:uploadType':'media'},{'body:unreviewed':'value'},{'path:parent':'projects/../locations/us/repositories/r'},{'body:$media':'{"kind":"workflow-file"}'}])assert.throws(()=>prepareRequest(operation,{...base,...changed}));
  const changed=structuredClone(operation);changed.bodySchema.properties.$media.maxLength++;assert.equal(validUploadModel(changed),false);assert.throws(()=>prepareRequest(changed,base));
});
Then('video uploads target the video service with the account DID filename and delegated authorization',async()=>{
  const id='bluesky-app:app.bsky.video.uploadVideo',c=uploadBodyContracts[id],{document,operation}=await model(id);
  assert.equal(operationServerUrl(document,operation),'https://video.bsky.app');assert.equal(operation.security[0][0].name,'BlueskyVideoServiceAuth');
  const descriptor=await approvedOperation(operation,operationServerUrl(document,operation)),record={id:crypto.randomUUID(),label:'Delegated fixture',value:'SYNTHETIC_DELEGATED_VIDEO_AUTH_8312',kind:'secret',grants:[]};
  const binding={alternative:0,fingerprint:descriptor.fingerprint,credentials:{BlueskyVideoServiceAuth:record.id}},file=mediaFile(c);let fetchError;
  const result=await executeCredentialed(descriptor,{...parameters(operation),'body:$':JSON.stringify(file)},binding,[record],{assertCurrent(){},fetchRequest:async(url,init)=>{
    try{const target=new URL(url);assert.equal(target.origin,'https://video.bsky.app');assert.equal(target.pathname,'/xrpc/app.bsky.video.uploadVideo');assert.equal(target.searchParams.get('did'),'did:plc:fixtureaccount');assert.equal(target.searchParams.get('name'),file.name);
      assert.equal(init.headers.get('Authorization'),`Bearer ${record.value}`);assert.equal(init.headers.get('Content-Type'),'video/mp4');assert.deepEqual(new Uint8Array(await init.body.arrayBuffer()),bytes);return Response.json({jobStatus:{jobId:'fixture-job'}});
    }catch(error){fetchError=error;throw error;}
  }}).catch(error=>{throw fetchError??error;});assert.equal(result.response.body.jobStatus.jobId,'fixture-job');assert.ok(!JSON.stringify(result).includes(record.value));
});

Then('media helpers preserve model identity metadata limits and collision-free related envelopes',()=>{
  const googleId='google-youtube:youtube.videos.insert',rawId='jira:createIssueTypeAvatar';
  const bare=id=>({id,method:uploadBodyContracts[id].method,path:uploadBodyContracts[id].path,fields:[],bodyRequired:false,
    bodyMediaType:'application/json',bodySchema:{type:'object',properties:{title:{type:'string'}}}});
  const makeGoogle=()=>{const operation=bare(googleId);configureMediaUpload(operation,googleMediaProfile,undefined);return operation;};
  const googleModel=makeGoogle();assert.equal(validUploadModel(googleModel),true);assert.equal(validUploadModel(bare(googleId)),false);
  for(const change of [{id:'unreviewed'}, {method:'DELETE'}, {path:'/foreign'}])
    assert.throws(()=>configureMediaUpload({...bare(googleId),...change},googleMediaProfile,undefined),/reviewed native/);
  for(const change of [{bodyMediaType:'text/plain'},{bodySchema:{type:'string'}},{binaryMediaTypes:[]},{multipartParts:{}}])
    assert.throws(()=>configureMediaUpload({...bare(googleId),...change},googleMediaProfile,undefined),/complete JSON metadata/);
  const raw={...bare(rawId),bodyMediaType:'application/octet-stream',bodyValue:true,
    bodySchema:{type:'string',format:'binary',maxLength:maxWorkflowUploadBytes},binaryMediaTypes:['application/octet-stream']};
  configureMediaUpload(raw,undefined,rawUploadProfile);assert.equal(validUploadModel(raw),true);
  for(const change of [{bodyMediaType:'text/plain'},{bodySchema:{type:'string'}}])
    assert.throws(()=>configureMediaUpload({...raw,...change},undefined,rawUploadProfile),/reviewed file/);
  assert.equal(validUploadModel({...raw,id:'unreviewed'}),false);assert.equal(validUploadModel({...googleModel,id:'unreviewed'}),false);
  assert.throws(()=>prepareMediaUpload({...raw,bodyValue:false},{body:{}},undefined),/reviewed file model/);
  const missingProperties=structuredClone(googleModel);delete missingProperties.bodySchema.properties;assert.equal(validUploadModel(missingProperties),false);
  assert.throws(()=>mediaUploadMode(googleModel,{}),/Provide the native JSON metadata/);
  assert.throws(()=>mediaUploadMode(googleModel,{'body:$':'{}','query:uploadType':null}),/uploadType supports/);
  const metadataMode=mediaUploadMode(googleModel,{'body:$':'{}'});
  assert.throws(()=>prepareMediaUpload(googleModel,{method:'POST',path:googleModel.path,query:{}},metadataMode),/metadata is missing/);
  const file=encodeWorkflowBinary('fixture.bin',Uint8Array.of(1),'application/x-fixture');
  const multipart=mediaUploadMode(googleModel,{'body:$media':JSON.stringify(file),'query:uploadType':'multipart'});
  const prepared=prepareMediaUpload(googleModel,{method:'POST',path:googleModel.path,query:{},body:{$media:file}},multipart);
  assert.deepEqual(prepared.body.metadata,{});assert.equal(prepared.body.file.mediaType,'application/octet-stream');
  const restricted=structuredClone(multipart);restricted.profile.discovery.mediaUpload.accept=['video/mp4'];
  assert.throws(()=>prepareMediaUpload(googleModel,{method:'POST',path:googleModel.path,query:{},body:{$media:file}},restricted),/Content-Type is not accepted/);
  for(const value of [null,[],{}, {metadata:null,file},{metadata:[],file}])assert.throws(()=>googleRelatedBody(value),/JSON metadata and a binary file/);
  assert.throws(()=>googleRelatedBody({metadata:{text:'x'.repeat(maxWorkflowUploadBytes)},file}),/metadata exceeds/);
  const gmail={id:'google-gmail:gmail.users.messages.send',method:'POST',path:'/gmail/v1/users/{userId}/messages/send',fields:[],
    bodyMediaType:'application/json',bodySchema:{type:'object',properties:{labelIds:{type:'array',items:{type:'string'}}}}};
  for(const change of [{bodyMediaType:'text/plain'},{bodySchema:{type:'array'}},{binaryMediaTypes:[]},{multipartParts:{}}])
    assert.throws(()=>configureGmailMessage({...gmail,...change},gmailMessageProfile),/native JSON resource/);
  configureGmailMessage(gmail,gmailMessageProfile);
  assert.throws(()=>gmailMessageMode({...gmail,bodyValue:true},{'body:$':'{}'}),/reviewed contract/);
  assert.throws(()=>prepareGmailMessage({path:gmail.path,query:{},body:{}},{}),/resource is missing/);
  const mime=encodeWorkflowBinary('message.eml',Uint8Array.of(65),'message/rfc822');
  for(const metadata of [null,[],1])assert.throws(()=>prepareGmailMessage({path:gmail.path,query:{},body:{$:metadata}},{file:mime}),/JSON resource object/);
  for(const value of [null,[],{}, {metadata:null,file:mime},{metadata:[],file:mime}])assert.throws(()=>gmailRelatedBody(value),/metadata and a MIME file/);
  for(const invalid of [encodeWorkflowBinary('empty.eml',new Uint8Array(),'message/rfc822'),file])
    assert.throws(()=>gmailRelatedBody({metadata:{},file:invalid}),/invalid message bytes/);
  assert.throws(()=>gmailRelatedBody({metadata:{text:'x'.repeat(maxWorkflowUploadBytes)},file:mime}),/metadata budget/);
  const id='11111111-1111-4111-8111-111111111111',nonce=vi.spyOn(crypto,'randomUUID').mockReturnValue(id);
  try {
    const metadata={collision:'operations-'+id};
    assert.throws(()=>googleRelatedBody({metadata,file}),/collision-free Google/);
    assert.throws(()=>gmailRelatedBody({metadata,file:mime}),/collision-free Gmail/);
    assert.equal(nonce.mock.calls.length,6);
  } finally {nonce.mockRestore();}
});

Then('media workflow graphs preserve resource fields with or without native request declarations',async()=>{
  const id=google[0][0],{operation:upload}=await model(id),c=uploadBodyContracts[id],file=mediaFile(c);
  assert.throws(()=>mediaUploadMode(upload,{...parameters(upload),'body:$':'{}','body:$media':JSON.stringify(file),'query:uploadType':'media'}),/does not match/);
  assert.equal(mediaUploadMode(upload,{...parameters(upload),'body:$media':JSON.stringify(file),'query:uploadType':'media'}).multipart,false);
  const gmail={id:'google-gmail:gmail.users.messages.send',method:'POST',path:'/gmail/v1/users/{userId}/messages/send',name:'Send',description:'',fields:[],
    bodyMediaType:'application/json',bodySchema:{type:'object',properties:{labelIds:{type:'array',items:{type:'string'}}}}};
  configureGmailMessage(gmail,gmailMessageProfile);
  const invalid=structuredClone(gmail);delete invalid.bodySchema.properties;assert.equal(validGmailMessage(invalid),false);
  for(const operation of [upload,gmail]){
    const expected=operation.googleMedia?['Metadata','Media file']:['Message resource','MIME message'];
    const fallback=operation.bodySchema.properties.$;
    const source=resource=>({paths:{[operation.path]:{[operation.method.toLowerCase()]:{requestBody:{content:resource}}}}});
    for(const document of [{},source({}),source({'application/json':{schema:fallback}})]){
      const graph=createOperationGraph(operation,{x:0,y:0},'owned-media',document),fields=graph.nodes.filter(node=>node.type==='data'&&node.data.direction==='inputs').flatMap(node=>node.data.fields);
      for(const name of expected)assert.ok(fields.some(field=>field.label===name),name);
      for(const name of Object.keys(fallback.properties??{}))assert.ok(fields.some(field=>field.label===name||field.label===fallback.properties[name].title),name);
    }
    const unavailable=structuredClone(operation);delete unavailable.bodySchema;
    const graph=createOperationGraph(unavailable,{x:0,y:0},'owned-missing-resource'),fields=graph.nodes.find(node=>node.type==='data'&&node.data.direction==='inputs'&&node.data.label==='Request body').data.fields;
    assert.deepEqual(fields.map(field=>field.label),expected);
  }
  await assert.rejects(approvedOperation({...upload,bodyValue:true},'https://upload.example.test'),error=>error.code==='PERMISSION');
  await assert.rejects(approvedOperation({...gmail,gmailMessage:undefined,multipartParts:{field:{kind:'text'}}},'https://upload.example.test'),error=>error.code==='PERMISSION');
});
