// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Then} from '@cucumber/cucumber';
import {decisionModels,decisionProfile,validateDecisionResult} from './lib/assistant/decision-models.ts';
import {artifactsFor,profileById} from './lib/assistant/model-storage/catalog.ts';
import {loadDecisionEngine} from './public/assistant-runtime/decision/engine.mjs';
import {nativeGpuPlacement} from './public/assistant-runtime/decision/decision-placement.js';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const request={state:'blue',questions:{q:{type:'noul',instructions:'Is the card blue?'}}};
const compatible=()=>decisionModels.filter(profile=>profile.native_variant==='shared-fp32-gpu-v1');
Then('compatible decisions retain seven pinned native heads and verified metadata sources',()=>{
  assert.deepEqual(compatible().map(profile=>profile.id),['d3-lite-fp32','d3-nano-fp32','d3-mini-fp32','d3-flash-fp32','knowline-fp32','elephant-fp32','perplexity-fp32']);
  for(const profile of compatible()){
    const probe=profile.browser_probe,files=artifactsFor(profileById('decision:'+profile.id));
    assert.equal(probe.load_options.n_gpu_layers,99);assert.equal(probe.load_options.n_ctx,1024);
    assert.equal(probe.load_options.cache_type_k,'f32');assert.equal(probe.load_options.cache_type_v,'f32');
    assert.equal(probe.load_options.flash_attn,false);assert.equal(probe.require_native_fp32_gpu,true);
    assert.equal(new Set(files.map(file=>file.url)).size,files.length);
    assert.deepEqual(files.map(({url,bytes,sha256})=>({url,bytes,sha256})),profile.cache_files.map(({url,bytes,sha256})=>({url,bytes,sha256})));
    assert.equal(files.find(file=>file.url.endsWith('/'+probe.file)).bytes,probe.weight_bytes);
    if(probe.prompt_model)for(const name of ['tokenizer.json','tokenizer_config.json','chat_template.jinja'])
      assert.ok(files.some(file=>file.url===`https://huggingface.co/${probe.prompt_model}/resolve/${probe.prompt_revision}/${name}`));
  }
  assert.equal(decisionProfile('d3-lite-fp32').browser_probe.systemone_template_sha256,decisionProfile('d3-lite').browser_probe.systemone_template_sha256);
  assert.equal(decisionProfile('knowline-fp32').browser_probe.logprobs_output_limit,64);
  const knowline=decisionProfile('knowline-fp32');assert.equal(Math.min(knowline.settings.max_rendered_prompt_tokens,knowline.browser_probe.load_options.n_ctx-1),1023);
  assert.equal(decisionProfile('perplexity-fp32').browser_probe.marker_token_id,248062);
  assert.equal(decisionProfile('elephant-fp32').revision,'247371a14d51cb5af533fcaf93485048a4db3ac4');
});
function fixture({missing=false,wrongKernel=false,wrongUsage=false,exitFails=false,hold=false}={}){
  const profile=structuredClone(decisionProfile('d3-lite-fp32')),completion=deferred(),exit=deferred();
  const template='controlled native template';profile.browser_probe.systemone_template_sha256=createHash('sha256').update(template).digest('hex');
  const record={loads:[],forwards:0,inspections:0,exits:0,cleared:0,reads:0};
  class Source{constructor(url,bytes,options){Object.assign(this,{url,bytes,options});record.source=this;}clear(){record.cleared++;}}
  class Blob{constructor(source){this.source=source;}}
  class Wllama{
    constructor(paths,{logger}){record.paths=paths;this.logger=logger;}
    async loadModel(_blobs,options){record.loads.push(options);await record.source.options.fetch(record.source.url);if(!missing)for(const line of ['FP32_COMPAT device shader_f16=0','offloaded 9/9 layers to GPU','WebGPU model buffer size = 100.5 MiB'])this.logger.debug(line);for(let i=0;i<120;i++)this.logger.debug('native diagnostic');}
    getLoadedContextInfo(){return{n_layer:8,n_vocab:1000,n_ctx:1024};}
    getModelMetadata(){return{meta:{'qwen35.decision.type':'vllm-d3','qwen35.attention.causal':'false','tokenizer.chat_template.systemone':template}};}
    async inspectSystemOne(value){record.inspections++;const count=value.state==='overflow'?1025:42;return{diagnostics:{decode_calls:0,tasks_posted:0,no_forward:true,format:'native-systemone',text_only:true,n_ctx:1024,n_batch:1024,n_ubatch:1024},tasks:[{question_id:'q',variant:0,tokens:Array(count).fill(1),input_tokens:count}]};}
    async createSystemOne(){record.forwards++;if(hold)await completion.promise;this.logger.debug('FP32_COMPAT pipeline mul_mat '+(wrongKernel?'q8_0':'bf16'));return{answers:{q:{type:'noul',noul:0.85}},usage:{input_tokens:wrongUsage?41:42},native_fixture:true};}
    async exit(){record.exits++;if(hold)await exit.promise;if(exitFails)throw Error('native decision disposal failed');}
  }
  return{profile,record,completion,exit,options:{Wllama,ranges:{RangeSource:Source,RangeBlob:Blob},fetch:async()=>{record.reads++;return new Response('cached');}}};
}
Then('compatible D3 uses exact native inspection and packed GPU evidence without truncation',async()=>{
  const value=fixture(),engine=await loadDecisionEngine(value.profile,()=>{},value.options);
  assert.match(value.record.paths.default,/wllama-fp32\/wllama.wasm$/);assert.equal(value.record.reads,1);
  assert.equal(value.record.forwards,0);assert.equal(value.record.inspections,0);
  await assert.rejects(engine.decide({...request,state:'overflow'}),/no truncation/);assert.equal(value.record.forwards,0);assert.equal(value.record.exits,0);
  const result=await engine.decide(request);validateDecisionResult(request,result);
  assert.equal(result.raw.native_fixture,true);assert.equal(result.prepared.rendered_tokens,42);assert.equal(result.execution.native_forward_completed,true);
  assert.equal(result.execution.compute_verified,true);assert.equal(result.execution.cpu_input_embedding_and_small_readout_allowed,true);
  assert.equal(value.record.forwards,1);await engine.dispose();assert.equal(value.record.exits,1);assert.equal(value.record.cleared,1);
  const missing=fixture({missing:true});await assert.rejects(loadDecisionEngine(missing.profile,()=>{},missing.options),/placement was not verified/);assert.equal(missing.record.forwards,0);assert.equal(missing.record.exits,1);
  const wrong=fixture({wrongKernel:true}),bad=await loadDecisionEngine(wrong.profile,()=>{},wrong.options);
  await assert.rejects(bad.decide(request),error=>error.native_forward_completed===true&&/packed-weight/.test(error.message));assert.equal(wrong.record.exits,1);
  const mismatch=fixture({wrongUsage:true}),mismatched=await loadDecisionEngine(mismatch.profile,()=>{},mismatch.options);
  await assert.rejects(mismatched.decide(request),error=>error.native_forward_completed===true&&/token count/.test(error.message));
  const changed=fixture();changed.profile.browser_probe.load_options.n_gpu_layers=0;
  await assert.rejects(loadDecisionEngine(changed.profile,()=>{},changed.options),/pinned FP32/);assert.equal(changed.record.loads.length,0);
  const gpu=nativeGpuPlacement('bf16');for(const line of ['FP32_COMPAT device shader_f16=1','FP32_COMPAT device shader_f16=0','offloaded 9/9 layers to GPU','WebGPU model buffer size = 100 MiB','FP32_COMPAT pipeline mul_mat bf16'])gpu.observe(line);
  for(let i=0;i<200;i++)gpu.observe('native diagnostic');assert.throws(()=>gpu.verify(8,true),/placement was not verified/);
});
Then('compatible decision cancellation drains and failed cleanup remains failed',async()=>{
  const value=fixture({hold:true}),controller=new AbortController(),engine=await loadDecisionEngine(value.profile,()=>{},value.options);
  let settled=false;const run=engine.decide(request,controller.signal).then(()=>{settled=true;},()=>{settled=true;});
  await new Promise(done=>setImmediate(done));assert.equal(value.record.forwards,1);controller.abort();
  value.completion.resolve();await new Promise(done=>setImmediate(done));assert.equal(settled,false);assert.equal(value.record.exits,1);
  value.exit.resolve();await run;await engine.dispose();assert.equal(value.record.exits,1);
  const broken=fixture({exitFails:true}),failed=await loadDecisionEngine(broken.profile,()=>{},broken.options);
  await assert.rejects(failed.dispose(),/native decision disposal failed/);await assert.rejects(failed.dispose(),/native decision disposal failed/);assert.equal(broken.record.exits,1);
});
