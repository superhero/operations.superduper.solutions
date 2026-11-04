// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {vi} from 'vitest';
import {defaultAssistantSettings,settingsForAssistantModel} from './lib/assistant/config.ts';
import {loadAssistantEngine,loadBonsaiEngine} from './lib/assistant/engine.ts';
import {createAssistantSession} from './lib/assistant/pi-session.ts';
import {preflightVision} from './lib/assistant/vision-profiles.ts';
import {checkDecisionCompatibility} from './lib/assistant/decision-models.ts';
import {profileById,artifactsFor} from './lib/assistant/model-storage/catalog.ts';
import {createModelEvents} from './lib/assistant/model-storage/events.ts';
import {modelFiles} from './lib/speech/assets.js';
const signal=()=>new AbortController().signal;
const assetBase='https://operations.test/assistant-runtime/';
Then('native assistant turns bypass estimates without trimming the request',async()=>{
  const input='Unabridged input '.repeat(50)+'end',calls=[];
  const session=createAssistantSession({contextMode:'native',contextLimit:1,async reset(){},async generate(messages,options){
    calls.push({messages,options});return{message:{content:'Native answer'},usage:{prompt_tokens:12,completion_tokens:2}};
  }},{...defaultAssistantSettings,tools:false,context:128,maxTokens:512},()=>assert.fail(),async()=>({}),()=>{},callback=>callback());
  await session.send(input);assert.equal(calls.length,1);assert.equal(calls[0].options.maxTokens,512);
  assert.ok(calls[0].messages.some(message=>message.role==='user'&&JSON.stringify(message.content).includes(input)));
});
Then('Bonsai loaders preserve their reader and reject unavailable native adapters',async()=>{
  const calls=[],network=async()=>{calls.push('network');return new Response('',{status:404});};
  vi.stubGlobal('fetch',network);
  try{
    const reader=async()=>{calls.push('installed');return new Response('',{status:503});};
    await assert.rejects(loadAssistantEngine(defaultAssistantSettings,()=>{},signal(),{fp16:true,fp32:true},assetBase,undefined,{fetch:reader,modelId:'2b'}),/503/);
    assert.deepEqual(calls,['installed']);
    await assert.rejects(loadAssistantEngine(defaultAssistantSettings,()=>{},signal(),{fp16:true,fp32:true},assetBase),/404/);
    assert.deepEqual(calls,['installed','network']);
    await assert.rejects(loadAssistantEngine(settingsForAssistantModel('minicpm5-fp32',defaultAssistantSettings),()=>{},signal(),{fp16:false,fp32:true},assetBase,{}),/runtime is unavailable/);
  }finally{vi.unstubAllGlobals();}
});
Then('concurrent native stream failures reset safely before retry',async()=>{
  const failure=Error('Native stream failed');let fail=true,resets=0,disposed=0;
  const native={max_length:512,count_tokens:()=>({prompt_tokens:4,image_tokens:0}),async reset(){resets++;},async dispose(){disposed++;},generate(){
    return Object.assign((async function*(){if(fail)throw failure;yield{type:'text',text:'Recovered'};})(),
      {result:fail?Promise.reject(failure):Promise.resolve({message:{content:'Recovered'},finish_reason:'stop'})});
  }};
  const engine=await loadBonsaiEngine(defaultAssistantSettings,()=>{},signal(),{fp16:true},async()=>({Qwen3_5ForConditionalGeneration:{async from_pretrained(){return{create_session:()=>native,async dispose(){}};}}}));
  assert.equal(engine.contextLimit,512);const options=()=>({tools:[],signal:signal(),maxTokens:16,onText(){},onThinking(){}});
  await assert.rejects(engine.generate([],options()),error=>error===failure);await new Promise(resolve=>setImmediate(resolve));
  const before=resets;fail=false;assert.equal((await engine.generate([],options())).message.content,'Recovered');assert.equal(resets,before+1);
  await engine.dispose();assert.equal(disposed,1);
});
Then('vision preflight rejects missing capabilities and missing device limits',async()=>{
  await preflightVision('fp16',{fp16:true,fp32:false},null);
  await assert.rejects(preflightVision('compatible',{fp16:false,fp32:false},{}),/verified WebGPU FP32/);
  await assert.rejects(preflightVision('compatible',{fp16:false,fp32:true},null),/verified WebGPU FP32/);
  for(const adapter of [null,{}, {limits:{}}])await assert.rejects(preflightVision('compatible',{fp16:false,fp32:true},{async requestAdapter(){return adapter;}}),/9 storage buffers/);
  vi.stubGlobal('navigator',{gpu:{async requestAdapter(){return{limits:{maxStorageBuffersPerShaderStage:9}};}}});
  try{await preflightVision('compatible',{fp16:false,fp32:true});}finally{vi.unstubAllGlobals();}
});
Then('compatible Strands rejects absent GPU support with the host Wasm implementation',async()=>{
  const result=await checkDecisionCompatibility('strands-fp32',{isSecureContext:false,crossOriginIsolated:false,navigator:{}});
  assert.equal(result.ready,false);assert.match(result.summary,/requires WebGPU/);
});
Then('installed catalogs reject invalid file and publication part pins',()=>{
  function invalid(id,edit,pattern){const profile=profileById(id),original=profile.files;try{profile.files=structuredClone(original);edit(profile.files);assert.throws(()=>artifactsFor(profile),pattern);}finally{profile.files=original;}}
  for(const edit of [files=>{files[0].bytes=0;},files=>{files[0].bytes=1.5;},files=>{files[0].sha256='invalid';},files=>{files[0].url='https://untrusted.invalid/model';}])invalid('image:compatible',edit,/immutable artifact pin/);
  invalid('image:compatible',files=>{files[0].parts=[{url:'https://untrusted.invalid/part',bytes:files[0].bytes}];},/immutable part pins/);
  const decoder=files=>files.find(file=>file.file==='decoder-single-step.int8-fp32.onnx');
  for(const edit of [files=>{files[0].parts=[{url:files[0].url,bytes:files[0].bytes}];},files=>{decoder(files).parts=[];},files=>{decoder(files).parts[0].url+='-wrong';},files=>{decoder(files).parts[0].bytes--;},files=>{const file=decoder(files);file.url='https://huggingface.co/model/repo/resolve/'+'a'.repeat(40)+'/decoder';file.parts[0].url=file.url;}])invalid('speech:parakeet-continuous',edit,/immutable download pin/);
  const parts=files=>files.find(file=>file.parts?.length>1).parts;
  for(const edit of [files=>{parts(files)[0].bytes--;},files=>{const p=parts(files);p[1].bytes+=p[0].bytes;p[0].bytes=0;},files=>{const p=parts(files);p[0].bytes-=.5;p[1].bytes+=.5;},files=>{const p=parts(files);p[0].bytes++;p[1].bytes--;},files=>{const p=parts(files);p[0].bytes--;p[1].bytes++;},files=>{parts(files)[0].url+='-wrong';}])invalid('decision:strands-fp32',edit,/immutable part pins/);
});
Then('model notifications preserve listeners across optional channel lifetimes',()=>{
  const opened=[],events=createModelEvents(),calls=[];vi.stubGlobal('BroadcastChannel',undefined);
  try{
    events.publish();const remove=events.subscribe(()=>calls.push('offline'));events.publish();assert.deepEqual(calls,['offline']);remove();
    vi.stubGlobal('BroadcastChannel',class{constructor(name){this.name=name;this.posts=[];this.closed=0;opened.push(this);}postMessage(value){this.posts.push(value);}close(){this.closed++;}});
    events.publish();assert.equal(opened.length,1);assert.equal(opened[0].closed,1);
    const first=events.subscribe(()=>calls.push('first')),second=events.subscribe(()=>calls.push('second'));
    assert.equal(opened.length,2);opened[1].onmessage({data:'changed'});assert.deepEqual(calls.slice(-2),['first','second']);
    events.publish();assert.deepEqual(opened[1].posts,['changed']);assert.equal(opened[1].closed,0);
    first();events.publish();assert.equal(calls.at(-1),'second');assert.equal(opened[1].closed,0);second();assert.equal(opened[1].closed,1);
    const final=events.subscribe(()=>{});assert.equal(opened.length,3);final();assert.equal(opened[2].closed,1);
  }finally{vi.unstubAllGlobals();}
});
Then('installed asset routing handles URL and Request objects without remote fallback',async()=>{
  const calls=[],network=async(input)=>{calls.push(['network',String(input instanceof Request?input.url:input)]);return new Response('network');},local=async(input)=>{calls.push(['installed',String(input instanceof Request?input.url:input)]);return new Response('installed');};
  vi.doMock('./lib/assistant/model-storage/storage.ts',()=>({installedFetch:()=>local,acquireModelUse:async()=>async()=>{},installModel:async()=>{}}));
  vi.stubGlobal('location',{href:'https://operations.test/',origin:'https://operations.test'});
  try{
    const{modelAssetFetch}=await import('./lib/assistant/model-storage/runtime.ts?url-boundaries');const read=modelAssetFetch('2b',network);
    await read(new URL('https://publisher.test/model'));await read(new Request('https://publisher.test/model'));
    await read(new URL('/asset.js',location.href));await read(new Request('https://operations.test/asset.js'));await read('/asset.js');await read('data:image/webp;base64,AA==');
    assert.deepEqual(calls.map(([kind])=>kind),['installed','installed','network','network','network','network']);
    vi.stubGlobal('location',undefined);await read(new Request('https://publisher.test/model'));assert.equal(calls.at(-1)[0],'installed');
  }finally{vi.unstubAllGlobals();vi.doUnmock('./lib/assistant/model-storage/storage.ts');}
});
Then('continuous speech rejects the legacy asset loader before fetching',async()=>{
  await assert.rejects(modelFiles('gpu-continuous',()=>{}, {getFile:()=>assert.fail('The continuous profile must use its verified installer.')}),/verified installed-model reader/);
});
