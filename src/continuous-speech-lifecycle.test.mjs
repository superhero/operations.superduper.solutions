// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import {Then} from '@cucumber/cucumber';
import {vi} from 'vitest';
import {createLongSpeech} from './lib/speech/continuous/capture.js';
import {ContinuousSpeechController} from './lib/speech/continuous-controller.js';
import {SpeechController} from './lib/speech/controller.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
Then('a continuous load failure leaves the previous legacy audio untouched',async()=>{
  const audio=new Blob([new Uint8Array([1,2,3,4])]),record={id:'legacy',status:'complete',audio,metadata:{source:'microphone'}},saved=[];
  const p={record,state:{phase:'unloaded',seconds:5},recoverySources:new Set(),writing:Promise.resolve(),
    dependencies:{assetBase:'https://example.com/',acquireModelUse:async()=>async()=>{},saveRecording:async row=>saved.push(row),
      createContinuous:options=>({async load(){options.onState({lastError:'Native initialization failed'});throw Error('Native initialization failed');},
        async unload(){},getRecoveryAudio:()=>[],snapshot:()=>({workerAlive:false})})},
    update(patch){Object.assign(this.state,patch);},async refreshRecordings(){throw Error('A previous recording must not be rewritten');}};
  const controller=new ContinuousSpeechController(p);await assert.rejects(controller.load(),/Native initialization failed/);await controller.disposal;await p.writing;
  assert.deepEqual(saved,[]);assert.equal(p.record,record);assert.equal(record.status,'complete');assert.equal(record.audio,audio);
  assert.deepEqual([...new Uint8Array(await record.audio.arrayBuffer())],[1,2,3,4]);
});
function captureHarness(options={}){
  const records=new Map(),commands=[],workers=[],recordingLocks=[];
  const store={async list(id){return[...records.values()].filter(row=>!id||row.recordingId===id).map(({pcm,...metadata})=>metadata);},
    async put(row){records.set(row.sessionId,structuredClone(row));},async get(id){return structuredClone(records.get(id));},async update(id,patch){Object.assign(records.get(id),patch);}};
  const capture=createLongSpeech({config:{workerURL:'inference',featuresURL:'features',captureURL:'capture'},createStore:()=>store,
    acquireRecording:async id=>{const lock={id,released:false};recordingLocks.push(lock);return async()=>{lock.released=true;};},
    createWorker(url){
      const ports=[],worker={terminated:false,terminate(){worker.terminated=true;for(const port of ports)port.close();},postMessage(data){
        if(url==='features'){if(data.type==='connect')ports.push(data.port);return;}
        commands.push(data);const emit=value=>queueMicrotask(()=>worker.onmessage?.({data:value}));
        if(data.type==='load')emit({type:'ready',requestId:data.requestId,runtime:{unit_fixture:true}});
        if(data.type==='prepareCapture')emit(options.prepareError?{type:'error',requestId:data.requestId,sessionId:data.sessionId,message:options.prepareError}:
          {type:'prepared',requestId:data.requestId,sessionId:data.sessionId});
        if(data.type==='streamStart')emit({type:'streamStarted',requestId:data.requestId,sessionId:data.sessionId});
        if(data.type==='streamEnd')emit({type:'result',sessionId:data.sessionId,text:'hello',words:[{text:'hello',start_time:.1,end_time:.2}],seconds:data.pcm.length/16000});
        if(data.type==='stats')emit({type:'stats',requestId:data.requestId,resources:{unit_fixture:true}});
        if(data.type==='finishCapture')emit({type:'drained',requestId:data.requestId});
        if(data.type==='unload')emit({type:'unloaded',requestId:data.requestId,resources:{disposed:true}});
      }};
      if(url==='inference')workers.push(worker);return worker;
    },...options});
  return{capture,commands,workers,recordingLocks,records};
}
Then('continuous capture waits for the complete archive before releasing its recording',async()=>{
  const archive=deferred(),entered=deferred(),h=captureHarness({onArchived:async()=>{entered.resolve();await archive.promise;}});
  await h.capture.load();await h.capture.startInjected({recordingId:'archive-gate'});await h.capture.pushPcm(new Float32Array(16000));
  const done=h.capture.finishInjected();await entered.promise;
  assert.equal(h.commands.some(data=>data.type==='finishCapture'),false);assert.equal(h.recordingLocks[0].released,false);
  archive.resolve();const result=await done;assert.equal(result.text,'hello');assert.equal(result.totalSamples,16000);
  assert.equal(h.commands.filter(data=>data.type==='finishCapture').length,1);assert.equal(h.recordingLocks[0].released,true);
  assert.equal(h.records.size,1);await h.capture.unload();assert.equal(h.workers[0].terminated,true);
});
Then('continuous dictation preserves its stable sequence and waits for the main recording save',async()=>{
  let callbacks;const gate=deferred(),texts=[],p={state:{phase:'unloaded'},preferences:{},recoverySources:new Set(),writing:Promise.resolve(),
    dependencies:{assetBase:'https://example.com/',acquireModelUse:async()=>async()=>{},saveRecording:async()=>gate.promise,createContinuous:options=>{callbacks=options;return{
      async load(){return{runtime:{unit_fixture:true}};},snapshot:()=>({ready:true}),async startRecord(){options.onEvent({type:'captureStarted'});},
      async stopRecord(){options.onTranscript({recordingId:'record',stableDelta:{sequence:2,text:''},draftText:'',final:true});
        await options.onArchived({recordingId:'record',text:'Hello world',seconds:2});return{text:'Hello world'};}};}},
    update(patch){Object.assign(this.state,patch);},timeout(){},preferencesChanged(){},async refreshRecordings(){},text(value){texts.push(value.confirmed);},
    startRecord(){this.record={id:'record',metadata:{continuous:true,source:'microphone'},partials:[],events:[]};return'record';}};
  const controller=new ContinuousSpeechController(p);await controller.load();await controller.start();
  for(const data of [{stableDelta:{sequence:1,text:'Hello'},draftText:'draft'},
    {stableDelta:{sequence:1,text:'Hello'},draftText:'changed'},
    {stableDelta:{sequence:2,text:' world'},draftText:''}])callbacks.onTranscript({recordingId:'record',...data});
  assert.deepEqual(texts,['Hello','Hello world']);const stopped=controller.stop();await tick();assert.equal(p.state.phase,'finalizing');
  gate.resolve();await stopped;assert.equal(p.state.phase,'ready');assert.deepEqual(texts,['Hello','Hello world']);
  assert.equal(p.record.final.text,'Hello world');
});
Then('late continuous microphone failures leave the new speech worker alive',async()=>{
  const old=deferred(),replacement=deferred();let calls=0;
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>++calls===1?old.promise:replacement.promise}});
  const h=captureHarness();try{
    await h.capture.load();const first=h.capture.startRecord({recordingId:'old'});first.catch(()=>{});await tick();assert.equal(calls,1);
    await h.capture.cancel();await h.capture.load();const second=h.capture.startRecord({recordingId:'new'});second.catch(()=>{});await tick();assert.equal(calls,2);
    old.reject(Error('Old microphone denial'));await assert.rejects(first,/Old microphone denial/);assert.equal(h.workers[1].terminated,false);
    assert.equal(h.capture.snapshot().recordingId,'new');await h.capture.cancel();replacement.reject(Error('New request cancelled'));await second.catch(()=>{});
    assert.ok(h.recordingLocks.every(lock=>lock.released));
  }finally{await h.capture.unload();vi.unstubAllGlobals();}
});
Then('failed continuous preparation releases its recording claim before retry',async()=>{
  const options={prepareError:'Native preparation failed'},h=captureHarness(options);await h.capture.load();
  await assert.rejects(h.capture.startInjected({recordingId:'failed'}),/Native preparation failed/);
  assert.equal(h.capture.snapshot().workerAlive,false);assert.equal(h.recordingLocks[0].released,true);
  options.prepareError=null;await h.capture.load();await h.capture.startInjected({recordingId:'replacement'});
  assert.equal(h.capture.snapshot().recordingId,'replacement');assert.equal(h.capture.snapshot().ready,true);
  await h.capture.finishInjected();await h.capture.unload();
});
Then('a cancelled archive lookup cannot create a recording on a replacement worker',async()=>{
  const lookup=deferred(),h=captureHarness({createStore:()=>({async list(id){if(id==='old-lookup')await lookup.promise;return[];}})});
  await h.capture.load();const first=h.capture.startInjected({recordingId:'old-lookup'});first.catch(()=>{});await tick();
  await h.capture.unload();await h.capture.load();lookup.resolve();await assert.rejects(first,/cancelled/);
  assert.equal(h.recordingLocks.length,0);assert.equal(h.workers[1].terminated,false);assert.equal(h.capture.snapshot().ready,true);
  await h.capture.unload();
});
Then('continuous failure cleanup is coalesced and retains a late failed PCM tail',async()=>{
  const write=deferred(),h=captureHarness({createStore:()=>({async list(){return[];},async put(){await write.promise;throw Error('Storage quota exceeded');}})});
  await h.capture.load();await h.capture.startInjected({recordingId:'recover-tail'});await h.capture.pushPcm(new Float32Array(16000));await tick();
  const id=h.capture.snapshot().session.activeId;h.workers[0].onmessage({data:{type:'error',sessionId:id,message:'Native segment failed'}});await tick();
  let settled=false;const unloading=h.capture.unload().then(()=>{settled=true;});await tick();assert.equal(settled,false);
  write.resolve();await unloading;assert.equal(h.capture.getEvents().filter(event=>event.type==='failure').length,1);
  const retained=h.capture.getRecoveryAudio();assert.equal(retained.length,1);assert.equal(retained[0].pcm.length,16000);
  assert.equal(h.recordingLocks[0].released,true);
});
Then('an old continuous Stop cannot change replacement state',async()=>{
  const done=deferred(),record={id:'old',metadata:{}},p={record,state:{phase:'recording'},recoverySources:new Set(),update(patch){Object.assign(this.state,patch);}};
  const controller=new ContinuousSpeechController(p);controller.record=record;
  controller.long={stopRecord:()=>done.promise,async unload(){},getRecoveryAudio:()=>[],snapshot:()=>({workerAlive:false})};
  const stopped=controller.stop();await controller.unload();p.record={id:'replacement'};p.update({phase:'recording',status:'New recording'});
  done.resolve({text:'Old transcript'});await stopped;assert.equal(p.state.phase,'recording');assert.equal(p.state.status,'New recording');
});
Then('a continuous stable sequence gap stops explicitly with recovery retained',async()=>{
  const record={id:'gap',status:'recording'},texts=[],p={record,state:{phase:'recording'},recoverySources:new Set(),update(patch){Object.assign(this.state,patch);},text(value){texts.push(value);}};
  const controller=new ContinuousSpeechController(p);controller.record=record;controller.sequence=0;controller.confirmed='';
  controller.long={async unload(){},getRecoveryAudio:()=>[{recordingId:'gap',pcm:new Float32Array(1)}],snapshot:()=>({workerAlive:false})};p.recoverySources.add(controller.long);
  controller.transcript({recordingId:'gap',stableDelta:{sequence:2,text:'Skipped words'},draftText:''});
  await controller.disposal;assert.equal(p.state.phase,'unloaded');assert.match(p.state.error,/missed/);assert.equal(record.status,'error');
  assert.deepEqual(texts,[]);assert.equal(p.recoverySources.has(controller.long),true);
});

Then('a cancelled continuous module import cannot initialize speech later',async()=>{
  const loaded=deferred();let created=0;const controller=new SpeechController({state(){},text(){},recordings(){},
    dependencies:{listRecordings:async()=>[],loadContinuous:()=>loaded.promise}});
  controller.preferences.mode='gpu-continuous';controller.load();assert.equal(controller.state.phase,'downloading');controller.unload();
  loaded.resolve({ContinuousSpeechController:class{constructor(){created++;}async load(){}}});await tick();
  assert.equal(created,0);assert.equal(controller.state.phase,'unloaded');controller.destroy();
});
