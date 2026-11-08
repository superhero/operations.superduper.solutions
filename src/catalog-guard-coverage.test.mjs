// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {encodeSimpleHeaderArray} from './lib/parameter-serialization.ts';
import {validateFormBody} from './lib/form-input.ts';
import {validateJsonLinesBody} from './lib/request-media.ts';
import {requestBody} from './lib/request-body.ts';
import {multipartShape,multipartBodySchema,multipartPartEncodings,validateMultipartParts,
  validateMultipartValue,appendMultipartPart,multipartBody} from './lib/multipart-parts.ts';
import {encodeWorkflowBinary} from './lib/workflow-binary.ts';
import * as corrections from './lib/schema-patches.ts';
import {extractOperations} from './lib/catalog.ts';
import {inspectServiceSchema,serviceInputSchema} from './lib/service-catalog.ts';
import {privateResultVersion} from './lib/credential-results.ts';
import {literalQueryRoute} from './lib/literal-query.ts';
import {connectJwtOriginAllowed} from './lib/atlassian-relative-servers.ts';
import {readServiceSchema,readServiceSchemaUpstream} from './lib/service-schema-packs.ts';
import {excludeRetiredGithubClassroom,retiredGithubClassroom} from './lib/github-classroom-retirement.ts';
import {bindMultipartRoots} from './lib/multipart-root-contracts.ts';
import multipartRoots from './lib/multipart-root-contracts.json' with {type:'json'};
import {bindAtlassianFiles} from './lib/atlassian-file-parts.ts';
import atlassianFiles from './lib/atlassian-file-parts.json' with {type:'json'};
import {bindAtlassianDcAuthentication} from './lib/atlassian-dc-authentication.ts';
import {bindCommerceAuthentication} from './lib/atlassian-commerce-authentication.ts';
import {bindUploadBodies,uploadBodyContracts} from './lib/upload-body-contracts.ts';
import {bindStructuredForms} from './lib/structured-form-contracts.ts';
import structuredForms from './lib/structured-form-contracts.json' with {type:'json'};
import {bindMultipartFiles} from './lib/multipart-file-contracts.ts';

const text={type:'string'},binary={type:'string',format:'binary'};
const root=field=>({type:'object',properties:{field}});
const identity=value=>value;
const nested=(value,count)=>{for(let i=0;i<count;i++)value={type:'object',properties:{child:value}};return value;};
const nestedValue=(value,count)=>{for(let i=0;i<count;i++)value={child:value};return value;};

Then('serialized header form and text contracts reject malformed values',()=>{
  const header={key:'header:values',name:'values',label:'Values',location:'header',type:'array',schema:{type:'array',items:text}};
  for(const value of [null,{},'one',[null],[{}],[Infinity]])assert.throws(()=>encodeSimpleHeaderArray(header,value),/non-null primitive/);
  assert.throws(()=>encodeSimpleHeaderArray({...header,location:'query'},['one']),/header array/);
  assert.equal(encodeSimpleHeaderArray(header,['one',2,false]),'one,2,false');
  for(const value of [null,false,[],1])assert.throws(()=>validateFormBody(root(text),true,value),/encoding must be an object/i);
  for(const value of [null,false,[],1])assert.throws(()=>validateFormBody(root(text),false,{field:value}),/custom encoding is not supported/);
  for(const value of [null,false,1,{},[],''])assert.throws(()=>validateJsonLinesBody(value),/nonempty text/);
  for(const value of [null,{},[],1])assert.throws(()=>requestBody({bodyFormat:'text',body:value}),/must be a string/);
  assert.equal(requestBody({bodyFormat:'text',body:'\u03bb\r\n'}),'\u03bb\r\n');
});

Then('multipart declarations reject incompatible encodings and excessive nesting',()=>{
  let wrapped=text;for(let i=0;i<20;i++)wrapped={allOf:[wrapped]};
  assert.ok(multipartShape(wrapped,identity).allOf,'A deep wrapper cannot bypass the flattening budget');
  assert.ok(multipartShape({allOf:[text],minLength:1},identity).allOf,'Assertions beside allOf must survive');
  assert.deepEqual(multipartShape({allOf:[text],'x-fixture':true},identity),{...text,'x-fixture':true});
  assert.deepEqual(multipartBodySchema({type:'object'},identity,identity).properties,{});
  assert.deepEqual(multipartPartEncodings(root(text),undefined),{});
  for(const value of [null,[],false])assert.throws(()=>multipartPartEncodings(root(text),value),/encoding must be an object/i);
  for(const declaration of [null,false,[],{contentType:5},{'x-operations-json-text':true,contentType:'text/plain'},
    {'x-operations-json-text':false,contentType:'application/json'},
    {'x-operations-json-text':true,contentType:'application/json, application/problem+json'},
    {contentType:'text/plain, text/html'}, {contentType:'text/plain','x-operations-part-name':'filename'}])
    assert.throws(()=>multipartPartEncodings(root(text),{field:declaration}),/Form part "field"/);
  for(const field of [{type:'integer'},binary])assert.throws(()=>multipartPartEncodings(root(field),
    {field:{contentType:'application/json','x-operations-json-text':true}}),/pre-encoded JSON/);
  for(const field of [{type:'object',properties:{file:binary}},{type:'object'}])
    assert.throws(()=>multipartPartEncodings(root(field),{field:{contentType:'text/plain'}}),/structured values/);
  for(const parts of [null,[],Object.fromEntries(Array.from({length:201},(_,i)=>['p'+i,{kind:'text'}]))])
    assert.throws(()=>validateMultipartParts(parts,root(text)),/multipart part contract/i);
  for(const part of [null,{kind:'json',contentTypes:[1]},{kind:'json',contentTypes:['x'.repeat(256)]}])
    assert.throws(()=>validateMultipartParts({field:part},root(text)),/invalid multipart part contract/);
  assert.throws(()=>validateMultipartParts({field:{kind:'text'}},{type:'object'}),/invalid multipart/);
  assert.throws(()=>multipartPartEncodings(root(nested(text,9)),{field:{'x-operations-form-style':'rack'}}),/depth budget/);
  assert.throws(()=>multipartPartEncodings(root({type:'json',anyOf:[text,binary]}),{field:{'x-operations-form-style':'rack'}}),/binary unions/);
  assert.throws(()=>validateMultipartParts({field:{kind:'brackets'}},root({type:'object',additionalProperties:{type:'json'}})),/representation/);
});

Then('multipart values reject partial writes and preserve escaped wire metadata',async()=>{
  const rejected=(value,part,pattern)=>{const form=new FormData();form.set('kept','original');assert.throws(()=>appendMultipartPart(form,'field',value,part),pattern);assert.deepEqual([...form],[['kept','original']]);};
  assert.throws(()=>validateMultipartValue('field',{kind:'file-or-url'},'relative/file'),/absolute HTTP/);
  assert.throws(()=>validateMultipartValue('field',{kind:'rack',binaryPaths:[['file']]},{file:{}}),/valid nested binary/);
  rejected(nestedValue('leaf',10),{kind:'rack'},/depth budget/);
  rejected(nestedValue('leaf',10),{kind:'brackets'},/depth or field budget/);
  rejected(Array.from({length:201},(_,i)=>i),{kind:'brackets'},/field budget/);
  for(const key of ['', 'bad[key]', 'bad\rkey'])rejected({[key]:'value'},{kind:'brackets'},/object keys/);
  for(const value of [null,{}])rejected(value,{kind:'scalar'},/non-null primitive/);
  for(const value of [null,{},Infinity])rejected(value,{kind:'text'},/primitive value/);
  rejected('not-a-list',{kind:'files'},/require an array/);
  const form=new FormData();appendMultipartPart(form,'field',{missing:null,kept:'yes'},{kind:'brackets'});
  assert.deepEqual([...form],[['field[kept]','yes']]);
  const json=new FormData();appendMultipartPart(json,'field',{ok:true},{kind:'json'});
  assert.equal(json.get('field').type,'application/json');assert.deepEqual(JSON.parse(await json.get('field').text()),{ok:true});
  const bundle=encodeWorkflowBinary('nested.bin',new TextEncoder().encode('--inner\r\nContent-Disposition: form-data; name="part"\r\n\r\nvalue\r\n--inner--'),'multipart/form-data');
  const outer=new FormData();appendMultipartPart(outer,'bundle',bundle,{kind:'file',contentTypes:['multipart/form-data']});
  assert.equal(outer.get('bundle').type,'multipart/form-data; boundary="inner"');
  const plain=new FormData();assert.equal(multipartBody(plain,undefined),plain);
  const wire=new FormData();wire.append('meta"\r\n','{}');wire.append('file',new Blob(['raw']),'name"\r\n.bin');wire.append('plain','ordinary');
  const body=multipartBody(wire,{'meta"\r\n':{kind:'json-text',contentTypes:['application/json']}}),raw=await body.text();
  assert.match(raw,/name="meta%22%0D%0A"\r\nContent-Type: application\/json\r\n/);
  assert.match(raw,/filename="name%22%0D%0A.bin"\r\nContent-Type: application\/octet-stream/);
  assert.ok(raw.endsWith('--\r\n'));assert.ok(raw.includes('\r\nraw\r\n'));
});

Then('catalog diagnostics name every registered correction and preserve malformed source reasons',()=>{
  const registered=Object.values(corrections).filter(value=>value&&typeof value==='object'&&typeof value.id==='string'&&Number.isInteger(value.version));
  assert.ok(registered.length>25);
  for(const recipe of registered){const name=corrections.schemaPatchName(recipe);assert.notEqual(name,'Unknown schema correction',recipe.id);assert.match(name,/\s/,recipe.id);}
  assert.equal(corrections.schemaPatchName({id:'future-contract',version:1}),'Unknown schema correction');
  const fixture=()=>({openapi:'3.1.0',info:{title:'Diagnostic boundary',version:'1'},servers:[{url:'https://boundary.example.test'}],
    paths:{'/check':{get:{operationId:'check',responses:{200:{description:'ok'}}}}}});
  const unknown=fixture();Object.assign(unknown.paths['/check'].get,{'x-operations-credential-result':true,'x-operations-private-result':'future-result'});
  assert.throws(()=>extractOperations(unknown,'boundary'),/Unknown private credential-result profile/);
  assert.match(inspectServiceSchema(unknown,'boundary').operations[0].unavailableReason,/Unknown private credential-result profile/);
  const orphan=fixture();orphan.paths['/check'].get['x-operations-private-result']=privateResultVersion;
  assert.throws(()=>extractOperations(orphan,'boundary'),/requires credential-result metadata/);
  const thrown=fixture();Object.defineProperty(thrown.servers[0],'url',{get(){throw 'Server lookup failed';}});
  assert.match(inspectServiceSchema(thrown,'boundary').operations[0].unavailableReason,/Server lookup failed/);
  assert.deepEqual(serviceInputSchema({type:'string',propertyNames:{pattern:'^[a-z]+$'}},{},false),{type:'json'});
  for(const path of ['relative?beta=true','/check?other=1?beta=true'])assert.equal(literalQueryRoute(path),undefined);
  const migration={id:'atlassian-app-migration:GET /transfer/recent',method:'GET',path:'/transfer/recent'};
  assert.equal(connectJwtOriginAllowed(migration,'not a URL'),false);
  assert.equal(connectJwtOriginAllowed({id:'owned:check',method:'GET',path:'/check'},'https://owned.atlassian.net'),false);
});

const inheritParameters=(document,contract)=>{
  const item=document.paths[contract.path],operation=item[contract.method.toLowerCase()];
  const inherited=[...(item.parameters??[]),...(operation.parameters??[])];
  item.parameters=inherited;delete operation.parameters;
  return {item,operation,inherited:structuredClone(inherited)};
};
Then('native upload corrections preserve inherited parameters and path metadata',async()=>{
  const jira=await readServiceSchemaUpstream('jira-dc');
  const roots=Object.values(multipartRoots.operations).filter(contract=>contract.catalog==='jira-dc').map(contract=>inheritParameters(jira,contract));
  bindMultipartRoots(jira);
  for(const {item,operation,inherited} of roots){assert.deepEqual(item.parameters,inherited);assert.equal(operation['x-upstream-multipart-root'].parameters,null);assert.deepEqual(operation.parameters.map(field=>field.name),['X-Atlassian-Token']);}
  const bamboo=await readServiceSchemaUpstream('bamboo'),file=Object.values(atlassianFiles.operations).find(contract=>contract.catalog==='bamboo');
  const {item,operation,inherited}=inheritParameters(bamboo,file);bindAtlassianFiles(bamboo);
  assert.deepEqual(item.parameters,inherited);assert.equal(operation['x-upstream-atlassian-file-request'].parameters,null);
  assert.deepEqual(operation.parameters.map(field=>field.name),['X-Atlassian-Token','os_authType']);
  const authenticated=await readServiceSchemaUpstream('bamboo'),first=Object.values(authenticated.paths)[0];first.summary='Preserved path metadata';
  bindAtlassianDcAuthentication(authenticated);assert.equal(first.summary,'Preserved path metadata');assert.equal(authenticated.components.securitySchemes.OAuth2.scheme,'bearer');
  const commerce=await readServiceSchemaUpstream('atlassian-commerce'),commercePath=Object.values(commerce.paths)[0];commercePath.description='Preserved Commerce path';
  bindCommerceAuthentication(commerce);assert.equal(commercePath.description,'Preserved Commerce path');assert.deepEqual(commerce.security,[{ASAP:[]}]);
  const bitbucket=await readServiceSchemaUpstream('bitbucket-dc'),hook=Object.values(uploadBodyContracts).find(contract=>contract.catalog==='bitbucket-dc'&&contract.kind==='multipart');
  const upload=inheritParameters(bitbucket,hook);bindUploadBodies(bitbucket);
  assert.deepEqual(upload.item.parameters,upload.inherited);assert.equal(upload.operation['x-upstream-upload-parameters'],null);
  assert.deepEqual(upload.operation.parameters.map(field=>field.name),['X-Atlassian-Token']);
  const missingServer=await readServiceSchemaUpstream('bitbucket-dc');delete missingServer.servers;
  const before=JSON.stringify(missingServer);assert.throws(()=>bindUploadBodies(missingServer),/reviewed native declaration/);assert.equal(JSON.stringify(missingServer),before);
});

Then('schema corrections retain unrelated required fields and refuse incomplete roots or retired routes',async()=>{
  const anthropic=await readServiceSchemaUpstream('anthropic'),schemas=[];
  for(const [path,item] of Object.entries(anthropic.paths))if(['/v1/skills','/v1/skills/{skill_id}/versions','/v1/skills?beta=true','/v1/skills/{skill_id}/versions?beta=true'].includes(path)){
    const name=item.post.requestBody.content['multipart/form-data'].schema.$ref.split('/').at(-1),schema=anthropic.components.schemas[name];
    schema.properties.ownedRequired={type:'string'};schema.required.push('ownedRequired');schemas.push(schema);
  }
  assert.equal(schemas.length,4);bindMultipartFiles(anthropic);
  for(const schema of schemas){assert.ok(schema.required.includes('files[]'));assert.ok(schema.required.includes('ownedRequired'));assert.deepEqual(schema.properties.ownedRequired,{type:'string'});assert.ok(schema['x-upstream-form-schema'].required.includes('files'));}
  const cloudflare=await readServiceSchemaUpstream('cloudflare'),contract=Object.values(structuredForms.operations).find(item=>item.catalog==='cloudflare');
  delete cloudflare.components.schemas[contract.schemaReference.split('/').at(-1)].properties;
  const before=JSON.stringify(cloudflare);assert.throws(()=>bindStructuredForms(cloudflare),/root shape/);assert.equal(JSON.stringify(cloudflare),before);
  const github=await readServiceSchema('github');
  for(const [path,value] of [['/owned-invalid',null],[retiredGithubClassroom[0][0],{summary:'Retired path metadata'}]]){
    github.paths[path]=value;const original=JSON.stringify(github);
    assert.throws(()=>excludeRetiredGithubClassroom(github),/six reviewed routes/);assert.equal(JSON.stringify(github),original);delete github.paths[path];
  }
});

Then('upload media mappings reject unreviewed modes including inherited object names',async()=>{
  const source=await readServiceSchemaUpstream('bitbucket-dc'),contract=Object.values(uploadBodyContracts).find(contract=>contract.catalog==='bitbucket-dc'&&contract.kind==='multipart'),kind=contract.kind;
  try{
    for(const unreviewed of ['toString','constructor','__proto__','future-mode']){
      contract.kind=unreviewed;assert.throws(()=>bindUploadBodies(structuredClone(source)),/reviewed native declaration/);
    }
  }finally{contract.kind=kind;}
});

Then('nameless native upload headers retain a precise strict import diagnostic',async()=>{
  const source=await readServiceSchemaUpstream('bitbucket-dc'),contract=Object.values(uploadBodyContracts).find(contract=>contract.catalog==='bitbucket-dc'&&contract.kind==='multipart');
  const operation=source.paths[contract.path][contract.method.toLowerCase()],header={in:'header',schema:{type:'string'}};
  operation.parameters=[header,...(operation.parameters??[])];bindUploadBodies(source);
  assert.deepEqual(operation.parameters[0],header);assert.equal(operation.parameters.filter(field=>field.name==='X-Atlassian-Token').length,1);
  const scoped={...source,paths:{[contract.path]:{[contract.method.toLowerCase()]:operation}}};
  assert.throws(()=>extractOperations(scoped,'bitbucket-dc'),/header parameter "<unnamed>".*inputs require a name/);
});
