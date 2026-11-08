// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {vi} from 'vitest';
import {awsJsonContracts,configureAwsJson} from './lib/aws-json.ts';
import {awsJsonDataSha256} from './lib/aws-json-data.ts';
import {awsQueryContracts} from './lib/aws-query.ts';
import {awsQueryDataSha256} from './lib/aws-query-data.ts';
import {prepareRequest} from './lib/operation-input.ts';
import {readServiceSchema} from './lib/service-schema-packs.ts';
import {inspectServiceSchema} from './lib/service-catalog.ts';

const bytes=value=>new TextEncoder().encode(value),codec=error=>error?.code==='CODEC',limit=error=>error?.code==='LIMIT';
const string={type:'string'},integer={type:'integer',min:0,max:10};
const model=(id,c,kind)=>({id,name:id,description:'',group:'AWS',method:kind==='json'?'POST':c.method,
  path:kind==='json'?'/#X-Amz-Target='+c.target:c.path,fields:[],bodyRequired:false,
  [kind==='json'?'awsJson':'awsQuery']:kind==='json'?'aws-json-v1':'aws-query-v1',
  security:c.auth==='none'?[]:[[{name:'hmac',kind:'aws-sigv4',header:'Authorization',profile:kind==='json'?'aws-json-v1':'aws-query-v1'}]]});
async function isolated(kind,edit,run){
  const original=kind==='json'?awsJsonContracts():awsQueryContracts(),pack=structuredClone(original),fixture=edit(pack);
  const dataPath=kind==='json'?'./lib/aws-json-data.ts':'./lib/aws-query-data.ts';
  try{
    vi.doMock(dataPath,()=>kind==='json'?{decodeAwsJsonData:()=>pack,awsJsonDataSha256}:{decodeAwsQueryData:()=>pack,awsQueryDataSha256});
    const api=kind==='json'?await import('./lib/aws-json.ts?aws-codec-guard-json'):await import('./lib/aws-query.ts?aws-codec-guard-query');
    await run(api,pack,fixture);
  }finally{vi.doUnmock(dataPath);}
}
function shapes(){
  return {
    UnitText:string,UnitInteger:integer,UnitRecursive:{type:'structure',members:{child:{shape:'UnitRecursive'}}},
    UnitInput:{type:'structure',members:{
      Alias:{...string,locationName:'wireAlias'},Flag:{type:'boolean'},Number:integer,Float:{type:'double'},
      Epoch:{type:'timestamp',timestampFormat:'unixTimestamp'},Iso:{type:'timestamp',timestampFormat:'iso8601'},Rfc:{type:'timestamp',timestampFormat:'rfc822'},
      Names:{type:'list',member:string},FlatNames:{type:'list',flattened:true,member:{...string,locationName:'entry'}},
      Pairs:{type:'map',key:{...string,locationName:'Name'},value:{...integer,locationName:'Value'}},
      FlatPairs:{type:'map',flattened:true,key:string,value:string},Blob:{type:'blob',min:1,max:4},
      Choice:{type:'string',enum:['ok']},Pattern:{type:'string',pattern:'^[a-z]+$'},
      Nested:{type:'structure',required:['name'],members:{name:string}},Empty:{type:'structure'},
      Recursive:{shape:'UnitRecursive'},Many:{type:'list',member:string},Huge:string,
    }},
    UnitOutput:{type:'structure',members:{Label:{...string,locationName:'wireLabel'},Count:{type:'long'},When:{type:'timestamp'}}},
    UnitSimple:{type:'structure',members:{name:string}},UnitScalar:{type:'string'},
  };
}
function select(pack,catalog){
  const entries=Object.entries(pack.operations).filter(([,c])=>c.catalog===catalog&&c.auth!=='none');assert.ok(entries.length>=4,catalog);
  return entries.slice(0,4).map(([id,c],i)=>{
    c.input=i===1?null:i===2?'UnitSimple':i===3?'UnitScalar':'UnitInput';
    c.output=i===1?null:'UnitOutput';delete c.inputTraits;delete c.outputTraits;
    return {id,contract:c};
  });
}

Then('isolated AWS JSON models retain exact typed values aliases and bounded protocol envelopes',{timeout:60000},async()=>{
  await isolated('json',pack=>{
    const catalog='aws-kms',source=pack.sources[catalog];assert.ok(source);
    Object.assign(source.shapes,shapes());const selected=select(pack,catalog);
    source.shapes.UnitInput.members.BrokenList={type:'list'};source.shapes.UnitInput.members.BrokenMap={type:'map',key:string};
    source.shapes.UnitInput.members.Unknown={type:'unsupported'};
    source.endpoints=[{url:'https://kms.{region}.{missing}',variables:{}},{url:'https://kms.{region}.{domain}',variables:{domain:{default:'amazonaws.com'}}}];
    return {source,selected};
  },async(api,_pack,{source,selected})=>{
    const operation=model(selected[0].id,selected[0].contract,'json'),wire=value=>JSON.parse(new TextDecoder().decode(api.awsJsonWireRequest(operation,value).bytes));
    const input={Alias:'value',Flag:false,Number:2,Float:1.25,Epoch:1,Iso:1,Rfc:1,Names:['one'],Pairs:{a:2},Blob:'YQ==',Choice:'ok',Pattern:'ok',Nested:{name:'nested'},Empty:{}};
    const value=wire(input);assert.equal(value.wireAlias,'value');assert.equal(value.Flag,false);assert.equal(value.Number,2);
    assert.equal(value.Epoch,1);assert.equal(value.Iso,'1970-01-01T00:00:01.000Z');assert.equal(value.Rfc,'Thu, 01 Jan 1970 00:00:01 GMT');
    assert.deepEqual(value.Pairs,{a:2});assert.equal(value.Blob,'YQ==');assert.deepEqual(input.Names,['one']);
    for(const invalid of [[],false,{Alias:'one',wireAlias:'two'},{Flag:'false'},{Number:1.5},{Number:11},{Float:Infinity},
      {Epoch:false},{Epoch:'not a date'},{Names:{}},{Pairs:[]},{Blob:'invalid!'},{Blob:'YR=='},{Blob:''},{Blob:'YWJjZGU='},
      {Choice:'other'},{Pattern:'UPPER'},{Nested:{}},{Unknown:'text'},{BrokenList:[]},{BrokenMap:{}},{Unexpected:true}])assert.throws(()=>wire(invalid),codec);
    assert.throws(()=>wire({Huge:'x'.repeat(api.maxAwsJsonBytes)}),limit);
    assert.equal(api.awsJsonEndpoint('https://kms.us-east-1.amazonaws.com',operation).region,'us-east-1');
    const empty=model(selected[1].id,selected[1].contract,'json');assert.deepEqual(JSON.parse(new TextDecoder().decode(api.awsJsonWireRequest(empty,undefined).bytes)),{});
    for(const input of [null,1,[],{unexpected:true}])assert.throws(()=>api.awsJsonWireRequest(empty,input),codec);
    assert.equal(api.decodeAwsJsonBody(empty,bytes('{}'),new Headers(),200),null);
    assert.throws(()=>api.decodeAwsJsonBody(empty,bytes('{"unexpected":true}'),new Headers(),200),codec);
    assert.throws(()=>api.decodeAwsJsonBody(operation,new Uint8Array(),new Headers(),200),codec);
    const output=api.decodeAwsJsonBody(operation,bytes('{"wireLabel":"label","Count":2,"When":0,"ignored":true}'),new Headers(),200);
    assert.deepEqual(output,{Label:'label',Count:2,When:'1970-01-01T00:00:00.000Z'});
    const good=model(selected[2].id,selected[2].contract,'json');api.configureAwsJson(good);assert.equal(api.validAwsJsonModel(good),true);
    assert.throws(()=>api.configureAwsJson({...good,credentialResult:true}));
    assert.throws(()=>api.configureAwsJson(model(selected[3].id,selected[3].contract,'json')),codec);
    assert.ok(Object.isFrozen(source.shapes.UnitInput));
  });
});

Then('AWS prepared requests reject stale model revisions and unused path fields before transport',async()=>{
  const id='aws-kms:ListKeys',contract=awsJsonContracts().operations[id];assert.ok(contract);
  const json=model(id,contract,'json');configureAwsJson(json);
  assert.throws(()=>prepareRequest({...json,awsJsonRevision:'unreviewed'},{}),error=>error.fieldKey==='body'&&/reviewed contract/.test(error.message));
  const objectId='aws-s3:GetObjectAcl',document=await readServiceSchema('aws-s3'),operation=inspectServiceSchema(document,'aws-s3',new Set([objectId])).operations.find(value=>value.id===objectId);assert.ok(operation);
  const extra={key:'path:Unused',name:'Unused',label:'Unused path declaration',description:'',type:'string',location:'path',required:true};
  const values={'path:Bucket':'example-bucket','path:Key':'object','path:Unused':'must not be sent'};
  assert.throws(()=>prepareRequest({...operation,fields:[...operation.fields,extra]},values));
});

Then('isolated AWS Query models retain scalar collection XML and queue authority boundaries',{timeout:60000},async()=>{
  await isolated('query',pack=>{
    const catalog='aws-iam',source=pack.sources[catalog];assert.ok(source);
    Object.assign(source.shapes,shapes());const selected=select(pack,catalog);selected[0].contract.outputTraits={resultWrapper:'UnitResult'};
    source.endpoints=[{url:'https://iam.{missing}'},{url:'https://iam.{domain}',variables:{domain:{default:'amazonaws.com'}}},{url:'https://iam.us-gov.amazonaws.com'}];
    return {source,selected};
  },async(api,pack,{source,selected})=>{
    const operation=model(selected[0].id,selected[0].contract,'query');api.configureAwsQuery(operation);
    const prepare=body=>api.prepareAwsQueryRequest(operation,{method:operation.method,path:operation.path,query:{},body});
    const fields=body=>{const result=prepare(body);return result.method==='GET'?result.query:Object.fromEntries(new URLSearchParams(result.body));};
    const input={Alias:'one',Flag:false,Number:2,Float:1.25,Epoch:1,Iso:1,Rfc:1,Names:['one'],FlatNames:['flat'],Pairs:{a:2},FlatPairs:{key:'value'},Blob:'YQ==',Choice:'ok',Pattern:'ok',Nested:{name:'nested'},Empty:{}};
    const value=fields(input);assert.equal(value.wireAlias,'one');assert.equal(value.Flag,'false');assert.equal(value.Number,'2');assert.equal(value.Float,'1.25');
    assert.equal(value.Epoch,'1');assert.equal(value.Iso,'1970-01-01T00:00:01.000Z');assert.equal(value.Rfc,'Thu, 01 Jan 1970 00:00:01 GMT');
    assert.equal(value['Names.member.1'],'one');assert.equal(value['entry.1'],'flat');assert.equal(value['Pairs.entry.1.Name'],'a');assert.equal(value['Pairs.entry.1.Value'],'2');
    assert.equal(value['FlatPairs.1.key'],'key');assert.equal(value['FlatPairs.1.value'],'value');assert.equal(value.Blob,'YQ==');
    for(const invalid of [false,[],{Unknown:true},{Flag:'false'},{Number:1.5},{Number:11},{Float:Infinity},{Epoch:false},{Epoch:'invalid'},
      {Names:{}},{Pairs:[]},{Blob:'bad!'},{Blob:'YR=='},{Blob:''},{Blob:'YWJjZGU='},{Choice:'other'},{Pattern:'UPPER'},{Nested:{}},{Nested:{name:null}}])
      assert.throws(()=>prepare(invalid),codec);
    assert.equal(fields({Names:[]}).Names,'');
    let recursive={};for(let i=0;i<50;i++)recursive={child:recursive};assert.throws(()=>prepare({Recursive:recursive}),limit);
    assert.throws(()=>prepare({Many:Array.from({length:50000},()=> 'x')}),limit);
    assert.throws(()=>prepare({Huge:'x'.repeat(api.maxAwsQueryBytes)}),limit);
    assert.throws(()=>api.prepareAwsQueryRequest({...operation,awsQueryRevision:'changed'},{method:operation.method,path:operation.path,query:{},body:{}}),codec);
    assert.throws(()=>api.prepareAwsQueryRequest(operation,{method:operation.method,path:'/wrong',query:{},body:{}}),codec);
    assert.deepEqual(api.awsQueryEndpoint('https://iam.amazonaws.com',operation),{service:'iam',region:'us-east-1'});
    assert.deepEqual(api.awsQueryEndpoint('https://iam.us-gov.amazonaws.com',operation),{service:'iam',region:'us-gov-west-1'});
    for(const path of ['/?query=one','/#fragment','https://other.example.test/'])assert.throws(()=>api.awsQueryTarget(operation,'https://iam.amazonaws.com',{method:operation.method,path,query:{}}),codec);
    const read=(xml,status=200)=>api.decodeAwsQueryBody(operation,bytes(xml),new Headers({'Content-Type':'text/xml'}),status);
    const response='<Response xmlns="'+source.namespace+'"><UnitResult><wireLabel>label</wireLabel><Count>2</Count></UnitResult><ResponseMetadata><RequestId>owned</RequestId></ResponseMetadata></Response>';
    assert.deepEqual(read(response),{Label:'label',Count:2,ResponseMetadata:{RequestId:'owned'}});
    assert.throws(()=>read('<Response xmlns="'+source.namespace+'"/>'),codec);
    assert.throws(()=>read('<Error xmlns="'+source.namespace+'"><Message>denied</Message></Error>'),codec);
    assert.throws(()=>read('<Error/>',400),codec);
    assert.deepEqual(read('<ErrorResponse><Errors><Error><Code>Denied</Code><Message>one</Message></Error><Error><Code>Other</Code></Error></Errors><requestId>request</requestId></ErrorResponse>',400),{Error:{Code:'Denied',Message:'one'},RequestId:'request'});
    assert.throws(()=>read('<ErrorResponse><Message>missing error object</Message></ErrorResponse>',400),codec);
    const noInput=model(selected[1].id,selected[1].contract,'query');api.configureAwsQuery(noInput);
    assert.deepEqual(api.decodeAwsQueryBody(noInput,bytes('<Response xmlns="'+source.namespace+'"/>'),new Headers({'Content-Type':'application/xml'}),200),{});
    assert.throws(()=>api.configureAwsQuery({...noInput,credentialResult:true}),codec);
    assert.equal(api.validAwsQueryModel({...noInput,credentialResult:true}),false);
    assert.throws(()=>api.configureAwsQuery(model(selected[3].id,selected[3].contract,'query')),codec);
    const sqsEntry=Object.entries(pack.operations).find(([,c])=>{
      if(c.catalog!=='aws-sqs'||c.queuePath||!c.input)return false;const root=pack.sources[c.catalog].shapes[c.input];
      return root?.members?.QueueUrl&&(root.required??[]).every(name=>name==='QueueUrl');
    });assert.ok(sqsEntry);const queue=model(sqsEntry[0],sqsEntry[1],'query');api.configureAwsQuery(queue);
    const queueRequest=url=>api.prepareAwsQueryRequest(queue,{method:queue.method,path:queue.path,query:{},body:{QueueUrl:url}});
    for(const url of ['not a URL','http://sqs.us-east-1.amazonaws.com/123456789012/queue','https://user@sqs.us-east-1.amazonaws.com/123456789012/queue',
      'https://sqs.us-east-1.amazonaws.com/queue','https://sqs.us-east-1.amazonaws.com/123456789012/queue?extra=one'])assert.throws(()=>queueRequest(url),codec);
    const routed=queueRequest('https://sqs.us-east-1.amazonaws.com/123456789012/queue');assert.equal(routed.path,'/123456789012/queue');
    assert.throws(()=>api.awsQueryTarget(queue,'https://sqs.us-west-2.amazonaws.com',routed),codec);
  });
});
