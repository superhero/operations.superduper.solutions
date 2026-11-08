// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {Then} from '@cucumber/cucumber';
import {vi} from 'vitest';
import {awsRestChecksums} from './lib/aws-rest-checksum.ts';
import {awsRestContracts,awsRestShape,awsRestTransportAccept,validAwsRestModel,awsRestSigningProfile} from './lib/aws-rest.ts';
import {awsRestDataSha256} from './lib/aws-rest-data.ts';
import {awsJsonContracts,awsJsonShape,awsJsonInputSchema,awsJsonPattern,awsJsonPrivateInputKeys,awsJsonPrivateMapKeys,awsJsonEndpoint,awsJsonSigningProfile} from './lib/aws-json.ts';
import {awsJsonDataSha256} from './lib/aws-json-data.ts';
import {awsQueryContracts,awsQueryShape,awsQueryPrivateMember,awsQueryPrivateMapKeys,awsQueryPrivateInputKeys,awsQueryEndpoint,awsQuerySigningProfile} from './lib/aws-query.ts';
import {awsQueryDataSha256} from './lib/aws-query-data.ts';
import {readServiceSchema} from './lib/service-schema-packs.ts';
import {extractOperations} from './lib/catalog.ts';
import {validateSchemaDocument,operationServerUrl} from './lib/schema-documents.ts';
import {approvedOperation} from './lib/secrets/policy.ts';
import {encodeSchemaPack,compactSchemaPackPrefix} from './lib/schema-pack-codec.ts';

const codec=error=>error?.code==='CODEC',denied=error=>error?.code==='PERMISSION';
const unknown={id:'unknown:operation',method:'GET',path:'/'};
const restModel=id=>{
  const contract=awsRestContracts().operations[id];assert.ok(contract,id);
  return {id,name:id,description:'',group:'AWS',method:contract.method,path:contract.path,bodyRequired:false,
    awsRest:awsRestSigningProfile,awsRestRevision:awsRestDataSha256,
    fields:[...contract.path.matchAll(/\{([^{}]+)\}/g)].map(([,name])=>({key:'path:'+name,name,label:name,description:'',type:'string',location:'path',required:true})),
    security:[[{name:'hmac',kind:'aws-sigv4',header:'Authorization',profile:awsRestSigningProfile}]]};
};

Then('AWS checksum containers retain exact bytes and reject unsupported bodies and customer keys',async()=>{
  const operation=restModel('aws-s3:DeleteObjects'),bytes=new TextEncoder().encode('owned checksum bytes'),expected=createHash('md5').update(bytes).digest('base64');
  for(const body of ['owned checksum bytes',bytes,bytes.buffer,new Blob([bytes])]){
    const headers=new Headers();await awsRestChecksums(operation,headers,body);assert.equal(headers.get('content-md5'),expected);
  }
  const empty=new Headers();await awsRestChecksums(operation,empty,null);assert.equal(empty.get('content-md5'),createHash('md5').digest('base64'));
  for(const body of [new FormData(),new URLSearchParams(),new Blob([new Uint8Array(8*1024*1024+1)])])
    await assert.rejects(awsRestChecksums(operation,new Headers(),body),codec);
  await assert.rejects(awsRestChecksums(operation,new Headers(),new Uint8Array(8*1024*1024+1)),error=>error.code==='LIMIT');
  await assert.rejects(awsRestChecksums(operation,new Headers({'x-amz-server-side-encryption-customer-key':'not canonical base64!'}),bytes),codec);
});

Then('strict AWS Query and JSON catalogs reject changed markers metadata and approval destinations',async()=>{
  for(const [kind,contracts,profile]of [['query',awsQueryContracts(),awsQuerySigningProfile],['json',awsJsonContracts(),awsJsonSigningProfile]]){
    const catalog=Object.keys(contracts.sources)[0],entry=Object.entries(contracts.operations).find(([,c])=>c.catalog===catalog&&c.auth!=='none');assert.ok(entry,kind);
    const [id,contract]=entry,document=structuredClone(await readServiceSchema(catalog));
    const path=kind==='json'?'/#X-Amz-Target='+contract.target:contract.path,method=kind==='json'?'post':contract.method.toLowerCase();
    const operation=structuredClone(document.paths[path][method]);delete operation.tags;
    document.paths={[path]:{[method]:operation}};
    const before=JSON.stringify(document),models=extractOperations(document,catalog);assert.equal(models.length,1);assert.equal(models[0].id,id);
    const tagged=structuredClone(document);tagged.paths[path][method].tags=['Reviewed group'];assert.equal(extractOperations(tagged,catalog)[0].group,'Reviewed group');
    validateSchemaDocument(document,catalog);assert.equal(JSON.stringify(document),before);
    for(const mutate of [d=>d.info.title+=' unreviewed',d=>d.info.version+='-unreviewed',d=>d.openapi=d.openapi==='3.0.0'?'3.1.0':'3.0.0',d=>d.paths[path][method].operationId='unreviewed-action']){
      const changed=structuredClone(document);mutate(changed);assert.throws(()=>validateSchemaDocument(changed,catalog));
    }
    const changed=structuredClone(document);changed.paths[path][method]['x-operations-aws-'+kind]=profile+'-unreviewed';assert.throws(()=>extractOperations(changed,catalog));
    const unsigned=structuredClone(document);delete unsigned.security;delete unsigned.paths[path][method].security;
    assert.throws(()=>extractOperations(unsigned,catalog),/reviewed signing/);
    const origin=operationServerUrl(document,models[0]);
    await assert.rejects(approvedOperation({...models[0],[kind==='json'?'awsJsonRevision':'awsQueryRevision']:'unreviewed'},origin),denied);
    await assert.rejects(approvedOperation(models[0],'https://unreviewed.example.test'),denied);
  }
});

Then('AWS public model helpers retain finite schemas and reject unreviewed shapes and descriptors',()=>{
  const source={shapes:{}};
  assert.throws(()=>awsRestShape(source,{shape:'missing'}),/shape is missing/);
  assert.throws(()=>awsJsonShape(source,{shape:'missing'}),codec);assert.throws(()=>awsQueryShape(source,{shape:'missing'}),codec);
  const inline={type:'string'};assert.equal(awsQueryShape(source,inline),inline);
  assert.equal(awsRestTransportAccept(unknown),undefined);assert.equal(validAwsRestModel({...unknown,awsRest:'unreviewed',fields:[]}),false);
  const upload=restModel('aws-s3:UploadPart');assert.equal(validAwsRestModel({...upload,fields:[]}),false);
  assert.equal(awsJsonEndpoint('https://unreviewed.example.test',unknown),undefined);assert.equal(awsQueryEndpoint('https://unreviewed.example.test',unknown),undefined);
  assert.deepEqual(awsJsonPrivateInputKeys(unknown),[]);assert.deepEqual(awsQueryPrivateInputKeys(unknown),[]);
  assert.equal(awsQueryPrivateMember('unknown',undefined,'Value'),false);
  assert.deepEqual(awsJsonPrivateMapKeys('unknown','missing'),[]);assert.deepEqual(awsQueryPrivateMapKeys('unknown','missing'),[]);
  assert.deepEqual(awsJsonInputSchema(source,{type:'structure'}),{type:'object',properties:{},additionalProperties:false});
  assert.deepEqual(awsJsonInputSchema(source,{type:'float'}),{type:'number'});
  for(const shape of [{type:'list'},{type:'map',key:inline},{type:'map',value:inline},{type:'unsupported'},{}])assert.throws(()=>awsJsonInputSchema(source,shape),codec);
  assert.throws(()=>awsJsonPattern('['),codec);
});

Then('AWS contract decoders reject truncated bytes and mismatched pinned inventories',async()=>{
  const families=[
    {path:'./lib/aws-json-data.ts',name:'decodeAwsJsonData',sha:'awsJsonDataSha256',hash:awsJsonDataSha256,pack:awsJsonContracts(),load:()=>import('./lib/aws-json.ts?aws-guard-revision'),contracts:'awsJsonContracts',data:()=>import('./lib/aws-json-data.ts?aws-guard-length')},
    {path:'./lib/aws-query-data.ts',name:'decodeAwsQueryData',sha:'awsQueryDataSha256',hash:awsQueryDataSha256,pack:awsQueryContracts(),load:()=>import('./lib/aws-query.ts?aws-guard-revision'),contracts:'awsQueryContracts',data:()=>import('./lib/aws-query-data.ts?aws-guard-length')},
    {path:'./lib/aws-rest-data.ts',name:'decodeAwsRestData',sha:'awsRestDataSha256',hash:awsRestDataSha256,pack:awsRestContracts(),load:()=>import('./lib/aws-rest.ts?aws-guard-revision'),contracts:'awsRestContracts',data:()=>import('./lib/aws-rest-data.ts?aws-guard-length')},
  ];
  try{
    vi.doMock('fflate',async original=>({...await original(),gunzipSync:()=>Uint8Array.of(1)}));
    for(const family of families){const module=await family.data();assert.throws(()=>module[family.name](),/incomplete/);}
    const automation=await import('./lib/github-automation-data.ts?aws-guard-length');assert.throws(()=>automation.decodeGithubAutomationData(),/incomplete/i);
    const base64=vi.spyOn(globalThis,'atob');
    try{
      for(const compressed of ['\0'.repeat(5),'\0'.repeat(18)]){
        base64.mockReturnValueOnce(compressed);assert.throws(()=>automation.decodeGithubAutomationData(),/Invalid GitHub automation contract length/);
      }
    }finally{base64.mockRestore();}
    const worker=await import('./lib/inline-worker-codec.ts?aws-guard-length'),packed=encodeSchemaPack(gzipSync(Uint8Array.of(1,2,3))).slice(compactSchemaPackPrefix.length);
    assert.throws(()=>worker.decodeInlineWorkerSource(packed,3),/incomplete inline worker/i);
  }finally{vi.doUnmock('fflate');}
  const normal=await import('./lib/github-automation-data.ts?aws-guard-valid');
  assert.deepEqual(normal.decodeGithubAutomationData(),normal.decodeGithubAutomationData());
  for(const family of families){
    let pack;
    try{
      vi.doMock(family.path,()=>({[family.name]:()=>pack,[family.sha]:family.hash}));
      const module=await family.load();
      for(const field of ['version','sources','operations']){
        pack=structuredClone(family.pack);pack[field]=field==='version'?0:{};
        assert.throws(()=>module[family.contracts]());
      }
    }finally{vi.doUnmock(family.path);}
  }
});
