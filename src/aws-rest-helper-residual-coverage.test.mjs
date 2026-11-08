// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {vi} from 'vitest';
import {awsRestContracts,awsRestSigningProfile} from './lib/aws-rest.ts';
import {awsRestDataSha256} from './lib/aws-rest-data.ts';

Then('isolated REST helpers reject unreviewed models and retain SDK member name fallbacks',async()=>{
  const pack=structuredClone(awsRestContracts()),empty={type:'structure'};
  const apiId='aws-apigatewayv2:CreateApi',apiContract=pack.operations[apiId],apiSource=pack.sources[apiContract.catalog];
  apiSource.shapes.UnitEmpty=empty;apiContract.input='UnitEmpty';delete apiContract.inputTraits;
  delete apiSource.endpoint.variables.region.enum;
  const s3Id='aws-s3:CopyObject',s3Contract=pack.operations[s3Id],s3Source=pack.sources[s3Contract.catalog];
  s3Source.shapes.UnitPrivate={type:'structure',members:{SSECustomerKey:{type:'string',location:'header'}}};
  s3Contract.input='UnitPrivate';delete s3Contract.inputTraits;
  const controlSource=pack.sources['aws-s3control'];controlSource.shapes.UnitEmpty=empty;
  controlSource.shapes.UnitUri={type:'structure',members:{Name:{type:'string',location:'uri'}}};
  const controlIds=['aws-s3control:GetAccessPoint','aws-s3control:GetBucketPolicy'];
  controlIds.forEach((id,i)=>{const c=pack.operations[id];c.input=i?'UnitUri':'UnitEmpty';delete c.inputTraits;delete c.wirePath;});
  const model=id=>{const c=pack.operations[id];return {id,name:id,description:'',group:'AWS',method:c.method,path:c.path,
    bodyRequired:false,fields:[],awsRest:awsRestSigningProfile,
    security:[[{name:'hmac',kind:'aws-sigv4',header:'Authorization',profile:awsRestSigningProfile}]]};};
  try{
    vi.doMock('./lib/aws-rest-data.ts',()=>({decodeAwsRestData:()=>pack,awsRestDataSha256}));
    const api=await import('./lib/aws-rest.ts?aws-rest-helper-residual'),operation=model(apiId);api.configureAwsRest(operation);
    assert.deepEqual(api.awsRestPrivateInputKeys(operation),[]);
    assert.deepEqual(api.awsRestPrivateInputKeys(model(s3Id)),['header:SSECustomerKey']);
    const unknown={...operation,id:'unknown:operation',path:'/'};
    assert.deepEqual(api.awsRestPrivateInputKeys(unknown),[]);assert.equal(api.awsRestTransportAccept(unknown),undefined);
    assert.equal(api.awsRestEndpoint('https://apigateway.us-east-1.amazonaws.com',operation),undefined);
    assert.equal(api.validAwsRestModel({...operation,fields:[{name:'x-unreviewed',key:'header:x-unreviewed',location:'header',type:'string',required:false}]}),false);
    vi.doMock('./lib/aws-rest.ts',()=>api);
    const target=await import('./lib/aws-rest-target.ts?aws-rest-helper-residual');
    for(const id of controlIds){
      const operation=model(id),path=operation.path.replace(/\{[^{}]+\}/g,'owned');
      assert.equal(target.prepareAwsRestOutpost(operation,{method:operation.method,path,query:{},headers:{'x-amz-account-id':'123456789012'}}).path,path);
    }
  }finally{vi.doUnmock('./lib/aws-rest-data.ts');vi.doUnmock('./lib/aws-rest.ts');}
});
