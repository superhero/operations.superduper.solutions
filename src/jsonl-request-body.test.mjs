// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
import assert from 'node:assert/strict';
import { Then } from '@cucumber/cucumber';
import { extractOperations } from './lib/catalog.ts';
import { inspectServiceSchema } from './lib/service-catalog.ts';
import { prepareRequest, InputValidationError } from './lib/operation-input.ts';
import { requestBody } from './lib/request-body.ts';
import { isJsonLinesRequestMediaType } from './lib/request-media.ts';
import { readServiceSchema, readServiceSchemaUpstream } from './lib/service-schema-packs.ts';
import { operationServerUrl } from './lib/schema-documents.ts';
import { approvedOperation } from './lib/secrets/policy.ts';
import { executeCredentialed } from './lib/secrets/execution.ts';
const values=[{used_at:'2026-11-05T12:00:00Z',source:'https://example.test/λ?x=1&y=2',id:'usage-λ'},{used_at:'2026-11-05T13:00:00+01:00',source:'https://example.test/b',id:42}];
const text=values.map(value=>JSON.stringify(value)).join('\n')+'\n';
function fixture(media='application/jsonl',schema={type:'string'}) {
  return {openapi:'3.0.3',info:{title:'JSON Lines',version:'1'},servers:[{url:'https://example.test'}],paths:{'/usage':{post:{operationId:'usage',summary:'Usage',
    requestBody:{required:true,content:{[media]:{schema}}},responses:{200:{description:'Success'}}}}}};
}
const models=document=>[extractOperations(document,'jsonl')[0],inspectServiceSchema(document,'jsonl').operations[0]];
Then('both JSON Lines parsers preserve UTF-8 text and LF or CRLF framing',()=>{
  for(const media of ['application/jsonl','Application/JSONL']) for(const input of [text,text.replaceAll('\n','\r\n'),text.slice(0,-1),'[1,true,null]\n"a\\nb"'])
    for(const operation of models(fixture(media))) {
      assert.equal(operation.unavailableReason,undefined);assert.equal(isJsonLinesRequestMediaType(media),true);
      const request=prepareRequest(operation,{'body:$':input});assert.equal(request.bodyFormat,'text');assert.equal(request.contentType,media);
      assert.equal(requestBody(request),input);assert.deepEqual(new TextEncoder().encode(requestBody(request)),new TextEncoder().encode(input));
    }
});
Then('JSON Lines reject malformed records and unsupported body representations with field context',()=>{
  for(const operation of models(fixture())) {
    for(const input of ['{}\ninvalid','{}\n\n{}','{}\n\n','\ufeff{}','{} {}','['])
      assert.throws(()=>prepareRequest(operation,{'body:$':input}),error=>error instanceof InputValidationError && error.fieldKey==='body:$' && /line \d+/.test(error.message));
    assert.throws(()=>prepareRequest(operation,{'body:$':'\n'}),InputValidationError);
    assert.throws(()=>prepareRequest(operation,{}),InputValidationError);
  }
  for(const document of [fixture('application/x-ndjson'),fixture('application/jsonl; charset=utf-16'),fixture('application/jsonl\n'),fixture('application/jsonl',{type:'object',properties:{}})]) {
    assert.throws(()=>extractOperations(document,'jsonl'));assert.ok(inspectServiceSchema(document,'jsonl').operations[0].unavailableReason);
  }
  const encoded=fixture();encoded.paths['/usage'].post.requestBody.content['application/jsonl'].encoding={record:{contentType:'application/json'}};
  assert.throws(()=>extractOperations(encoded,'jsonl'),/encoding/);assert.ok(inspectServiceSchema(encoded,'jsonl').operations[0].unavailableReason);
});
Then('the native usage report preserves its source and sends unquoted JSON Lines privately',async()=>{
  const id='cloudflare:pay-per-use.submitUsageReport',document=await readServiceSchema('cloudflare'),native=await readServiceSchemaUpstream('cloudflare');
  const operation=inspectServiceSchema(document,'cloudflare',new Set([id])).operations[0];assert.equal(operation.unavailableReason,undefined);
  assert.equal(operation.bodyMediaType,'application/jsonl');assert.equal(operation.bodyValue,true);
  const source=document.paths[operation.path][operation.method.toLowerCase()];assert.equal(operation.id,'cloudflare:'+source.operationId);
  assert.deepEqual(source.requestBody,native.paths[operation.path][operation.method.toLowerCase()].requestBody);
  const origin=operationServerUrl(document,operation),descriptor=await approvedOperation(operation,origin),records=[],credentials={};
  for(const [index,scheme] of operation.security[0].entries()) {const id='jsonl-secret-'+index;credentials[scheme.name]=id;records.push({id,label:id,kind:'secret',value:scheme.name.includes('email')?'jsonl@example.test':'jsonl-private-key-9913',grants:[]});}
  const binding={alternative:0,fingerprint:descriptor.fingerprint,credentials};let calls=0;
  const inputs={'body:$':text};for(const field of operation.fields) if(field.location==='path')inputs[field.key]='fixture-id';
  const result=await executeCredentialed(descriptor,inputs,binding,records,{assertCurrent(){},async fetchRequest(address,init){calls++;
    assert.equal(new URL(address).origin,'https://api.cloudflare.com');assert.equal(new Headers(init.headers).get('Content-Type'),'application/jsonl');
    assert.equal(init.body,text);for(const scheme of operation.security[0])assert.ok(new Headers(init.headers).get(scheme.header));
    return Response.json({success:true,result:{echo:records.map(x=>x.value)}});}});
  assert.equal(calls,1);for(const record of records)assert.equal(JSON.stringify(result).includes(record.value),false);
  await assert.rejects(executeCredentialed(descriptor,{...inputs,'body:$':'{}\nbroken'},binding,records,{assertCurrent(){},async fetchRequest(){calls++;return Response.json({});}}),/line 2/);
  assert.equal(calls,1);
  const other=await approvedOperation({...operation,bodyMediaType:'text/plain'},origin);assert.notEqual(other.fingerprint,descriptor.fingerprint);
  await assert.rejects(executeCredentialed(other,inputs,binding,records,{assertCurrent(){}}),error=>error.code==='PERMISSION');
});
