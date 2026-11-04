// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {BrowserWorkQueue, BrowserRuntimeOwner, browserLease} from './lib/assistant/runtime-ownership.js';
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve=yes;reject=no;});return {promise,resolve,reject};};
const until = async predicate => {const deadline=Date.now()+2000;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,1));}assert.fail('Expected coordination event did not arrive');};
function environment() {
  const queues=new Map(), channels=new Set(), events=[];
  const drain=name=>{
    const jobs=queues.get(name);if(!jobs?.length||jobs[0].active)return;
    const job=jobs[0];job.active=true;job.signal?.removeEventListener('abort',job.abort);events.push('grant:'+name);
    const finish=(value,failed)=>{events.push('release:'+name);jobs.shift();drain(name);failed?job.reject(value):job.resolve(value);};
    Promise.resolve().then(job.callback).then(value=>finish(value,false),error=>finish(error,true));
  };
  const locks={request(name,options,callback){
    return new Promise((resolve,reject)=>{
      if(options.signal?.aborted){reject(options.signal.reason);return;}
      const jobs=queues.get(name)||[];queues.set(name,jobs);
      const job={callback,resolve,reject,signal:options.signal,abort(){const index=jobs.indexOf(job);if(index>=0)jobs.splice(index,1);reject(options.signal.reason);drain(name);}};
      options.signal?.addEventListener('abort',job.abort,{once:true});jobs.push(job);drain(name);
    });
  }};
  const channel=()=>{const item={onmessage:null,postMessage(data){for(const peer of channels)if(peer!==item)queueMicrotask(()=>peer.onmessage?.({data}));},close(){channels.delete(item);}};channels.add(item);return item;};
  return {locks,channel,events};
}
Then('local model queues cancel waiters and finish active cleanup in FIFO order',async()=>{
  const queue=new BrowserWorkQueue(),hold=deferred(),events=[],cancel=new AbortController();
  const active=queue.run(async()=>{events.push('active');await hold.promise;events.push('cleanup');});
  const rejected=assert.rejects(queue.run(async()=>events.push('cancelled'),cancel.signal),/queued cancelled/);
  const next=queue.run(async()=>events.push('next'));
  cancel.abort(Error('queued cancelled'));await rejected;assert.deepEqual(events,['active']);assert.equal(queue.busy,true);
  hold.resolve();await Promise.all([active,next]);assert.deepEqual(events,['active','cleanup','next']);assert.equal(queue.busy,false);
  const failed=new AbortController();failed.abort(Error('already cancelled'));await assert.rejects(queue.run(async()=>events.push('never'),failed.signal),/already cancelled/);
});
Then('local model ownership serializes physical cleanup before the next owner',async()=>{
  const env=environment(),events=[],tool=deferred(),dispose=deferred();
  const a=new BrowserRuntimeOwner({...env,id:'language',suspend:async()=>{events.push('dispose-start');await dispose.promise;events.push('dispose-end');}});
  const b=new BrowserRuntimeOwner({...env,id:'decision',suspend:async()=>events.push('decision-dispose')});
  await a.run(async()=>events.push('loaded'));
  const turn=a.run(async()=>{events.push('turn');await tool.promise;events.push('tool-result');events.push('final-answer');});
  const second=b.run(async()=>events.push('next-model'));
  await until(()=>events.includes('turn'));assert.deepEqual(events,['loaded','turn']);
  tool.resolve();await until(()=>events.includes('dispose-start'));assert.equal(events.includes('next-model'),false);
  dispose.resolve();await Promise.all([turn,second]);assert.deepEqual(events.slice(0,7),['loaded','turn','tool-result','final-answer','dispose-start','dispose-end','next-model']);
  await Promise.all([a.close(),b.close()]);
  const release=await browserLease('test-release',undefined,env.locks);await release();assert.equal(env.events.at(-1),'release:test-release');
});
Then('local model leases remain held after unknown cleanup and release after recovery',async()=>{
  const env=environment(),errors=[];let broken=true,next=false;
  const a=new BrowserRuntimeOwner({...env,id:'a',suspend:async()=>{if(broken)throw Error('unknown native cleanup');},onError:error=>errors.push(error)});
  const b=new BrowserRuntimeOwner({...env,id:'b',suspend:async()=>{}});
  await a.run(async()=>{});const pending=b.run(async()=>{next=true;});
  await until(()=>errors.length>0);assert.match(errors[0].message,/unknown native cleanup/);assert.equal(next,false);
  broken=false;await a.release();await pending;assert.equal(next,true);await Promise.all([a.close(),b.close()]);
});
Then('explicit CPU work leaves GPU ownership unchanged',async()=>{
  const env=environment();let disposals=0;
  const gpu=new BrowserRuntimeOwner({...env,id:'gpu',suspend:async()=>{disposals++;}});
  const cpu=new BrowserRuntimeOwner({...env,id:'cpu',suspend:async()=>assert.fail('CPU speech cannot dispose a GPU model')});
  await gpu.run(async()=>{});const before=env.events.length;await cpu.run(async()=>42,{gpu:false});
  assert.equal(disposals,0);assert.equal(env.events.length,before);
  await cpu.close();await gpu.close();assert.equal(disposals,1);
});

Then('the assistant worker owns the complete tool loop and restores text without repeating tools',async()=>{
  const {vi}=await import('vitest'),env=environment(),posts=[],events=[],frozen=[],invalidated=new Set();let loads=0,forwards=0;
  const fakeLoad=async settings=>{frozen.push(structuredClone(settings));const id=++loads;events.push('load:'+id);return {get invalidated(){return invalidated.has(id);},
    async reset(){},async dispose(){events.push('dispose:'+id);},
    async generate(messages){
      forwards++;
      const tools=messages.filter(message=>message.role==='tool');
      return {message:tools.length?{content:'Application verified.'}:{content:'',tool_calls:[{id:'read-once',function:{name:'read_application',arguments:{section:'summary'}}}]},finish_reason:tools.length?'stop':'tool_calls'};
    },
  };};
  vi.doMock('./lib/assistant/engine.ts',()=>({loadAssistantEngine:fakeLoad}));
  vi.doMock('./lib/assistant/compatibility.ts',()=>({probeAssistantCompatibility:async()=>({ready:true,fp32:true,fp16:true,summary:'Controlled source device'})}));
  let assetReleases=0;vi.doMock('./lib/assistant/model-storage/runtime.ts',()=>({prepareModelAssets:async()=>async()=>{assetReleases++;},modelAssetFetch:()=>globalThis.fetch}));
  const prior=globalThis.onmessage;
  vi.stubGlobal('navigator',{locks:env.locks});vi.stubGlobal('BroadcastChannel',class{constructor(){return env.channel();}});
  vi.stubGlobal('location',{origin:'https://example.com'});vi.stubGlobal('postMessage',data=>posts.push(data));
  let next;
  try {
    await import('./lib/assistant/inference.worker.ts');
    const send=data=>globalThis.onmessage({data});
    send({type:'load',settings:{model:'2b',context:32768,maxTokens:128},assetBase:'https://example.com/assistant-runtime/'});await until(()=>posts.some(row=>row.type==='ready'));
    send({type:'send',text:'Read the current application.'});await until(()=>posts.some(row=>row.type==='tool'));
    next=new BrowserRuntimeOwner({...env,id:'other-model',suspend:async()=>events.push('other-dispose')});
    const handed=next.run(async()=>events.push('other-load'));
    await new Promise(resolve=>setImmediate(resolve));assert.equal(events.includes('other-load'),false);assert.equal(events.includes('dispose:1'),false);
    const call=posts.find(row=>row.type==='tool');send({type:'tool_result',id:call.id,value:{workflow:'Fresh application record'}});
    await handed;await until(()=>posts.some(row=>row.type==='done'));
    assert.ok(events.indexOf('dispose:1')<events.indexOf('other-load'));assert.equal(posts.filter(row=>row.type==='tool').length,1);
    send({type:'send',text:'Keep the previous application result.'});await until(()=>posts.filter(row=>row.type==='done').length===2);
    assert.equal(loads,2);assert.deepEqual(frozen[0],frozen[1]);assert.equal(forwards,3);assert.equal(posts.filter(row=>row.type==='tool').length,1);
    invalidated.add(2);send({type:'send',text:'Continue after the canceled physical engine.'});await until(()=>posts.filter(row=>row.type==='done').length===3);
    assert.equal(loads,3);assert.deepEqual(frozen[0],frozen[2]);assert.equal(posts.filter(row=>row.type==='tool').length,1);
    const view=posts.filter(row=>row.type==='update').at(-1).messages;
    assert.equal(view.filter(row=>row.role==='user').length,3);assert.equal(view.filter(row=>row.role==='tool').length,1);
    assert.match(view.at(-1).text,/Application verified/);assert.equal(assetReleases,0,'Physical handoff preserves logical asset use');
    send({type:'dispose'});await until(()=>posts.some(row=>row.type==='disposed'));assert.equal(assetReleases,1);
  } finally {
    await next?.close();globalThis.onmessage=prior;vi.unstubAllGlobals();vi.doUnmock('./lib/assistant/engine.ts');vi.doUnmock('./lib/assistant/compatibility.ts');vi.doUnmock('./lib/assistant/model-storage/runtime.ts');
  }
});

async function speechWorkerCase(cancelPreparation, pcmError = false) {
  const {vi}=await import('vitest'),env=environment(),posts=[],events=[],forward=deferred();let modelId=0,vadCalls=0;
  const device={queue:{async onSubmittedWorkDone(){events.push('gpu-drain');}},destroy(){events.push('gpu-destroy');}};
  const ort={env:{wasm:{},webgpu:{device}},InferenceSession:{async create(){return{async release(){events.push('bootstrap-release');}};}}};
  vi.doMock('onnxruntime-web',()=>ort);
  vi.doMock('parakeet.js',()=>({fromUrls:async()=>{const id=++modelId;events.push('speech-load:'+id);return {
    resetMelCache(){},clearIncrementalCache(){},encoderSession:{async release(){events.push('encoder-release');}},joinerSession:{async release(){events.push('decoder-release');}},
    async transcribe(){events.push('forward');await forward.promise;return{utterance_text:'The archived transcript.',words:[]};},
  };}}));
  vi.doMock('./lib/speech/assets.js',()=>({runtimeFiles:async()=>({}),modelFiles:async()=>({decoderUrl:'blob:decoder',release(){}}),verifyBlob:async()=>{}}));
  vi.doMock('./lib/speech/ten-vad.js',()=>({TenVad:{async create(){return{close(){events.push('vad-close');},reset(){},process(){vadCalls++;if(pcmError&&vadCalls>1)throw Error('late VAD failure');return[{start:0,end:1,speech:true,probability:1}];}};}}}));
  vi.doMock('./lib/speech/live-features.js',()=>({LiveFeatures:class{async compute(){return{};}close(){}}}));
  const prior=globalThis.onmessage;
  vi.stubGlobal('self',globalThis);vi.stubGlobal('navigator',{locks:env.locks,gpu:{async requestAdapter(){return{};}}});
  vi.stubGlobal('BroadcastChannel',class{constructor(){return env.channel();}});vi.stubGlobal('postMessage',data=>posts.push(data));
  vi.stubGlobal('fetch',async()=>({blob:async()=>new Blob([new Uint8Array([1])])}));
  let next;
  try {
    // Each scenario needs fresh worker module state, like an actual new Worker.
    vi.resetModules();await import('./lib/speech/inference.worker.js');
    const send=data=>globalThis.onmessage({data});
    send({type:'load',mode:'gpu-fp32'});await until(()=>posts.some(row=>row.type==='ready'));
    send(cancelPreparation||pcmError?{type:'streamPrepare',sessionId:'record'}:{type:'transcribe',sessionId:'record',pcm:new Float32Array(1600)});
    await until(()=>cancelPreparation||pcmError?posts.some(row=>row.type==='prepared'):events.includes('forward'));
    if(pcmError){send({type:'streamStart',sessionId:'record'});send({type:'streamChunk',sessionId:'record',pcm:new Float32Array(16000)});await until(()=>events.includes('forward'));}
    next=new BrowserRuntimeOwner({...env,id:'language',suspend:async()=>{}});const handed=next.run(async()=>events.push('language-load'));
    await new Promise(resolve=>setImmediate(resolve));assert.equal(events.includes('language-load'),false);
    if(cancelPreparation)send({type:'streamCancel',sessionId:'record'});
    else if(pcmError){
      send({type:'streamChunk',sessionId:'record',pcm:new Float32Array(1600)});await new Promise(resolve=>setImmediate(resolve));
      assert.equal(events.includes('encoder-release'),false);assert.equal(events.includes('language-load'),false);forward.resolve();
    } else {
      forward.resolve();await until(()=>posts.some(row=>row.type==='result'));assert.equal(posts.find(row=>row.type==='result').needsArchiveAck,true);
      assert.equal(events.includes('language-load'),false);assert.equal(events.includes('encoder-release'),false);
      send({type:'archive_done',sessionId:'record'});
    }
    await handed;await until(()=>posts.some(row=>row.type==='drained'));
    for(const event of ['encoder-release','decoder-release','gpu-drain','gpu-destroy'])assert.ok(events.indexOf(event)>=0&&events.indexOf(event)<events.indexOf('language-load'),event);
    assert.equal(events.filter(event=>event==='gpu-destroy').length,1);
    send({type:'dispose'});await until(()=>posts.some(row=>row.type==='disposed'));
  } finally {
    forward.resolve();
    if(globalThis.onmessage!==prior&&!posts.some(row=>row.type==='disposed')){globalThis.onmessage({data:{type:'dispose'}});await until(()=>posts.some(row=>row.type==='disposed'));}
    await next?.close();globalThis.onmessage=prior;vi.unstubAllGlobals();
    for(const name of ['onnxruntime-web','parakeet.js','./lib/speech/assets.js','./lib/speech/ten-vad.js','./lib/speech/live-features.js'])vi.doUnmock(name);
  }
}
Then('the speech worker retains its lease through final transcript storage acknowledgement',async()=>speechWorkerCase(false));
Then('canceled microphone preparation releases only its own runtime after cleanup',async()=>speechWorkerCase(true));
Then('local worker shutdown waits for disposal with a bounded fallback',async()=>{
  const {disposeWorker}=await import('./lib/assistant/worker-shutdown.js'),{vi}=await import('vitest');
  vi.useFakeTimers();
  try {
    const worker=new EventTarget();let terminated=0,command;
    worker.terminate=()=>{terminated++;};worker.postMessage=value=>{command=value;};
    const graceful=disposeWorker(worker,100);assert.deepEqual(command,{type:'dispose'});assert.equal(terminated,0);
    worker.dispatchEvent(new MessageEvent('message',{data:{type:'disposed'}}));assert.equal(await graceful,true);assert.equal(terminated,1);
    const forced=disposeWorker(worker,100);await vi.advanceTimersByTimeAsync(100);assert.equal(await forced,false);assert.equal(terminated,2);
  } finally {vi.useRealTimers();}
});
Then('final speech output waits for storage and a preparation failure can retry cleanly',async()=>{
  const {vi}=await import('vitest'),{SpeechController}=await import('./lib/speech/controller.js');
  const stored=deferred(),posted=[],updates=[],texts=[];
  vi.stubGlobal('localStorage',{getItem(){return null;},setItem(){}});
  const worker=new EventTarget();worker.terminate=()=>{};worker.postMessage=value=>posted.push(value);
  const controller=new SpeechController({state:value=>updates.push(value),text:value=>texts.push(value),recordings(){},dependencies:{
    worker:()=>worker,listRecordings:async()=>[],saveRecording:async()=>stored.promise,
  }});
  try {
    controller.load();controller.message({type:'ready',runtime:{backend:'controlled'}});controller.startRecord('file');
    controller.update({phase:'finalizing'});const sessionId=controller.record.id;
    controller.message({type:'result',sessionId,text:'Save this final transcript.',needsArchiveAck:true});
    assert.equal(controller.state.phase,'finalizing');assert.equal(texts.length,1);assert.equal(posted.some(row=>row.type==='archive_done'),false);
    stored.resolve();await controller.flushStorage();await until(()=>posted.some(row=>row.type==='archive_done'));
    assert.equal(controller.state.phase,'finalizing');controller.message({type:'drained',sessionId});assert.equal(controller.state.phase,'ready');
    worker.postMessage=()=>{throw Error('closed speech worker');};await controller.startRecording();
    assert.equal(controller.state.phase,'unloaded');assert.equal(controller.preparing,undefined);assert.match(controller.state.error,/closed speech worker/);
  } finally {stored.resolve();controller.unload(false);vi.unstubAllGlobals();}
});
Then('canceled speech inference drains before releasing ownership and emits no late transcript',async()=>{
  const {LiveDecoder}=await import('./lib/speech/live-decoder.js'),native=deferred(),events=[];
  const decoder=new LiveDecoder({infer:async()=>{events.push('forward');return native.promise;},detect:()=>[],update:()=>events.push('late-text'),finish:()=>events.push('late-final'),error:error=>{throw error;}});
  decoder.count=16000;decoder.activity.processed=1;decoder.activity.segments=[{start:0,speechEnd:1,closed:false}];
  const work=decoder.pump();assert.deepEqual(events,['forward']);let cancelled=false;
  const stop=decoder.cancel().then(()=>{cancelled=true;});await Promise.resolve();assert.equal(cancelled,false);
  native.resolve({words:[{word:'late',start:0,end:.5}]});await Promise.all([work,stop]);
  assert.equal(cancelled,true);assert.equal(decoder.running,false);assert.deepEqual(events,['forward']);
});

Then('late speech packet failures drain before native session disposal',async()=>speechWorkerCase(false,true));
Then('unconfirmed image worker cleanup leaves text paused until explicit recovery',async()=>{
  const {createVisionEngine}=await import('./public/assistant-runtime/vision-engine.js');
  const {createVisionTool}=await import('./lib/assistant/vision-tool.js');
  const {default:profile}=await import('./lib/assistant/vision-profile.json');
  let terminated=0,resumed=0;
  const worker={terminate(){terminated++;},postMessage(message){queueMicrotask(()=>{
    if(message.type==='load')worker.onmessage({data:{id:message.id,type:'result',result:{device:'controlled'}}});
    else if(message.type==='generate')worker.onerror({message:'Synthetic image worker crash',preventDefault(){}});
  });}};
  const engine=await createVisionEngine(profile,{createWorker:()=>worker});
  const tool=createVisionTool({profile,assetBase:'https://example.com/assistant-runtime/',getImage:()=>({data:'AA==',mimeType:'image/png',width:1,height:1}),
    suspendText:async()=>{},resumeText:async()=>{resumed++;},loadVision:async()=>engine});
  await assert.rejects(tool.tool.execute('call',{image_id:'local',question:'Describe this local image.'},new AbortController().signal),/cleanup is unconfirmed/);
  assert.equal(resumed,0);assert.equal(tool.state.cleanup_failed,true);assert.equal(tool.state.text_ready,false);assert.ok(terminated>0);
});
