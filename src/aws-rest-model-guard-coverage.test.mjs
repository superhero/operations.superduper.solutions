// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {vi} from 'vitest';
import {crc32} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as rest from './lib/aws-rest.ts';
import {encodeWorkflowBinary} from './lib/workflow-binary.ts';

const codec=error=>error?.code==='CODEC',bytes=value=>new TextEncoder().encode(value);
async function isolated(protocol,run,requestedId){
  const id=requestedId??(protocol==='rest-json'?'aws-apigatewayv2:CreateApi':'aws-route53:CreateHealthCheck');
  const pack=structuredClone(rest.awsRestContracts()),contract=pack.operations[id],source=pack.sources[contract.catalog];
  const operation={id,name:id,description:'',group:'AWS',method:contract.method,path:contract.path,bodyRequired:false,awsRest:rest.awsRestSigningProfile,
    fields:[...contract.path.matchAll(/\{([^{}]+)\}/g)].map(([,name])=>({key:'path:'+name,name,label:name,description:'',type:'string',location:'path',required:true})),
    security:[[{name:'hmac',kind:'aws-sigv4',header:'Authorization',profile:rest.awsRestSigningProfile}]]};
  rest.configureAwsRest(operation);assert.equal(rest.validAwsRestModel(operation),true);
  Object.assign(source.shapes,{
    UnitText:{type:'string'},UnitLong:{type:'long'},UnitScoped:{type:'string',xmlNamespace:{uri:'urn:owned',prefix:'owned'}},
    UnitNames:{type:'list',member:{shape:'UnitText',locationName:'item'}},
    UnitPlainNames:{type:'list',member:{shape:'UnitText'}},
    UnitMap:{type:'map',key:{shape:'UnitText',locationName:'Name'},value:{shape:'UnitLong',locationName:'Value'}},
    UnitPlainMap:{type:'map',key:{shape:'UnitText'},value:{shape:'UnitText'}},
    UnitRecursive:{type:'structure',members:{child:{shape:'UnitRecursive'}}},
    UnitRoot:{type:'structure',locationName:'Typed',members:{
      Alias:{shape:'UnitText',locationName:'wireAlias'},Flag:{type:'boolean'},Count:{shape:'UnitLong'},Float:{type:'double'},
      Epoch:{type:'timestamp',timestampFormat:'unixTimestamp'},Iso:{type:'timestamp',timestampFormat:'iso8601'},Rfc:{type:'timestamp',timestampFormat:'rfc822'},
      Blob:{type:'blob'},Names:{shape:'UnitNames'},PlainNames:{shape:'UnitPlainNames'},Map:{shape:'UnitMap'},PlainMap:{shape:'UnitPlainMap'},
      Attribute:{shape:'UnitText',xmlAttribute:true,locationName:'attribute'},Scoped:{shape:'UnitScoped'},
      Empty:{type:'structure'},Recursive:{shape:'UnitRecursive'},Untyped:{},BrokenList:{type:'list'},
      BrokenMap:{type:'map'},MissingValue:{type:'map',key:{shape:'UnitText'}},
      QueryMap:{shape:'UnitPlainMap',location:'querystring',locationName:'parameters'},
    }},
    UnitWrapped:{type:'structure',payload:'Payload',members:{Payload:{shape:'UnitRoot',locationName:'Data'}}},
  });
  contract.input='UnitRoot';contract.output='UnitRoot';delete contract.inputTraits;delete contract.outputTraits;
  const facade={...rest,awsRestContracts:()=>pack,awsRestContract:value=>value.id===id&&value.method===contract.method&&value.path===contract.path?contract:rest.awsRestContract(value)};
  try{
    vi.doMock('./lib/aws-rest.ts',()=>facade);
    const api=requestedId?await import('./lib/aws-rest-codec.ts?aws-rest-model-events'):protocol==='rest-json'?await import('./lib/aws-rest-codec.ts?aws-rest-model-json'):await import('./lib/aws-rest-codec.ts?aws-rest-model-xml');
    const prepare=(body,query={})=>api.prepareAwsRestRequest(operation,{method:operation.method,path:operation.path,query,headers:{},body});
    await run({api,source,contract,operation,prepare});
  }finally{vi.doUnmock('./lib/aws-rest.ts');}
}

Then('isolated AWS REST JSON models preserve typed values and reject malformed containers',{timeout:60000},async()=>{
  await isolated('rest-json',async({api,source,contract,operation,prepare})=>{
    const input={Alias:'one',Flag:false,Count:2,Float:1.25,Epoch:1,Iso:1,Rfc:1,Blob:'YQ==',Names:['one'],Map:{a:2},Empty:{}};
    const result=prepare(input);assert.equal(result.body.wireAlias,'one');assert.equal(result.body.Flag,false);assert.deepEqual(result.body.Map,{a:2});
    assert.equal(result.body.Epoch,1);assert.equal(result.body.Iso,'1970-01-01T00:00:01.000Z');assert.equal(result.body.Rfc,'Thu, 01 Jan 1970 00:00:01 GMT');
    assert.equal(prepare({Alias:null}).body.wireAlias,null);
    for(const input of [[],{Alias:'one',wireAlias:'two'},{Flag:'false'},{Count:1.5},{Float:Infinity},{Epoch:false},{Names:{}},
      {BrokenList:[]},{BrokenMap:{}},{MissingValue:{}},{Untyped:2},{Unexpected:true},{Blob:'invalid!'}])assert.throws(()=>prepare(input),codec);
    assert.throws(()=>prepare({}, {parameters:'null'}),codec);
    let recursive={};for(let i=0;i<50;i++)recursive={child:recursive};assert.throws(()=>prepare({Recursive:recursive}),codec);
    assert.throws(()=>prepare({Names:Array.from({length:50000},()=> 'one')}),codec);
    const read=body=>api.decodeAwsRestResponse(operation,bytes(JSON.stringify(body)),new Headers({'content-type':'application/json'}),200);
    assert.deepEqual(read({wireAlias:'reply',Flag:false,Epoch:1,Empty:{}}),{Alias:'reply',Flag:false,Epoch:'1970-01-01T00:00:01.000Z',Empty:{}});
    contract.output='UnitWrapped';assert.deepEqual(read({wireAlias:'wrapped'}),{Payload:{Alias:'wrapped'}});
    contract.output='UnitText';assert.throws(()=>read('wrong root'),codec);
    source.shapes.UnitBinary={type:'structure',payload:'Data',members:{Data:{type:'blob'}}};contract.input='UnitBinary';
    const file=encodeWorkflowBinary('owned.bin',Uint8Array.of(1),'application/octet-stream');
    const binary=api.prepareAwsRestRequest(operation,{method:operation.method,path:operation.path,query:{},headers:{'x-owned':'kept'},body:file});
    assert.equal(binary.contentType,'application/octet-stream');assert.equal(binary.headers['x-owned'],'kept');
  });
});

Then('isolated AWS REST XML models preserve maps attributes namespaces and payload wrappers',{timeout:60000},async()=>{
  await isolated('rest-xml',async({api,source,contract,operation,prepare})=>{
    const result=prepare({Attribute:'a&b',Names:['one'],PlainNames:['two'],Map:{key:2},PlainMap:{plain:'value'},Scoped:'scope',Flag:false,Epoch:1,Iso:1,Rfc:1,Empty:{}});
    assert.equal(result.bodyFormat,'text');assert.equal(result.contentType,'application/xml');
    for(const expected of ['attribute="a&amp;b"','<Names><item>one</item></Names>','<PlainNames><member>two</member></PlainNames>',
      '<Map><entry><Name>key</Name><Value>2</Value></entry></Map>','<PlainMap><entry><key>plain</key><value>value</value></entry></PlainMap>',
      '<Scoped xmlns:owned="urn:owned">scope</Scoped>','<Flag>false</Flag>','<Epoch>1</Epoch>',
      '<Iso>1970-01-01T00:00:01.000Z</Iso>','<Rfc>Thu, 01 Jan 1970 00:00:01 GMT</Rfc>'])assert.ok(result.body.includes(expected),expected);
    for(const input of [[],{Names:{}},{BrokenList:[]},{Map:[]},{BrokenMap:{}},{MissingValue:{}},{Unexpected:true}])assert.throws(()=>prepare(input),codec);
    source.shapes.UnitRoot.locationName='bad name';assert.throws(()=>prepare({}),codec);source.shapes.UnitRoot.locationName='Typed';
    source.shapes.UnitScoped.xmlNamespace.prefix='bad prefix';assert.throws(()=>prepare({Scoped:'scope'}),codec);source.shapes.UnitScoped.xmlNamespace.prefix='owned';
    const media=new Headers({'content-type':'text/xml'}),namespace='https://route53.amazonaws.com/doc/2013-04-01/';
    contract.output='UnitWrapped';
    assert.deepEqual(api.decodeAwsRestResponse(operation,bytes('<Data xmlns="'+namespace+'"><wireAlias>wrapped</wireAlias></Data>'),media,200),{Payload:{Alias:'wrapped'}});
    assert.throws(()=>api.decodeAwsRestResponse(operation,bytes('<Data/>'),new Headers({'content-type':'application/json'}),200),error=>error.code==='MEDIA');
    assert.deepEqual(api.decodeAwsXmlShape(source,{},'text'),'text');
    assert.deepEqual(api.decodeAwsXmlShape(source,{type:'structure'},{}),{});
    assert.throws(()=>api.parseAwsXmlDocument(bytes('plain text'),namespace,true),codec);
    assert.deepEqual(api.parseAwsXmlDocument(bytes('<r:Typed xmlns:r="'+namespace+'" r:attribute="kept"/>'),namespace,true),['Typed',{'@attribute':'kept'}]);
    contract.output='UnitNames';
    assert.throws(()=>api.decodeAwsRestResponse(operation,bytes('<UnitNames xmlns="'+namespace+'"><item>one</item></UnitNames>'),media,200),codec);
    contract.input=null;assert.throws(()=>prepare({}),codec);
  });
});

function event(name,payload){
  const parts=Object.entries({':message-type':'event',':event-type':name}).map(([key,value])=>{
    const keyBytes=bytes(key),data=bytes(value),result=new Uint8Array(4+keyBytes.length+data.length);result[0]=keyBytes.length;
    result.set(keyBytes,1);result[1+keyBytes.length]=7;new DataView(result.buffer).setUint16(2+keyBytes.length,data.length);result.set(data,4+keyBytes.length);return result;
  });
  const headerLength=parts.reduce((sum,part)=>sum+part.length,0),data=bytes(payload),result=new Uint8Array(16+headerLength+data.length),view=new DataView(result.buffer);
  view.setUint32(0,result.length);view.setUint32(4,headerLength);view.setUint32(8,crc32(result.subarray(0,8)));
  let offset=12;for(const part of parts){result.set(part,offset);offset+=part.length;}result.set(data,offset);view.setUint32(result.length-4,crc32(result.subarray(0,-4)));return result;
}
Then('isolated AWS REST XML events preserve wrapped and direct values and reject exception frames',async()=>{
  await isolated('rest-xml',async({api,source,contract,operation})=>{
    source.shapes.UnitEmptyNoMembers={type:'structure'};contract.input='UnitEmptyNoMembers';delete contract.fixedQuery;
    const path=operation.path.replace(/\{([^{}]+)\}/g,(_,name)=>name==='Bucket'?'example-bucket':'object');
    assert.deepEqual(api.prepareAwsRestRequest(operation,{method:operation.method,path,query:{}}).query,{});
    contract.output='UnitEmptyNoMembers';assert.deepEqual(api.decodeAwsRestResponse(operation,new Uint8Array(),new Headers({'content-type':'application/xml'}),200),{});
    source.shapes.UnitChecksum={type:'structure',members:{ChecksumAlgorithm:{type:'string',location:'header'}}};
    contract.input='UnitChecksum';contract.checksum={algorithmMember:'ChecksumAlgorithm'};
    const checksums=await import('./lib/aws-rest-checksum.ts?aws-rest-model-events'),headers=new Headers({ChecksumAlgorithm:'SHA256'});
    await checksums.awsRestChecksums(operation,headers,'owned bytes');assert.equal(headers.get('x-amz-checksum-sha256'),createHash('sha256').update('owned bytes').digest('base64'));
    const bucketId='aws-s3:DeleteBucket',bucket=rest.awsRestContracts().operations[bucketId];
    assert.throws(()=>api.awsRestRequestTarget({id:bucketId,method:bucket.method,path:bucket.path,awsRest:rest.awsRestSigningProfile},
      'https://s3.us-east-1.amazonaws.com',{method:bucket.method,path:'example-bucket',query:{}}),codec);
    Object.assign(source.shapes,{
      UnitValue:{type:'structure',members:{Count:{type:'integer'}}},
      UnitWrappedEvent:{type:'structure',members:{Value:{shape:'UnitValue',eventpayload:true}}},
      UnitDirectEvent:{type:'structure',members:{Count:{type:'integer'}}},UnitException:{type:'structure',exception:true,members:{}},
      UnitEvents:{type:'structure',eventstream:true,members:{Wrapped:{shape:'UnitWrappedEvent'},Direct:{shape:'UnitDirectEvent'},End:{shape:'UnitEmptyNoMembers'},Rejected:{shape:'UnitException'}}},
      UnitEventOutput:{type:'structure',payload:'Events',members:{Events:{shape:'UnitEvents'}}},
    });contract.output='UnitEventOutput';
    const parts=[event('Wrapped','<Value><Count>1</Count></Value>'),event('Direct','<Value><Count>2</Count></Value>'),event('End','')];
    const all=new Uint8Array(parts.reduce((sum,part)=>sum+part.length,0));let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}
    const read=value=>api.decodeAwsRestResponse(operation,value,new Headers({'content-type':'application/vnd.amazon.eventstream'}),200);
    assert.deepEqual(read(all),{Events:[{Wrapped:{Value:{Count:1}}},{Direct:{Count:2}},{End:{}}]});
    assert.throws(()=>read(event('Rejected','')),codec);
  },'aws-s3:SelectObjectContent');
});
