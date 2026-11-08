// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {vi} from 'vitest';
import * as json from './lib/aws-json.ts';
import * as query from './lib/aws-query.ts';
import {vaultLimits} from './lib/secrets/types.ts';

const errorCode=expected=>error=>error?.code===expected;
async function privateBoundaries(kind){
  const isJson=kind==='json',api=isJson?json:query,key=isJson?'awsJson':'awsQuery';
  const pack=structuredClone(isJson?api.awsJsonContracts():api.awsQueryContracts());
  const id=isJson?'aws-codepipeline:GetJobDetails':'aws-iam:POST_CreateAccessKey',contract=pack.operations[id];assert.ok(contract,id);
  const source=pack.sources[contract.catalog],secretShape=isJson?'AWSSessionCredentials':'AccessKey',secretKey=isJson?'secretAccessKey':'SecretAccessKey';
  const wildcard=isJson?'ActionConfigurationMap':'UnitWildcardMap';
  Object.assign(source.shapes,{
    UnitText:{type:'string'},UnitBoolean:{type:'boolean'},UnitLong:{type:'long'},UnitFloat:{type:'float'},
    UnitTimestamp:{type:'timestamp'},UnitBlob:{type:'blob'},UnitEmpty:{type:'structure'},
    UnitList:{type:'list',member:{shape:'UnitText'},min:0,max:50001},
    UnitMap:{type:'map',value:{shape:'UnitText'},min:1,max:3},
    UnitAllowedKey:{type:'string',enum:['keep']},
    UnitNamedMap:{type:'map',key:{shape:'UnitAllowedKey'},value:{shape:'UnitText'}},
    UnitRecursive:{type:'structure',members:{child:{shape:'UnitRecursive'}}},
    UnitBrokenChild:{type:'structure',members:{Value:{type:'string'}}},
    UnitUnknown:{type:'unsupported'},UnitUntyped:{},UnitBrokenList:{type:'list'},UnitBrokenMap:{type:'map'},
    [secretShape]:{type:'structure',required:[secretKey],members:{[secretKey]:{shape:'UnitText'}}},
    [wildcard]:{type:'map',value:{shape:'UnitText'}},
    UnitOutput:{type:'structure',members:{Credential:{shape:secretShape},List:{shape:'UnitList'},Map:{shape:'UnitMap'},
      NamedMap:{shape:'UnitNamedMap'},Wildcard:{shape:wildcard},Flag:{shape:'UnitBoolean'},Count:{shape:'UnitLong'},
      Fraction:{shape:'UnitFloat'},Text:{shape:'UnitText'},Stamp:{shape:'UnitTimestamp'},Blob:{shape:'UnitBlob'},
      Empty:{shape:'UnitEmpty'},Recursive:{shape:'UnitRecursive'}}},
  });
  contract.output='UnitOutput';
  const facade={...api,[isJson?'awsJsonContracts':'awsQueryContracts']:()=>pack,
    [isJson?'awsJsonContract':'awsQueryContract']:operation=>{
      const candidate=pack.operations[operation.id];
      return candidate&&operation.method===(isJson?'POST':candidate.method)
        &&operation.path===(isJson?'/#X-Amz-Target='+candidate.target:candidate.path)?candidate:undefined;
    }};
  if(!isJson)facade.awsQueryPrivateMapKeys=(catalog,name)=>name===wildcard?['*']:api.awsQueryPrivateMapKeys(catalog,name);
  const modulePath=isJson?'./lib/aws-json.ts':'./lib/aws-query.ts';
  try{
    vi.doMock(modulePath,()=>facade);
    const schemas=isJson?await import('./lib/aws-json-private.ts?aws-private-guard-json'):await import('./lib/aws-query-private.ts?aws-private-guard-query');
    const results=isJson?await import('./lib/secrets/aws-json-results.ts?aws-private-guard-json'):await import('./lib/secrets/aws-query-results.ts?aws-private-guard-query');
    const profileFunction=schemas[isJson?'awsJsonPrivateProfile':'awsQueryPrivateProfile'];
    const operation={id,method:isJson?'POST':contract.method,path:isJson?'/#X-Amz-Target='+contract.target:contract.path,
      [key]:isJson?api.awsJsonSigningProfile:api.awsQuerySigningProfile};
    const profile=profileFunction(operation);assert.ok(profile);
    assert.equal(profileFunction({...operation,id:'unknown:operation'}),undefined);
    const project=schemas[isJson?'projectAwsJsonPrivateResponse':'projectAwsQueryResponse'],document={};
    project(document,contract.catalog,'UnitOutput');
    const prefix=isJson?'OperationsAwsJsonPrivate_':'OperationsAwsQuery_',components=document.components.schemas;
    assert.deepEqual(components[prefix+'UnitMap'],{type:'object',additionalProperties:{$ref:'#/components/schemas/'+prefix+'UnitText'},properties:{},minProperties:1,maxProperties:3});
    assert.ok(components[prefix+wildcard].additionalProperties.anyOf);
    assert.deepEqual(components[prefix+'UnitFloat'],{type:'number'});
    assert.deepEqual(components[prefix+'UnitEmpty'],{type:'object',additionalProperties:false,properties:{}});
    for(const name of ['UnitBrokenChild','UnitUnknown','UnitUntyped','UnitBrokenList','UnitBrokenMap'])assert.throws(()=>project({},contract.catalog,name),/SDK shape/);
    const prepare=(value,selectedProfile=profile,status=contract.status)=>results[isJson?'prepareAwsJsonCredentialResults':'prepareAwsQueryCredentialResults'](selectedProfile,status,value);
    const privateValue='owned private output fixture',input={Credential:{[secretKey]:privateValue},List:['visible'],Map:{public:'value'},
      NamedMap:{keep:'included',discard:'unreviewed'},Wildcard:{first:privateValue},Flag:false,Count:2,Fraction:1.25,Text:'public',Stamp:'2026-01-01T00:00:00.000Z',Blob:'YQ==',Empty:{}};
    const prepared=prepare(input);assert.equal(prepared.values.length,1);assert.equal(prepared.values[0].value,privateValue);
    const reference={credentialId:'11111111-2222-4333-8444-555555555555',label:'Owned output reference'},body=prepared.complete([reference]);
    assert.deepEqual(body.Credential[secretKey],reference);assert.deepEqual(body.Wildcard.first,reference);
    assert.deepEqual(body.NamedMap,{keep:'included'});assert.equal(body.Flag,false);assert.equal(body.Fraction,1.25);
    assert.ok(!JSON.stringify(body).includes(privateValue));assert.equal(input.Credential[secretKey],privateValue);
    for(const value of ['', '***','"***"']){
      const masked=prepare({Credential:{[secretKey]:value}});assert.equal(masked.values.length,0);
      assert.deepEqual(masked.complete([]),{Credential:{[secretKey]:null}});
    }
    for(const value of [42,'\ud800'])assert.throws(()=>prepare({Credential:{[secretKey]:value}}),errorCode('INVALID'));
    assert.throws(()=>prepare({Credential:{[secretKey]:'x'.repeat(vaultLimits.secretBytes+1)}}),errorCode('LIMIT'));
    for(const value of [null,[],{Credential:{}},{List:{}},{Map:[]},{Flag:'false'},{Count:Infinity},{Count:'2'},{Text:2}])
      assert.throws(()=>prepare(value),errorCode('INVALID'));
    for(const references of [[],[null],[{...reference,unexpected:true}],[{...reference,credentialId:'invalid'}],[{...reference,label:2}]])
      assert.throws(()=>prepare({Credential:{[secretKey]:privateValue}}).complete(references),errorCode('INVALID'));
    const missing={...profile};delete missing[key];
    for(const changed of [missing,{...profile,[key]:{...profile[key],revision:'stale'}},{...profile,catalog:'other'},
      {...profile,path:'/unreviewed'}])assert.throws(()=>prepare({},changed),errorCode('PERMISSION'));
    assert.throws(()=>prepare({},profile,contract.status===200?201:200),errorCode('PERMISSION'));
    assert.throws(()=>prepare({Wildcard:Object.fromEntries(Array.from({length:vaultLimits.records+1},(_,i)=>['value'+i,'owned-value-'+i]))}),errorCode('LIMIT'));
    assert.throws(()=>prepare({List:Array.from({length:50000},()=> 'visible')}),errorCode('LIMIT'));
    let recursive={};for(let i=0;i<50;i++)recursive={child:recursive};assert.throws(()=>prepare({Recursive:recursive}),errorCode('LIMIT'));
    for(const [shape,value]of [['UnitBrokenList',[]],['UnitBrokenMap',{}]]){
      contract.output=shape;assert.throws(()=>prepare(value),errorCode('INVALID'));
    }
    contract.output='UnitUntyped';assert.throws(()=>prepare(2),errorCode('INVALID'));
    contract.output=null;assert.throws(()=>prepare({}),errorCode('PERMISSION'));
  }finally{vi.doUnmock(modulePath);}
}

Then('isolated AWS JSON private outputs reject malformed models values and adopted references',{timeout:60000},async()=>privateBoundaries('json'));
Then('isolated AWS Query private outputs reject malformed models values and adopted references',{timeout:60000},async()=>privateBoundaries('query'));
