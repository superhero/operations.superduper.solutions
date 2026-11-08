// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Then } from '@cucumber/cucumber';
import ids from '../tests/aws-query-operations.json' with {type:'json'};
import { awsQueryContracts, awsQueryContract, awsQueryEndpoint, awsQueryHasPrivateOutput, awsQueryPrivateInputKeys,
  validAwsQueryModel, decodeAwsQueryBody, awsQueryTarget } from './lib/aws-query.ts';
import { readServiceSchema } from './lib/service-schema-packs.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { extractOperations } from './lib/catalog.ts';
import { prepareRequest } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
import { vaultVariablePlaceholder } from './lib/secrets/variables.ts';
import { awsSyntheticValues, verifyAwsSignature } from '../tests/aws-sigv4.fixture.mjs';
import { createOperationGraph } from './lib/workflow-graph.ts';
import { validateWorkflowDocument, parseWorkflowDocument } from './lib/workflow-document.ts';
import display from './lib/operation-display.json' with {type:'json'};

const documents=new Map(),models=new Map(),methods=new Set(['get','post','put','patch','delete','head','options','trace']);
const bad=error=>error?.code==='CODEC';
async function model(id) {
  if(!models.has(id)) {
    const cat=id.split(':')[0];if(!documents.has(cat))documents.set(cat,await readServiceSchema(cat));
    const op=inspectServiceSchema(documents.get(cat),cat,new Set([id])).operations.find(op=>op.id===id);
    assert.ok(op&&!op.unavailableReason,JSON.stringify({id,issues:op?.capabilities?.issues}));assert.ok(validAwsQueryModel(op),id);models.set(id,op);
  }
  return models.get(id);
}
const params=request=>request.method==='GET'?request.query:Object.fromEntries(new URLSearchParams(requestBody(request)));
function xml(id,body='',metadata=true) {
  const c=awsQueryContracts().operations[id],s=awsQueryContracts().sources[c.catalog],wrapper=c.outputTraits?.resultWrapper;
  return `<${c.operation}Response xmlns="${s.namespace}">${wrapper?`<${wrapper}>${body}</${wrapper}>`:body}${metadata?'<ResponseMetadata><RequestId>request-123</RequestId></ResponseMetadata>':''}</${c.operation}Response>`;
}
async function fixture(id) {
  const op=await model(id),c=awsQueryContract(op),source=awsQueryContracts().sources[c.catalog],endpoint=source.endpoints[0];
  const origin=endpoint.url.replace(/\{([^{}]+)\}/g,(_,name)=>endpoint.variables[name].default),descriptor=await approvedOperation(op,origin),records=[],credentials={};
  if(c.auth==='sigv4') {
    const ref={};for(const [part,value] of Object.entries(awsSyntheticValues)){ref[part]=crypto.randomUUID();records.push({id:ref[part],label:part,value,kind:'secret',grants:[]});}
    credentials[op.security[0][0].name]=ref;
  }
  return {op,c,source,origin,descriptor,records,binding:{alternative:0,fingerprint:descriptor.fingerprint,credentials}};
}
async function execute(f,input,body,options={}) {
  let calls=0,wireError;const captured=[];
  const result=await executeCredentialed(f.descriptor,input,f.binding,f.records,{assertCurrent(){},async adoptPrivateResults(values){captured.push(...values);return values.map(()=>({credentialId:crypto.randomUUID(),label:'Private AWS Query result'}));},...options,
    async fetchRequest(address,init){try{
      calls++;const url=new URL(address);assert.equal(url.hash,'');assert.equal(init.method,f.c.method);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
      if(f.c.auth==='sigv4'){const context=awsQueryEndpoint(f.origin,f.op);verifyAwsSignature(address,init,awsSyntheticValues,context.service,context.region);}
      else assert.equal(new Headers(init.headers).get('Authorization'),null);
      await options.inspect?.(address,init);
      return new Response(body,{status:f.c.status,headers:{'content-type':'text/xml; charset=utf-8'}});
    }catch(error){wireError=error;throw error;}}
  }).catch(error=>{throw wireError??new Error(f.op.id+' calls='+calls+': '+error.message,{cause:error});});
  assert.equal(calls,1);for(const value of Object.values(awsSyntheticValues))assert.ok(!JSON.stringify(result).includes(value));return {result,captured};
}
Then('all 2726 AWS query operations hydrate through both parsers with reviewed profiles',async()=>{
  const selected=new Set(ids),found=new Set();assert.equal(ids.length,2726);assert.equal(selected.size,2726);
  for(const cat of Object.keys(awsQueryContracts().sources)) {
    const doc=await readServiceSchema(cat),canonical=inspectServiceSchema(doc,cat,selected).operations,scoped=structuredClone(doc);
    scoped.paths=Object.fromEntries(Object.entries(doc.paths).flatMap(([path,item])=>{
      const kept=Object.fromEntries(Object.entries(item).filter(([method,op])=>!methods.has(method)||selected.has(cat+':'+op.operationId)));
      return Object.keys(kept).some(method=>methods.has(method))?[[path,kept]]:[];
    }));
    const strict=extractOperations(scoped,cat);assert.deepEqual(new Set(strict.map(op=>op.id)),new Set(canonical.map(op=>op.id)));
    for(const op of [...canonical,...strict]){assert.ok(!op.unavailableReason,JSON.stringify({id:op.id,issues:op.capabilities?.issues}));assert.ok(validAwsQueryModel(op),op.id);assert.equal(op.path,awsQueryContracts().operations[op.id].path);found.add(op.id);}
  }
  assert.deepEqual(found,selected);
});
Then('AWS Query encodes nested parameters without replacing Action or Version',async()=>{
  const sns=await model('aws-sns:POST_Publish'),request=prepareRequest(sns,{'body:Message':'hello λ & +','body:TopicArn':'arn:aws:sns:us-east-1:123456789012:fixture','body:MessageAttributes':'{"kind":{"DataType":"String","StringValue":"a & b"}}'}),p=params(request);
  assert.equal(p.Action,'Publish');assert.equal(p.Version,'2010-03-31');assert.equal(p.Message,'hello λ & +');
  assert.equal(p['MessageAttributes.entry.1.Name'],'kind');assert.equal(p['MessageAttributes.entry.1.Value.StringValue'],'a & b');
  const scaling=await model('aws-autoscaling:GET_SetDesiredCapacity'),values=params(prepareRequest(scaling,{'body:AutoScalingGroupName':'fixture','body:DesiredCapacity':'0','body:HonorCooldown':'false'}));
  assert.equal(values.DesiredCapacity,'0');assert.equal(values.HonorCooldown,'false');
  const cloud=await model('aws-cloudformation:POST_DescribeStackEvents');assert.equal(params(prepareRequest(cloud,{'body:StackName':'stack'})).StackName,'stack');
  assert.throws(()=>prepareRequest(sns,{'body:Message':'hello','body:Action':'Other'}));
});
Then('EC2 Query preserves documented filter names list indexes and empty collections',async()=>{
  const op=await model('aws-ec2:POST_DescribeInstances'),p=params(prepareRequest(op,{'body:Filters':'[{"Name":"tag:Name","Values":["a & b","c"]}]','body:InstanceIds':'["i-1234567890abcdef0"]','body:DryRun':'false'}));
  assert.equal(p['Filter.1.Name'],'tag:Name');assert.equal(p['Filter.1.Value.1'],'a & b');assert.equal(p['Filter.1.Value.2'],'c');assert.equal(p['InstanceId.1'],'i-1234567890abcdef0');assert.equal(p.DryRun,'false');
  const empty=params(prepareRequest(op,{'body:InstanceIds':'[]'}));assert.ok(!Object.keys(empty).some(key=>key.startsWith('InstanceId')));
  const auto=await model('aws-autoscaling:POST_DescribeAutoScalingGroups'),list=params(prepareRequest(auto,{'body:AutoScalingGroupNames':'["one","two"]'}));assert.equal(list['AutoScalingGroupNames.member.1'],'one');assert.equal(list['AutoScalingGroupNames.member.2'],'two');
});
Then('AWS query XML decodes results errors and metadata while rejecting unsafe documents',async()=>{
  const iam=await model('aws-iam:GET_ListUsers'),namespace=awsQueryContracts().sources['aws-iam'].namespace;
  const body=`<ListUsersResponse xmlns="${namespace}"><ListUsersResult><Users><member><UserName>fixture</UserName><UserId>id-123</UserId><Arn>arn:aws:iam::123456789012:user/fixture</Arn><Path>/</Path><CreateDate>2025-01-02T03:04:05Z</CreateDate></member></Users><IsTruncated>false</IsTruncated></ListUsersResult><ResponseMetadata><RequestId>req-1</RequestId></ResponseMetadata></ListUsersResponse>`;
  const headers=new Headers({'content-type':'text/xml'}),decode=(text,status=200)=>decodeAwsQueryBody(iam,new TextEncoder().encode(text),headers,status),result=decode(body);
  assert.equal(result.Users[0].UserName,'fixture');assert.equal(result.Users[0].CreateDate,'2025-01-02T03:04:05.000Z');assert.equal(result.IsTruncated,false);assert.equal(result.ResponseMetadata.RequestId,'req-1');
  const error=decode(`<ErrorResponse xmlns="${namespace}"><Error><Type>Sender</Type><Code>AccessDenied</Code><Message>Denied</Message></Error><RequestId>req-2</RequestId></ErrorResponse>`,403);assert.equal(error.Error.Code,'AccessDenied');
  for(const input of [body.replace(namespace,'https://evil.test/'),body+'<extra/>','<!DOCTYPE x>'+body,body.replace('fixture','&unknown;'),body.replace('<IsTruncated>false','<IsTruncated>unknown')])assert.throws(()=>decode(input),bad);
  const ec2=await model('aws-ec2:GET_DescribeVpcs'),ns=awsQueryContracts().sources['aws-ec2'].namespace;
  const vpc=decodeAwsQueryBody(ec2,new TextEncoder().encode(`<DescribeVpcsResponse xmlns="${ns}"><requestId>req</requestId><vpcSet><item><vpcId>vpc-123</vpcId><isDefault>true</isDefault></item></vpcSet></DescribeVpcsResponse>`),headers,200);assert.equal(vpc.Vpcs[0].VpcId,'vpc-123');assert.equal(vpc.Vpcs[0].IsDefault,true);
});
Then('all twelve AWS query providers verify independent final request signatures',async()=>{
  const actions={'aws-autoscaling':'DescribeAutoScalingGroups','aws-cloudformation':'ListStacks','aws-ec2':'DescribeVpcs','aws-elasticache':'DescribeCacheClusters','aws-elasticloadbalancingv2':'DescribeLoadBalancers','aws-iam':'ListUsers','aws-monitoring':'ListMetrics','aws-rds':'DescribeDBInstances','aws-redshift':'DescribeClusters','aws-sns':'ListTopics','aws-sqs':'ListQueues','aws-sts':'GetAccessKeyInfo'};
  for(const [cat,action] of Object.entries(actions))for(const method of ['GET','POST']) {
    const f=await fixture(`${cat}:${method}_${action}`),input=cat==='aws-sts'?{'body:AccessKeyId':'AKIAIOSFODNN7EXAMPLE'}:{};
    const body=cat==='aws-sts'?'<Account>123456789012</Account>':'';
    await execute(f,input,xml(f.op.id,body),{inspect(address,init){const p=init.method==='GET'?new URL(address).searchParams:new URLSearchParams((typeof init.body==='string'?init.body:new TextDecoder().decode(init.body)));assert.equal(p.get('Action'),action);assert.equal(p.get('Version'),f.source.apiVersion);}});
  }
});
Then('SQS query variants preserve native queue paths and reject arbitrary queue destinations',async()=>{
  const post=await fixture('aws-sqs:POST_SendMessage'),origin='https://sqs.us-east-1.amazonaws.com',input={'body:QueueUrl':origin+'/123456789012/fixture','body:MessageBody':'hello λ'};
  const request=prepareRequest(post.op,input);assert.equal(request.path,'/123456789012/fixture');assert.equal(awsQueryTarget(post.op,origin,request).origin,origin);
  await execute(post,input,xml(post.op.id,'<MessageId>id-1</MessageId><MD5OfMessageBody>'+createHash('md5').update('hello λ').digest('hex')+'</MD5OfMessageBody>'),{inspect(address){assert.equal(new URL(address).pathname,'/123456789012/fixture');}});
  const get=await fixture('aws-sqs:GET_SendMessage'),legacy={'path:AccountNumber':'123456789012','path:QueueName':'fixture','body:MessageBody':'hello λ'};
  const routed=prepareRequest(get.op,legacy);assert.equal(routed.path,'/123456789012/fixture');assert.equal(routed.query.QueueUrl,undefined);
  await execute(get,legacy,xml(get.op.id,'<MessageId>id-2</MessageId>'));
  for(const address of ['https://evil.test/123456789012/fixture','https://sqs.eu-west-1.amazonaws.com/123456789012/fixture']) {
    const candidate=prepareRequest(post.op,{...input,'body:QueueUrl':address});assert.throws(()=>awsQueryTarget(post.op,origin,candidate),bad);
    await assert.rejects(()=>executeCredentialed(post.descriptor,{...input,'body:QueueUrl':address},post.binding,post.records,{assertCurrent(){},async fetchRequest(){assert.fail('Unapproved queue must not receive credentials');}}));
  }
});
Then('STS query exchanges use private assertions without requiring unrelated AWS credentials',async()=>{
  const f=await fixture('aws-sts:POST_AssumeRoleWithSAML'),assertion=Buffer.from('<Assertion>PRIVATE_QUERY_ASSERTION_12345</Assertion>').toString('base64'),credentialId=crypto.randomUUID();
  assert.equal(f.c.auth,'none');assert.deepEqual(f.op.security,[]);f.records.push({id:credentialId,label:'SAML assertion',value:assertion,kind:'secret',grants:[]});
  const input={'body:RoleArn':'arn:aws:iam::123456789012:role/fixture','body:PrincipalArn':'arn:aws:iam::123456789012:saml-provider/fixture','body:SAMLAssertion':vaultVariablePlaceholder};
  const credentials='<Credentials><AccessKeyId>ISSUED_QUERY_ACCESSKEY</AccessKeyId><SecretAccessKey>ISSUED_QUERY_SECRET</SecretAccessKey><SessionToken>ISSUED_QUERY_SESSION</SessionToken><Expiration>2027-01-01T00:00:00Z</Expiration></Credentials>';
  const {result,captured}=await execute(f,input,xml(f.op.id,credentials),{variables:[{key:'body:SAMLAssertion',path:[],credentialId}],inspect(address,init){assert.equal(new URLSearchParams((typeof init.body==='string'?init.body:new TextDecoder().decode(init.body))).get('SAMLAssertion'),assertion);}});
  assert.equal(captured.length,3);for(const value of [assertion,...captured.map(item=>item.value)])assert.ok(!JSON.stringify(result).includes(value));
  await assert.rejects(()=>executeCredentialed(f.descriptor,{...input,'body:SAMLAssertion':assertion},f.binding,f.records,{assertCurrent(){},async fetchRequest(){assert.fail('Public assertion must not dispatch');}}));
  const web=await fixture('aws-sts:GET_AssumeRoleWithWebIdentity'),token='PRIVATE_QUERY_WEB_IDENTITY_TOKEN_98623',webId=crypto.randomUUID();
  assert.equal(web.c.auth,'none');web.records.push({id:webId,label:'Identity token',value:token,kind:'secret',grants:[]});
  const exchanged=await execute(web,{'body:RoleArn':'arn:aws:iam::123456789012:role/fixture','body:RoleSessionName':'fixture','body:WebIdentityToken':vaultVariablePlaceholder},xml(web.op.id,credentials),{variables:[{key:'body:WebIdentityToken',path:[],credentialId:webId}],inspect(address){assert.equal(new URL(address).searchParams.get('WebIdentityToken'),token);}});
  assert.equal(exchanged.captured.length,3);assert.ok(!JSON.stringify(exchanged.result).includes(token));
});
Then('AWS query credentials nested secrets MFA data and private map values never become public results',async()=>{
  const fixtures=[
    ['aws-iam:POST_CreateAccessKey',{'body:UserName':'fixture'},'<AccessKey><UserName>fixture</UserName><AccessKeyId>ISSUED_QUERY_ACCESSKEY</AccessKeyId><SecretAccessKey>ISSUED_QUERY_SECRET</SecretAccessKey><Status>Active</Status><CreateDate>2025-01-01T00:00:00Z</CreateDate></AccessKey>',2],
    ['aws-iam:POST_CreateVirtualMFADevice',{'body:VirtualMFADeviceName':'fixture'},'<VirtualMFADevice><SerialNumber>arn:aws:iam::123456789012:mfa/fixture</SerialNumber><Base32StringSeed>c2VlZA==</Base32StringSeed><QRCodePNG>cG5n</QRCodePNG></VirtualMFADevice>',2],
    ['aws-rds:POST_DescribeDBInstances',{},'<DBInstances><DBInstance><DBInstanceIdentifier>fixture</DBInstanceIdentifier><PendingModifiedValues><MasterUserPassword>QUERY_RDS_PASSWORD</MasterUserPassword></PendingModifiedValues></DBInstance></DBInstances>',1],
    ['aws-sns:POST_GetPlatformApplicationAttributes',{'body:PlatformApplicationArn':'arn:aws:sns:us-east-1:123456789012:app/GCM/fixture'},'<Attributes><entry><key>PlatformCredential</key><value>QUERY_SNS_PRIVATE</value></entry><entry><key>Enabled</key><value>true</value></entry></Attributes>',1]
  ];
  for(const [id,input,body,count] of fixtures) {
    const f=await fixture(id);assert.ok(awsQueryHasPrivateOutput(f.op),id);
    const {result,captured}=await execute(f,input,xml(id,body));assert.equal(captured.length,count,id);
    for(const value of captured.map(item=>item.value))assert.ok(!JSON.stringify(result).includes(value),id);
  }
});
Then('AWS query revisions input schemas methods and signing metadata reject drift',async()=>{
  const op=await model('aws-ec2:GET_DescribeVpcs'),origin='https://ec2.us-east-1.amazonaws.com';
  assert.ok(awsQueryEndpoint(origin,op));for(const host of ['http://ec2.us-east-1.amazonaws.com',origin+'.evil.test',origin+'/prefix',origin+'?x=1'])assert.equal(awsQueryEndpoint(host,op),undefined);
  for(const changed of [{...op,awsQueryRevision:'stale'},{...op,path:op.path+'Other'},{...op,method:'PUT'},{...op,fields:[]},{...op,security:[]}]){assert.equal(validAwsQueryModel(changed),false);await assert.rejects(()=>approvedOperation(changed,origin));}
  assert.ok(awsQueryPrivateInputKeys(await model('aws-sts:GET_AssumeRoleWithSAML')).includes('body:SAMLAssertion'));
});
Then('the ten AWS query description synopses preserve their full canonical documentation',async()=>{
  const selected=ids.filter(id=>Object.hasOwn(display,id));assert.equal(selected.length,10);
  for(const id of selected) {
    const op=await model(id),document=await readServiceSchema(id.split(':')[0]),before=JSON.stringify(document);assert.ok(op.description.length>4000);
    const graph=createOperationGraph(op,{x:0,y:0},'fixture',document);assert.equal(graph.nodes[0].data.description,display[id].description);
    const saved=validateWorkflowDocument({version:2,id:crypto.randomUUID(),name:'AWS Query metadata',...graph,viewport:{x:0,y:0,zoom:1},snap:true,curved:true,dashed:false});
    assert.deepEqual(parseWorkflowDocument(JSON.stringify(saved)),saved);assert.equal(JSON.stringify(document),before);
  }
});
