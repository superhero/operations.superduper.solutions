// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Then} from '@cucumber/cucumber';
import {decisionProfile} from './lib/assistant/decision-models.ts';
import {artifactsFor,profileById} from './lib/assistant/model-storage/catalog.ts';
import {Decider} from './public/assistant-runtime/decision/strands-fp32.mjs';
Then('compatible Strands preserves the original pointer head and complete converted file pins',async()=>{
  const profile=decisionProfile('strands-fp32'),files=artifactsFor(profileById('decision:strands-fp32'));
  const bytes=await readFile('build/strands-fp32/manifest.json'),manifest=JSON.parse(bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),profile.conversion_manifest_sha256);
  assert.equal(manifest.compatibility_conversion.integer_parameters_identical,true);
  assert.equal(manifest.source.repo,profile.browser_probe.original_model);assert.equal(manifest.source.revision,profile.browser_probe.original_revision);
  assert.ok(Object.values(manifest.state_inputs).every(value=>value.dtype!=='float16'));
  assert.equal(files.length,Object.keys(manifest.files).length+1);
  for(const [name,pin]of Object.entries(manifest.files)){
    const file=files.find(file=>file.id===name);assert.equal(file.bytes,pin.bytes);assert.equal(file.sha256,pin.sha256);
    assert.equal(file.url,profile.browser_probe.weights_url+name);
    if(file.parts){assert.equal(file.parts.reduce((sum,p)=>sum+p.bytes,0),file.bytes);assert.ok(file.parts.slice(0,-1).every(part=>part.bytes===16777216));}
  }
  assert.equal(files.find(file=>file.id==='model/head.safetensors').sha256,'ace56742545b505e6fae34ada85c8edbeedb23ba8974d8680aebe0380d6083a1');
  assert.equal(files.find(file=>file.id==='manifest.json').sha256,profile.conversion_manifest_sha256);
  assert.equal(decisionProfile('strands-cpu').browser_probe.device,'wasm');assert.equal(decisionProfile('strands-gpu').browser_probe.device,'webgpu');
});
function broker(){
  const sent=[],record={terminated:0},worker={postMessage(data){sent.push(data);},terminate(){record.terminated++;}};
  const engine=new Decider({profile:decisionProfile('strands-fp32'),createWorker(url){assert.match(url.href,/assistant-runtime\/strands-fp32-worker.js$/);return worker;}});
  const reply=(data,result,error)=>worker.onmessage({data:{id:data.id,type:error?'error':'result',...(error?{error:{message:error}}:{result})}});
  return{engine,sent,record,reply};
}
Then('Strands native RPC preserves results and awaits the actual disposal outcome',async()=>{
  const {engine,sent,record,reply}=broker();assert.equal(sent[0].modelId,'decision:strands-fp32');
  assert.match(sent[0].ortPaths.mjs,/asyncify.mjs$/);reply(sent[0],{source:{repo:'original'}});assert.deepEqual(await engine.ready,{source:{repo:'original'}});
  const native={answer:{type:'noul',noul:0.9},tokens:42,native_gpu:{compute_type:'float32'}},score=engine.decide('blue',{type:'noul',instructions:'Blue?'});
  assert.equal(sent[1].state,'blue');reply(sent[1],native);assert.equal(await score,native);
  const disposal=engine.dispose();assert.equal(engine.dispose(),disposal);assert.equal(record.terminated,0);assert.equal(sent[2].type,'dispose');
  await assert.rejects(engine.decide('late',{}),/unloading/);reply(sent[2],{});await disposal;assert.equal(record.terminated,1);
  const broken=broker();broken.reply(broken.sent[0],{});await broken.engine.ready;
  const failed=broken.engine.dispose();broken.reply(broken.sent[1],null,'native release failed');
  await assert.rejects(failed,/native release failed/);await assert.rejects(broken.engine.dispose(),/native release failed/);assert.equal(broken.record.terminated,0);
});
