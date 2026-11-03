// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {vi} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {assistantRuntimeDevelopment} from '../build/assistant-plugin.mjs';
import {createDevelopmentVisionWorker} from '../build/assistant-development-worker.mjs';
import {loadAssistantEngine} from './lib/assistant/engine.ts';
import {probeAssistantCompatibility} from './lib/assistant/compatibility.ts';
import {assistantProfile, defaultAssistantSettings, settingsForAssistantModel, validateAssistantSettings} from './lib/assistant/config.ts';
import {createAssistantSession} from './lib/assistant/pi-session.ts';
import {createVisionTool} from './lib/assistant/vision-tool.js';
import visionProfile from './lib/assistant/vision-profile.json';
import compatibleVision from './lib/assistant/vision-compatible-profile.json';
import {visionProfileFor, preflightVision} from './lib/assistant/vision-profiles.ts';
import {COMPATIBLE_PIN, resolveVisionPin} from './lib/assistant/runtime/vision-engine.js';
import {loadVisionRuntime, bindVisionSessionOptions, configureVisionDevice, releaseVisionRuntime} from './lib/assistant/runtime/vision-runtime.js';
import {decisionModels, decisionProfile, validateDecisionRequest, validateDecisionResult, checkDecisionCompatibility} from './lib/assistant/decision-models.ts';
import {loadWllama, loadGemma} from './public/assistant-runtime/load-language.mjs';
import {litertMessages, checkedToolCalls} from './lib/assistant/runtime/text-protocol.js';
import {assertInputBudget, prepareStrandsInput} from './public/assistant-runtime/decision/context-guard.mjs';
const signal = () => new AbortController().signal;
const assetBase = 'https://example.com/assistant-runtime/';
const options = () => ({tools: [], signal: signal(), maxTokens: 32, onText() {}, onThinking() {}});
const image = {data:'AA==', mimeType:'image/png', width:32, height:16};
const result = content => ({message:{content}, finish_reason:'stop'});

Then('Wllama tools keep native arguments and only allocation failures change placement', async () => {
  const attempts = [], disposed = [], captured = {};
  class GGUF {
    constructor(profile) {this.logs=[]; this.layers=profile.settings.gpu_layers; attempts.push(this.layers); this.raw={createChatCompletion: async value => {
      captured.request=value;
      value.onData({choices:[{delta:{content:'Hello ',tool_calls:[{index:0,id:'call',function:{name:'read_',arguments:'{"section":'}}]}}]});
      value.onData({choices:[{delta:{content:'world',tool_calls:[{index:0,function:{name:'application',arguments:'"summary"}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:5}});
    }};}
    async load() {if(this.layers===99) throw Error('Unable to allocate GPU buffer'); return {};}
    async dispose() {disposed.push(this.layers);}
  }
  const profile=assistantProfile('minicpm5-2b');
  const engine=await loadWllama(profile,()=>{}, {assetBase,createGGUF:GGUF,mode:'auto',gpuLayers:8,capabilities:{gpu:{compute:true,f16_compute:true}}});
  const prior={role:'assistant',content:'',tool_calls:[{id:'prior',function:{name:'read_application',arguments:{section:'summary'}}}]};
  const chunks=[], native=await engine.generate([prior],{...options(),onText:value=>chunks.push(value)});
  assert.deepEqual(attempts,[99,8]); assert.deepEqual(disposed,[99]);
  assert.equal(captured.request.messages[0].tool_calls[0].function.arguments,'{"section":"summary"}');
  assert.equal(native.message.content,'Hello world'); assert.deepEqual(chunks,['Hello ','world']);
  assert.equal(native.message.tool_calls[0].function.name,'read_application');
  assert.deepEqual(JSON.parse(native.message.tool_calls[0].function.arguments),{section:'summary'});
  await engine.dispose(); assert.deepEqual(disposed,[99,8]);
  const mapped=[], fake={async generate(){return result('ok');}, async reset(){}, async dispose(){mapped.push('disposed');}};
  const runtimes={async loadWllama(profile,_progress,options){mapped.push({profile,options});return fake;},async loadGemma(profile){mapped.push({profile});return fake;}};
  for(const id of ['minicpm5-2b','gemma-e2b']) {
    const prefs=settingsForAssistantModel(id,defaultAssistantSettings);
    assert.equal(await loadAssistantEngine(prefs,()=>{},signal(),{fp16:true,fp32:true},assetBase,runtimes),fake);
    assert.equal(mapped.at(-1).profile.settings.context_tokens,prefs.context);
  }
  assert.equal(mapped[0].options.gpuLayers,8);
  await loadAssistantEngine({...settingsForAssistantModel('minicpm5-2b',defaultAssistantSettings),sampling:true,temperature:0.9},()=>{},signal(),{fp16:true,fp32:true},assetBase,runtimes);
  assert.equal(mapped.at(-1).profile.settings.sampling_mode,'sample');assert.equal(mapped.at(-1).profile.settings.temperature,0.9);
  await loadAssistantEngine({...settingsForAssistantModel('minicpm5-2b',defaultAssistantSettings),executionMode:'hybrid',gpuLayers:3},()=>{},signal(),{fp16:true,fp32:true},assetBase,runtimes);
  assert.equal(mapped.at(-1).options.gpuLayers,3);
  const early=new AbortController();early.abort();await assert.rejects(()=>loadAssistantEngine(settingsForAssistantModel('gemma-e2b',defaultAssistantSettings),()=>{},early.signal,{fp16:true,fp32:true},assetBase,runtimes));
  const late=new AbortController();await assert.rejects(()=>loadAssistantEngine(settingsForAssistantModel('gemma-e2b',defaultAssistantSettings),()=>{},late.signal,{fp16:true,fp32:true},assetBase,{...runtimes,async loadGemma(){late.abort();return fake;}}));assert.equal(mapped.at(-1),'disposed');
  const request=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('bounded synthetic request failure'));
  try {await assert.rejects(()=>loadAssistantEngine(defaultAssistantSettings,()=>{},signal(),{fp16:true,fp32:true},assetBase),/synthetic/);} finally {request.mockRestore();}
  class NetworkFailure extends GGUF {async load(){throw Error('HTTP503');}}
  attempts.length=0;
  await assert.rejects(()=>loadWllama(profile,()=>{}, {assetBase,createGGUF:NetworkFailure,mode:'auto',gpuLayers:8,capabilities:{gpu:{compute:true,f16_compute:true}}}),/HTTP503/);
  assert.deepEqual(attempts,[99]);
});

Then('Gemma streams through a classic worker and preserves native tool messages', async () => {
  const original=globalThis.Worker, records=[];
  class Worker {
    constructor(url,settings){records.push({url:String(url),settings});}
    postMessage(data){records.push(data); if(data.type==='bootstrap')return; queueMicrotask(()=>this.onmessage({data:{id:data.id,type:'result',result:data.type==='generate'?{text:'native',tool_calls:[{id:'a',function:{name:'read_application',arguments:{section:'summary'}}}]}:{}}}));}
    terminate(){records.push({terminated:true});}
  }
  globalThis.Worker=Worker;
  try {
    const profile={...assistantProfile('gemma-e2b'),settings:{...assistantProfile('gemma-e2b').settings,prefix_cache:false,sampling_mode:'greedy',thinking:false}};
    const engine=await loadGemma(profile,()=>{}, {assetBase});
    assert.equal(records[0].settings.type,'classic'); assert.equal(records[0].url,assetBase+'litert/candidate-bootstrap.js');
    assert.equal(records[1].moduleUrl,assetBase+'gemma-worker.js');
    const native=await engine.generate([{role:'user',content:'Read summary'}],options());
    assert.equal(native.message.content,'native'); assert.equal(native.message.tool_calls[0].function.arguments.section,'summary');
    await engine.dispose(); assert.ok(records.some(row=>row.terminated));
    const nativeBase=new URL('./public/assistant-runtime/',import.meta.url).href;
    const routed=await loadAssistantEngine(settingsForAssistantModel('gemma-e2b',defaultAssistantSettings),()=>{},signal(),{fp16:true,fp32:true},nativeBase);
    await routed.dispose();
    await assert.rejects(()=>loadGemma({...profile,settings:{...profile.settings,thinking:true}},()=>{},{assetBase}),/greedy/);
  } finally {globalThis.Worker=original;}
  const messages=litertMessages([{role:'assistant',content:'',tool_calls:[{id:'tool1',function:{name:'read_application',arguments:{section:'summary'}}}]},{role:'tool',tool_call_id:'tool1',content:'{"ok":true}'}]);
  assert.ok(JSON.stringify(messages).includes('tool_response')); assert.ok(JSON.stringify(messages).includes('read_application'));
  const rejected=checkedToolCalls([{function:{name:'bad name',arguments:{}}}],[]);assert.equal(rejected.tool_calls.length,0);assert.equal(rejected.parse_errors.length,1);
});

Then('image inspection preserves original attachments and the active Pi transcript across two swaps', async () => {
  const events=[], snapshots=[], seen=[]; let loaded=true, turn=0;
  const textEngine={async generate(messages){assert.ok(loaded);seen.push(structuredClone(messages)); turn++;
    if(turn%2===1)return {message:{content:'',tool_calls:[{id:'inspect'+turn,function:{name:'inspect_image',arguments:{image_id:'image-1',question:'Read the code'}}}]},finish_reason:'tool_calls'};
    assert.ok(messages.some(message=>message.role==='tool'&&String(message.content).includes('FRESH-731')));return result('FRESH-731');},async reset(){}};
  const vision=createVisionTool({assetBase,profile:visionProfile,getImage:id=>id==='image-1'?image:null,
    async suspendText(){assert.ok(loaded);loaded=false;events.push('text released');},
    async resumeText(){assert.equal(loaded,false);loaded=true;events.push('text restored');},
    async loadVision(_profile,config){assert.equal(loaded,false);assert.equal(config.contextTokens,1024);events.push('vision loaded');return {
      async generate(_messages,{image:part,maxTokens}){assert.equal(part.data,image.data);assert.equal(maxTokens,256);return {text:'FRESH-731'};},
      async dispose(){events.push('vision released');}};},
  });
  const settings={...settingsForAssistantModel('gemma-e2b',defaultAssistantSettings),maxTurns:6,maxToolCalls:8};
  const session=createAssistantSession(textEngine,settings,async()=>{throw Error('unexpected host tool');},async()=>{throw Error('Pixels reached text');},value=>snapshots.push(value),snapshot=>snapshot(),error=>{throw error;},[vision.tool]);
  await session.send('Read this local image',[],[{id:'image-1',width:32,height:16}]);
  assert.equal(snapshots.at(-1).messages[0].text,'Read this local image');assert.equal(snapshots.at(-1).messages[0].imageCount,1);
  await session.send('Read the same image again');
  assert.deepEqual(events,['text released','vision loaded','vision released','text restored','text released','vision loaded','vision released','text restored']);
  assert.ok(seen[2].some(message=>message.role==='assistant'&&message.content==='FRESH-731'));
  assert.equal(seen[0].some(message=>String(message.content).includes('FRESH-731')),false);
  await vision.dispose();
});

Then('invalid image references never suspend text and failed vision cleanup blocks restoration', async () => {
  let suspended=0,resumed=0;
  const common={assetBase,profile:visionProfile,getImage:id=>id==='known'?image:null,async suspendText(){suspended++;},async resumeText({signal}){signal.throwIfAborted();resumed++;}};
  const missing=createVisionTool({...common,async loadVision(){throw Error('must not load');}});
  await assert.rejects(()=>missing.tool.execute('x',{image_id:'missing',question:'Read'},signal()),/Unknown local image/);
  assert.equal(suspended,0);assert.equal(resumed,0);await missing.dispose();
  const broken=createVisionTool({...common,async loadVision(){return {async generate(){return {text:'observation'};},async dispose(){throw Error('cleanup failed');}};}});
  await assert.rejects(()=>broken.tool.execute('x',{image_id:'known',question:'Read'},signal()),/cleanup failed/);
  assert.equal(suspended,1);assert.equal(resumed,0);
  await assert.rejects(()=>broken.tool.execute('x',{image_id:'known',question:'Read'},signal()));
  await broken.dispose().catch(()=>{});
  let begin, lateResolve, released=false;
  const started=new Promise(resolve=>begin=resolve), cancel=new AbortController();
  const pendingTool=createVisionTool({...common,loadVision(){begin();return new Promise(resolve=>lateResolve=resolve);}});
  const pending=pendingTool.tool.execute('cancel',{image_id:'known',question:'Read'},cancel.signal);
  await started;cancel.abort(new DOMException('Image inspection cancelled','AbortError'));
  lateResolve({async generate(){return {text:'late'};},async dispose(){released=true;}});
  await assert.rejects(pending,/cancel/i);
  await pendingTool.dispose();assert.equal(released,true);assert.equal(resumed,0);
});

Then('decision profiles validate exact questions and native probability readouts', () => {
  assert.equal(decisionModels.length,9);assert.equal(decisionModels.filter(profile=>profile.id.startsWith('d3-')).length,4);
  assert.throws(()=>decisionProfile('experimental'));for(const profile of decisionModels)assert.match(profile.revision,/^[0-9a-f]{40}$/);
  const request=validateDecisionRequest({state:'Translate hello',questions:{q:{type:'choice',instructions:'Pick a task',criteria:{translate:'Translate',code:'Write code'}}}});
  assert.deepEqual(Object.keys(request.questions.q.criteria),['translate','code']);
  const native={answers:{q:{type:'choice',probabilities:{translate:0.8,code:0.2},choice:'translate',confidence:0.3}},raw:{native:true},prepared:{rendered_tokens:32},profile:'d3-lite'};
  assert.equal(validateDecisionResult(request,native),native);
  for(const bad of [null,{}, {state:'x',questions:{}}, {state:'x',questions:{q:{type:'noul',instructions:''}}}, {state:'x',questions:{q:{type:'score',instructions:'Score',criteria:['one']}}}, {state:'x',questions:{q:{type:'choice',instructions:'Pick',criteria:{one:'one'}}}}, {state:'x',questions:{q:{type:'noul',instructions:'yes',criteria:[]}}}])assert.throws(()=>validateDecisionRequest(bad));
  for(const probabilities of [{translate:1},{translate:Infinity,code:0},{translate:0.2,code:0.2},{translate:0.5,code:0.5},{translate:-0.2,code:1.2}])assert.throws(()=>validateDecisionResult(request,{...native,answers:{q:{...native.answers.q,probabilities}}}));
  assert.throws(()=>validateDecisionResult(request,{...native,answers:{q:{...native.answers.q,choice:'code'}}}));
  assert.throws(()=>validateDecisionResult(request,{...native,answers:{q:{...native.answers.q,confidence:NaN}}}));
  for(const criteria of [null,[],42])assert.throws(()=>validateDecisionRequest({state:'x',questions:{q:{type:'choice',instructions:'Choose',criteria}}}));
  assert.throws(()=>validateDecisionRequest({state:'x'.repeat(64000),questions:{q:{type:'noul',instructions:'Yes?'}}}),/64000/);
  for(const bad of [null,{answers:{}},{answers:{q:{type:'score'}}},{answers:{q:{type:'choice',probabilities:null}}},{answers:{q:{type:'choice',probabilities:'invalid'}}}])assert.throws(()=>validateDecisionResult(request,bad));
  const noul=validateDecisionRequest({state:'blue',questions:{q:{type:'noul',instructions:'Blue?'}}});
  validateDecisionResult(noul,{...native,answers:{q:{type:'noul',noul:0.9,probabilities:{true:0.9,false:0.1}}}});
  assert.throws(()=>validateDecisionResult(noul,{...native,answers:{q:{type:'noul',noul:0.4,probabilities:{true:0.9,false:0.1}}}}));
  const score=validateDecisionRequest({state:'good',questions:{q:{type:'score',instructions:'Rate',criteria:['low','high']}}});
  validateDecisionResult(score,{...native,answers:{q:{type:'score',score:0.9,probabilities:{0:0.1,1:0.9}}}});
  assert.throws(()=>validateDecisionResult(score,{...native,answers:{q:{type:'score',score:NaN,probabilities:{0:0.1,1:0.9}}}}));
});

Then('native decision guards preserve complete inputs and separate CPU compatibility', async () => {
  assert.throws(()=>assertInputBudget({rendered_tokens:1025},{harnessLimit:1024,contextSize:4096}),/no truncation/);
  assert.throws(()=>assertInputBudget({rendered_tokens:1024},{harnessLimit:1024,contextSize:1024,reservedTokens:1}),/no truncation/);
  assert.throws(()=>assertInputBudget({rendered_tokens:128},{harnessLimit:1024,contextSize:1024,batchSize:64,blockTokenCounts:[80,48]}),/attention block/);
  const prepared=prepareStrandsInput({state:'all state',questions:{q:{type:'noul',instructions:'Question?'}}},{tokenizer:{encode:text=>({ids:[...text].map(x=>x.charCodeAt(0))})},renderState:value=>value,renderQuestion:value=>({text:value.instructions}),buildInputs:()=>({stateIds:[],questions:[{ids:[]}]}),maxLength:4096});
  assert.throws(()=>assertInputBudget(prepared,{harnessLimit:1024,contextSize:4096}),/discard/);
  const cpu=await checkDecisionCompatibility('strands-cpu',{isSecureContext:true,crossOriginIsolated:true,WebAssembly});
  assert.equal(cpu.ready,true);assert.match(cpu.summary,/CPU Wasm/);
  assert.equal((await checkDecisionCompatibility('strands-cpu',{isSecureContext:false})).ready,false);
  assert.equal((await checkDecisionCompatibility('strands-gpu',{isSecureContext:true,crossOriginIsolated:true})).ready,false);
});

function nativeEnvironment({gpu=true, fp16=true, secure=true, isolated=true, simd=true, memory64=true, jspi=true}={}) {
  const device=()=>({pushErrorScope(){},async popErrorScope(){return null;},createShaderModule(){return {};},async createComputePipelineAsync(){return {getBindGroupLayout(){return {};}};},
    createBuffer(){return {destroy(){},async mapAsync(){},getMappedRange(){return new Float32Array([3.5]).buffer;},unmap(){}};},queue:{writeBuffer(){},submit(){}},createBindGroup(){return {};},
    createCommandEncoder(){return {beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},copyBufferToBuffer(){},finish(){return {};}};},destroy(){}});
  const adapter={features:new Set(fp16?['shader-f16']:[]),requestDevice:async()=>device()};
  return {isSecureContext:secure,crossOriginIsolated:isolated,WebAssembly:{validate:bytes=>bytes[8]===1?simd:memory64,...(jspi?{Suspending:class{}}:{})},
    ...(gpu?{navigator:{gpu:{requestAdapter:async()=>adapter}}}:{})};
}
Then('native runtime checks distinguish CPU placement from missing GPU and Wasm features', async () => {
  const mini=settingsForAssistantModel('minicpm5-2b',defaultAssistantSettings),ornith=settingsForAssistantModel('ornith-q4',defaultAssistantSettings);
  for(const change of [{secure:false},{isolated:false},{simd:false},{memory64:false},{jspi:false}])assert.equal((await probeAssistantCompatibility(nativeEnvironment(change),mini)).ready,false);
  for(const executionMode of ['auto','cpu'])assert.equal((await probeAssistantCompatibility(nativeEnvironment({gpu:false}),{...mini,executionMode})).ready,true);
  for(const executionMode of ['gpu','hybrid'])assert.equal((await probeAssistantCompatibility(nativeEnvironment({gpu:false}),{...mini,executionMode})).ready,false);
  assert.equal((await probeAssistantCompatibility(nativeEnvironment({gpu:false}),{...ornith,executionMode:'auto'})).ready,false);
  assert.equal((await probeAssistantCompatibility(nativeEnvironment(),mini)).ready,true);
  assert.match((await probeAssistantCompatibility(nativeEnvironment(),{...mini,executionMode:'cpu'})).summary,/CPU/);
  const saved=globalThis.WebAssembly;
  try {const env=nativeEnvironment({gpu:false});globalThis.WebAssembly=env.WebAssembly;delete env.WebAssembly;assert.equal((await probeAssistantCompatibility(env,mini)).ready,true);}
  finally {globalThis.WebAssembly=saved;}
  for(const id of ['strands-gpu','d3-lite'])assert.equal((await checkDecisionCompatibility(id,nativeEnvironment())).ready,true);
  assert.equal((await checkDecisionCompatibility('strands-gpu',nativeEnvironment({fp16:false}))).ready,false);
});

Then('compatible image loaders bind each official session to the verified owned device', async () => {
  assert.equal(visionProfileFor('fp16').id, visionProfile.id);
  assert.equal(visionProfileFor('compatible').id, compatibleVision.id);
  assert.equal(resolveVisionPin(compatibleVision), COMPATIBLE_PIN);
  for (const precision_variant of ['official-q4-fp32-no-f16-v1', 'official-q4-fp32-placement-audit-v1', 'unknown'])
    assert.throws(() => resolveVisionPin({...compatibleVision, settings:{...compatibleVision.settings, precision_variant}}), /Unqualified vision precision/);
  const files = compatibleVision.files.filter(file => file.file.startsWith('onnx/'));
  assert.equal(files.length, 5); assert.equal(files.reduce((sum, file) => sum + file.bytes, 0), COMPATIBLE_PIN.artifactBytes);
  assert.ok(!files.some(file => file.file === 'onnx/embed_tokens.onnx_data'));
  const events = [], device = {features:new Set(),limits:{maxStorageBuffersPerShaderStage:16},destroy(){events.push('destroy');},
    createComputePipeline(){return {};},createCommandEncoder(){return {beginComputePass(){return {dispatchWorkgroups(){},dispatchWorkgroupsIndirect(){}};},finish(){return {};}};},
    queue:{submit(){},async onSubmittedWorkDone(){events.push('drain');}}};
  let requested;
  const adapter = {features:new Set(['shader-f16']), limits:{maxStorageBuffersPerShaderStage:16}, async requestDevice(options){requested=options;return device;}};
  const library = {env:{backends:{onnx:{webgpu:{}}}}};
  const selection = await configureVisionDevice(library,COMPATIBLE_PIN,{gpu:{requestAdapter:async()=>adapter},isSecureContext:true});
  assert.equal(selection.device,device); assert.deepEqual(requested.requiredFeatures,[]); assert.equal(requested.requiredLimits.maxStorageBuffersPerShaderStage,16);
  const sessionOptions = bindVisionSessionOptions(COMPATIBLE_PIN,device), captured=[];
  assert.equal(sessionOptions.executionProviders[0].device,device);
  assert.equal(sessionOptions.extra.session.disable_cpu_ep_fallback,'0');
  Object.assign(library,{
    AutoConfig:{from_pretrained:async()=>({})},TokenizersBackend:class{constructor(json,config){assert.deepEqual(json,{tokens:'pinned'});assert.equal(config.tokenizer_class,'TokenizersBackend');}},
    Lfm2VlImageProcessor:class{},Lfm2VlProcessor:class{},
    PreTrainedModel:{async from_pretrained(repo,options){captured.push({repo,...options});return {sessions:{model:{outputNames:[options.model_file_name==='embed_tokens'?'inputs_embeds':options.model_file_name==='embed_images'?'image_features':'logits']}}};}},
    Lfm2VlForConditionalGeneration:class{constructor(config,sessions){this.sessions=sessions;}async dispose(){events.push('dispose-model');}},
  });
  const metadataURLs=[];
  const runtime = await loadVisionRuntime(library,COMPATIBLE_PIN,{sessionOptions,fetchText:async()=>'template',fetchJSON:async url=>{metadataURLs.push(url);return url.endsWith('/tokenizer_config.json')?{tokenizer_class:'TokenizersBackend'}:url.endsWith('/tokenizer.json')?{tokens:'pinned'}:{image_processor:{}};}});
  assert.ok(metadataURLs.every(url=>url.startsWith(`https://huggingface.co/${COMPATIBLE_PIN.repo}/resolve/${COMPATIBLE_PIN.revision}/`)));
  assert.deepEqual(metadataURLs.map(url=>url.split('/').at(-1)),['generation_config.json','tokenizer.json','tokenizer_config.json','processor_config.json']);
  assert.deepEqual(captured.map(value=>[value.model_file_name,value.dtype,value.use_external_data_format]),[['embed_tokens','fp32',false],['embed_images','q4',true],['decoder','q4',true]]);
  assert.ok(captured.every(value=>value.revision===compatibleVision.revision && value.session_options.executionProviders[0].device===device));
  const encoder = device.createCommandEncoder();encoder.beginComputePass().dispatchWorkgroups(1);device.queue.submit([encoder.finish()]);
  const metrics = await selection.placementAudit.drain();assert.equal(metrics.queue_drained_dispatches,1);assert.equal(metrics.queue_drain,'complete');
  await releaseVisionRuntime(runtime,device);assert.deepEqual(events.slice(-3),['dispose-model','drain','destroy']);
});

Then('incompatible image adapters leave the existing text model loaded', async () => {
  const capabilities={fp16:false,fp32:true};let devices=0;
  const gpu = buffers => ({requestAdapter:async()=>({features:new Set(),limits:{maxStorageBuffersPerShaderStage:buffers},requestDevice:async()=>{devices++;throw Error('No device should be allocated during preflight');}})});
  await assert.rejects(preflightVision('fp16',capabilities,gpu(16)),/requires verified WebGPU shader-f16/);
  await assert.rejects(preflightVision('compatible',capabilities,gpu(8)),/at least 9 storage/);
  await preflightVision('compatible',capabilities,gpu(16));assert.equal(devices,0);
  const library={env:{backends:{onnx:{webgpu:{}}}}};
  await assert.rejects(configureVisionDevice(library,COMPATIBLE_PIN,{gpu:gpu(8),isSecureContext:true}),/at least 9 storage/);assert.equal(devices,0);
  const events=[];
  const tool=createVisionTool({assetBase,profile:compatibleVision,getImage:()=>image,preflight:()=>preflightVision('compatible',capabilities,gpu(8)),
    suspendText:async()=>events.push('suspend'),resumeText:async()=>events.push('resume'),loadVision:async()=>{throw Error('Must not load image weights');}});
  await assert.rejects(tool.tool.execute('call',{image_id:'local',question:'Describe this image'},signal()),/at least 9 storage/);
  assert.deepEqual(events,[]);assert.equal(tool.state.text_ready,true);assert.equal(tool.state.cleanup_failed,false);await tool.dispose();
  assert.throws(()=>createVisionTool({assetBase,profile:{...compatibleVision,settings:{...compatibleVision.settings,max_new_tokens:256}},getImage:()=>image,suspendText:async()=>{},resumeText:async()=>{}}),/budgets exceed/);
  const supported=createVisionTool({assetBase,profile:compatibleVision,getImage:()=>image,preflight:()=>preflightVision('compatible',capabilities,gpu(16)),
    suspendText:async()=>events.push('suspend'),resumeText:async()=>events.push('resume'),loadVision:async(_profile,options)=>{
      assert.equal(options.contextTokens,1024);assert.equal(options.outputTokens,128);
      return {info:{device:'webgpu'},async generate(_messages,request){assert.equal(request.maxTokens,128);events.push('generate');return {text:'A red square.'};},async dispose(){events.push('dispose');}};
    }});
  await supported.tool.execute('call',{image_id:'local',question:'Describe this image'},signal());
  assert.deepEqual(events,['suspend','generate','dispose','resume']);await supported.dispose();
});

Then('compatible image setup failures destroy owned devices and release partial sessions', async () => {
  for(const fault of ['device','logLevel','instrumentation']) {
    let destroyed=0;
    const device={features:new Set(),limits:{maxStorageBuffersPerShaderStage:16},destroy(){destroyed++;},createComputePipeline(){},createCommandEncoder(){},queue:{submit(){}}};
    const onnx={webgpu:{}};
    if(fault==='instrumentation')Object.defineProperty(device,'createCommandEncoder',{value(){},configurable:false,writable:false});
    else Object.defineProperty(fault==='device'?onnx.webgpu:onnx,fault,{set(){throw Error('setup rejected');}});
    const gpu={requestAdapter:async()=>({features:new Set(),limits:{maxStorageBuffersPerShaderStage:16},requestDevice:async()=>device})};
    await assert.rejects(configureVisionDevice({env:{backends:{onnx}}},COMPATIBLE_PIN,{gpu,isSecureContext:true}),/setup rejected|redefine|define property/i);
    assert.equal(destroyed,1,'Every post-allocation setup failure destroys the owned device once.');
  }
  const released=[];
  const library={AutoConfig:{from_pretrained:async()=>({})},TokenizersBackend:class{},Lfm2VlImageProcessor:class{},Lfm2VlProcessor:class{},
    PreTrainedModel:{async from_pretrained(_repo,{model_file_name}){
      if(model_file_name==='embed_images')throw Error('second graph failed');
      return {sessions:{model:{outputNames:['inputs_embeds'],async release(){released.push(model_file_name);}}}};
    }}};
  await assert.rejects(loadVisionRuntime(library,COMPATIBLE_PIN,{fetchText:async()=>'template',fetchJSON:async()=>({image_processor:{},tokenizer_class:'TokenizersBackend'})}),/second graph failed/);
  assert.deepEqual(released,['embed_tokens']);
  for(const executionMode of ['cpu','hybrid']) {
    const preferences=validateAssistantSettings({...defaultAssistantSettings,model:'minicpm5-2b',executionMode,visionMode:'compatible'});
    assert.equal(preferences.executionMode,executionMode);assert.equal(preferences.visionMode,'compatible');
  }
  assert.throws(()=>validateAssistantSettings({...defaultAssistantSettings,visionMode:'failed-precision-variant'}),/available image runtime/);
});

Then('development image requests use current source beside older built runtime assets', async () => {
  const root=await mkdtemp(join(tmpdir(),'operations-image-route-')), builtRoot=join(root,'built'),sourceRoot=join(root,'source');
  await mkdir(builtRoot);await mkdir(sourceRoot);
  await writeFile(join(builtRoot,'vision-engine.js'),'export const marker="stale";');
  await writeFile(join(builtRoot,'vision-worker.js'),'export const marker="stale-worker";');
  await writeFile(join(sourceRoot,'vision-engine.js'),'export const marker="current-compatible";');
  await writeFile(join(builtRoot,'native.wasm'),new Uint8Array([0,97,115,109]));
  let handler;
  assistantRuntimeDevelopment({builtRoot,sourceRoot,bundleVisionWorker:async()=>({code:'export const marker="current-worker";',assets:new Map()})}).configureServer({config:{server:{headers:{'Cross-Origin-Opener-Policy':'same-origin'}}},middlewares:{use(route,callback){assert.equal(route,'/assistant-runtime');handler=callback;}}});
  const server=createServer((request,response)=>{
    request.url=request.url.slice('/assistant-runtime'.length);
    void handler(request,response,error=>{response.statusCode=error?500:404;response.end(error?String(error):'missing');});
  });
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/assistant-runtime/`;
    const factory=await fetch(base+'vision-engine.js');assert.equal(await factory.text(),'export const marker="current-compatible";');assert.equal(factory.headers.get('cross-origin-opener-policy'),'same-origin');
    const worker=await fetch(base+'vision-worker.js');assert.equal(await worker.text(),'export const marker="current-worker";');assert.equal(worker.headers.get('cross-origin-opener-policy'),'same-origin');
    const native=await fetch(base+'native.wasm');assert.equal(native.status,200);assert.equal(native.headers.get('content-type'),'application/wasm');assert.deepEqual(new Uint8Array(await native.arrayBuffer()),new Uint8Array([0,97,115,109]));
  } finally {await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});

Then('development image compilation is cached refreshed and retried without stale fallback', async () => {
  const root=await mkdtemp(join(tmpdir(),'operations-image-build-'));
  const inputs=['src/lib/assistant/runtime/vision-worker.js','src/lib/assistant/runtime/vision-runtime.js','src/public/assistant-runtime/vision-engine.js','build/assistant-worker-build.mjs','package-lock.json'];
  try {
    for(const file of inputs){await mkdir(dirname(join(root,file)),{recursive:true});await writeFile(join(root,file),'initial');}
    let builds=0,fail=false;
    const bundle=createDevelopmentVisionWorker({async buildWorker(options){
      builds++;assert.equal(options.configFile,false);assert.equal(options.build.write,false);
      assert.deepEqual(options.resolve.conditions,['onnxruntime-web-use-extern-wasm','module','browser','production']);
      if(fail){fail=false;throw Error('compiler failed');}
      return {output:[{type:'chunk',isEntry:true,code:`worker-${builds}`,fileName:'vision-worker.js'}]};
    }});
    const server={config:{root:join(root,'src'),cacheDir:join(root,'cache')}};
    const [first,second]=await Promise.all([bundle(server),bundle(server)]);assert.equal(builds,1);assert.equal(first,second);
    await writeFile(join(root,inputs[1]),'updated helper');assert.equal((await bundle(server)).code,'worker-2');assert.equal(builds,2);
    await writeFile(join(root,inputs[0]),'updated worker');fail=true;
    await assert.rejects(bundle(server),/compiler failed/);
    assert.equal((await bundle(server)).code,'worker-4');assert.equal(builds,4);
  } finally {await rm(root,{recursive:true,force:true});}
});
