// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {vi} from 'vitest';
import * as json from './lib/aws-json.ts';
import * as query from './lib/aws-query.ts';
import {awsQueryDataSha256} from './lib/aws-query-data.ts';

const bytes=value=>new TextEncoder().encode(value),codec=error=>error?.code==='CODEC';
const model=(id,c,kind)=>({id,name:id,description:'',group:'AWS',method:kind==='json'?'POST':c.method,
  path:kind==='json'?'/#X-Amz-Target='+c.target:c.path,fields:[],bodyRequired:false,
  [kind==='json'?'awsJson':'awsQuery']:kind==='json'?'aws-json-v1':'aws-query-v1',
  security:c.auth==='none'?[]:[[{name:'hmac',kind:'aws-sigv4',header:'Authorization',profile:kind==='json'?'aws-json-v1':'aws-query-v1'}]]});

Then('isolated JSON target helpers reject unknown contracts and retain empty shape boundaries',async()=>{
  const pack=structuredClone(json.awsJsonContracts()),source=pack.sources['aws-kms'];
  Object.assign(source.shapes,{UnitEmpty:{type:'structure'},UnitUntyped:{},UnitText:{type:'string'},
    UnitMap:{type:'map',key:{shape:'UnitText'},value:{shape:'UnitText'}}});
  const selected=Object.entries(pack.operations).filter(([,c])=>c.catalog==='aws-kms').slice(0,3);
  selected.forEach(([,c],i)=>{c.input=i===1?'UnitUntyped':'UnitEmpty';c.output=i===2?'UnitMap':'UnitEmpty';});
  try{
    vi.doMock('./lib/aws-json-data.ts',()=>({decodeAwsJsonData:()=>pack,awsJsonDataSha256:json.awsJsonDataSha256}));
    const api=await import('./lib/aws-json.ts?aws-protocol-residual-json'),empty=model(...selected[0],'json');
    api.configureAwsJson(empty);assert.deepEqual(api.awsJsonPrivateInputKeys(empty),[]);assert.equal(api.awsJsonHasPrivateOutput(empty),false);
    assert.deepEqual(api.awsJsonPrivateMapKeys('unknown',undefined),[]);
    for(const input of [undefined,null])assert.equal(new TextDecoder().decode(api.awsJsonWireRequest(empty,input).bytes),'{}');
    const untyped=model(...selected[1],'json');assert.throws(()=>api.awsJsonWireRequest(untyped,'value'),codec);
    const map=model(...selected[2],'json');assert.deepEqual(api.decodeAwsJsonBody(map,bytes('{"key":"value"}'),new Headers({'content-type':'application/json'}),200),{key:'value'});
    assert.throws(()=>api.decodeAwsJsonBody({id:'unknown:operation',method:'POST',path:'/'},new Uint8Array(),new Headers(),200),codec);
  }finally{vi.doUnmock('./lib/aws-json-data.ts');}
});

Then('isolated Query codecs reject reserved selectors unsupported scalars and malformed responses',{timeout:60000},async()=>{
  const pack=structuredClone(query.awsQueryContracts()),source=pack.sources['aws-iam'];
  Object.assign(source.shapes,{UnitEmpty:{type:'structure'},UnitText:{type:'string'},UnitUntyped:{sensitive:true},
    UnitList:{type:'list',member:{shape:'UnitText'}},UnitInput:{type:'structure',members:{Future:{shape:'UnitUntyped'},Action:{shape:'UnitText'}}}});
  const selected=Object.entries(pack.operations).filter(([,c])=>c.catalog==='aws-iam'&&c.auth!=='none').slice(0,4);
  selected.forEach(([,c],i)=>{c.input=i===1?'UnitInput':i===3?'UnitUntyped':'UnitEmpty';c.output=i===2?'UnitList':'UnitEmpty';delete c.inputTraits;delete c.outputTraits;});
  const queue=Object.entries(pack.operations).find(([,c])=>c.catalog==='aws-sqs'&&c.queuePath);assert.ok(queue);
  pack.sources['aws-sqs'].shapes.UnitEmpty={type:'structure'};queue[1].input='UnitEmpty';delete queue[1].inputTraits;
  try{
    vi.doMock('./lib/aws-query-data.ts',()=>({decodeAwsQueryData:()=>pack,awsQueryDataSha256}));
    // Fault-inject a projection that qualifies a future scalar as text. The
    // independent wire codec must still reject its unsupported SDK type.
    vi.doMock('./lib/aws-json.ts',()=>({...json,awsJsonInputSchema:(sdk,ref)=>json.awsJsonInputSchema({shapes:{...sdk.shapes,UnitUntyped:{type:'string'}}},ref)}));
    const api=await import('./lib/aws-query.ts?aws-protocol-residual-query');
    const models=selected.map(([id,c])=>model(id,c,'query'));models.slice(0,3).forEach(value=>api.configureAwsQuery(value));
    assert.deepEqual(api.awsQueryPrivateMapKeys('unknown',undefined),[]);
    assert.deepEqual(api.awsQueryPrivateInputKeys(models[3]),[]);assert.equal(api.awsQueryHasPrivateOutput(models[0]),false);
    assert.equal(api.awsQueryPrivateMember('aws-iam','UnitInput','Future'),false);assert.deepEqual(api.awsQueryPrivateInputKeys(models[1]),[]);
    const queueModel=model(...queue,'query');api.configureAwsQuery(queueModel);assert.deepEqual(api.awsQueryPrivateInputKeys(queueModel),[]);
    assert.throws(()=>api.configureAwsQuery({...models[0],rpc:{}}),codec);
    const prepare=(operation,body)=>api.prepareAwsQueryRequest(operation,{method:operation.method,path:operation.path,query:{},body});
    assert.throws(()=>prepare(models[0],{Unexpected:true}),codec);
    for(const body of [{Action:'spoofed'},{Future:2},{Future:'visible'},{Future:'\ud800'}])assert.throws(()=>prepare(models[1],body),codec);
    const response=bytes('<Response xmlns="'+source.namespace+'"/>'),headers=new Headers({'content-type':'text/xml'});
    assert.throws(()=>api.decodeAwsQueryBody({...models[0],awsQueryRevision:'stale'},response,headers,200),codec);
    assert.throws(()=>api.decodeAwsQueryBody(models[0],new Uint8Array(api.maxAwsQueryBytes+1),headers,200),error=>error.code==='LIMIT');
    for(const media of [new Headers(),new Headers({'content-type':'application/json'})])
      assert.throws(()=>api.decodeAwsQueryBody(models[0],response,media,200),error=>error.code==='MEDIA');
    assert.deepEqual(api.decodeAwsQueryBody(models[0],bytes('<ErrorResponse><Error><Code>Denied</Code></Error></ErrorResponse>'),headers,400),{Error:{Code:'Denied'}});
    assert.throws(()=>api.decodeAwsQueryBody(models[2],bytes('<Response xmlns="'+source.namespace+'"><member>one</member></Response>'),headers,200),codec);
  }finally{vi.doUnmock('./lib/aws-query-data.ts');vi.doUnmock('./lib/aws-json.ts');}
});
