// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// NR model and OO segment protocol; provenance is in continuous-sources.json.
import {createNqSpeech} from '../nq/nr/engine.js';
import {LiveDecoder} from '../live-decoder.js';
import {LiveFeatures} from '../live-features.js';
import {TenVad} from '../ten-vad.js';
import {runtimeFiles,verifyBlob} from '../assets.js';
import {BrowserRuntimeOwner} from '../../assistant/runtime-ownership.js';
import {prepareModelAssets,modelAssetFetch} from '../../assistant/model-storage/runtime.ts';
import {probeAssistantCompatibility} from '../../assistant/compatibility.ts';
import {defaultAssistantSettings} from '../../assistant/config.ts';
import {artifactsFor,profileById} from '../../assistant/model-storage/catalog.ts';
const MODEL='speech:parakeet-continuous',network=globalThis.fetch.bind(globalThis);
const send=(type,data={})=>postMessage({type,...data});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
let engine,vad,live,features,streamId,generation=0,endingReason=null,loadedOnce=false,nativeLoading=false,loadController,lastDisposed;
let messages=Promise.resolve(),releaseAssets,urls=[],captureTask,captureEnd,captureController,captureId;
const resources=()=>engine?.stats()??lastDisposed??{disposed:true};
const owner=new BrowserRuntimeOwner({suspend:async()=>{
  await live?.cancel();
  if(nativeLoading)throw Error('Speech initialization cleanup is unconfirmed; terminate this worker.');
  if(engine){lastDisposed=await engine.dispose();engine=undefined;vad?.close();vad=undefined;features?.close();features=undefined;
    for(const url of urls)URL.revokeObjectURL(url);urls=[];send('suspended',{recreate:true});}
},status:text=>send('stage',{text}),onError:error=>send('error',{message:error.message||String(error)})});
async function loadModel(signal){
  if(engine)return;
  if(loadedOnce)throw Object.assign(Error('Restore speech in a fresh worker after a runtime handoff.'),{code:'NeedsFreshSpeechWorker'});
  signal?.throwIfAborted();
  const capabilities=await probeAssistantCompatibility(self,{...defaultAssistantSettings,model:'2b'});
  if(!self.crossOriginIsolated||!capabilities.fp32)throw Error('Continuous speech requires an isolated page with working FP32 WebGPU. No CPU model was substituted.');
  releaseAssets??=await prepareModelAssets(MODEL,signal??new AbortController().signal,value=>send('stage',{text:value.message}),network);
  const read=modelAssetFetch(MODEL,network),assets={};
  const paths=await runtimeFiles(value=>send('stage',{text:value.text||'Restoring verified speech runtime…'}));urls.push(paths.mjs,paths.wasm);
  for(const file of artifactsFor(profileById(MODEL))){
    signal?.throwIfAborted();const response=await read(file.url,{signal});if(!response.ok)throw Error('Installed speech file is unavailable: '+file.id);
    const url=URL.createObjectURL(await response.blob());urls.push(url);assets[file.id]=url;
  }
  signal?.throwIfAborted();nativeLoading=true;
  engine=await createNqSpeech({assets:{encoder:assets['encoder-model.onnx'],externalData:assets['encoder-model.onnx.data'],
    decoder:assets['decoder-single-step.int8-fp32.onnx'],vocab:assets['vocab.txt']},ortPaths:paths,stage:text=>send('stage',{text})});
  nativeLoading=false;
  const blob=await(await network(new URL('../vendor/ten-vad/ten_vad.wasm',import.meta.url))).blob();
  await verifyBlob(blob,{file:'TEN-VAD',bytes:blob.size,sha256:'1ec0b9640683987e15a4e54e4ce5642b2447c6e5d82b1be889b5099c75434fc3'});
  vad=await TenVad.create(new Uint8Array(await blob.arrayBuffer()));
  await engine.transcribe(new Float32Array(16000),16000,{returnTimestamps:true});signal?.throwIfAborted();loadedOnce=true;
}
async function cancelCapture(){
  loadController?.abort(new DOMException('Speech loading cancelled.','AbortError'));
  captureController?.abort(new DOMException('Speech capture cancelled.','AbortError'));
  await live?.cancel();features?.close();captureEnd?.resolve();await captureTask?.catch(()=>{});
}
self.onmessage=({data})=>{
  if(data.type==='cancelCapture'){void cancelCapture();return;}
  if(data.type==='dispose'||data.type==='unload'){
    void(async()=>{await cancelCapture();await messages.catch(()=>{});await owner.close();await releaseAssets?.();releaseAssets=undefined;
      send(data.type==='dispose'?'disposed':'unloaded',{requestId:data.requestId,resources:resources()});})()
      .catch(error=>send('error',{requestId:data.requestId,message:error.message||String(error)}));return;
  }
  messages=messages.then(()=>handle(data)).catch(error=>send('error',{requestId:data.requestId,sessionId:data.sessionId,
    message:error.message||String(error),code:error.code}));
};
async function handle(data){
  if(data.type==='load'){
    loadController=new AbortController();await owner.run(()=>loadModel(loadController.signal),{signal:loadController.signal,resident:true});send('ready',{requestId:data.requestId,runtime:runtime(),resources:resources()});
  }else if(data.type==='prepareCapture'){
    if(captureTask)throw Error('Finish the previous recording before starting another.');
    const activeId=captureId=data.sessionId,activeController=captureController=new AbortController(),activeEnd=captureEnd=deferred();
    const task=owner.run(async()=>{await loadModel(activeController.signal);send('prepared',{requestId:data.requestId,sessionId:activeId,runtime:runtime()});await activeEnd.promise;},
      {signal:activeController.signal,resident:true});
    captureTask=task;
    void task.catch(error=>send('error',{requestId:data.requestId,sessionId:activeId,message:error.message||String(error),code:error.code})).finally(()=>{if(captureTask===task)captureTask=undefined;});
  }else if(data.type==='finishCapture'){
    if(data.sessionId!==captureId)throw Error('The capture archive belongs to another recording.');
    captureEnd?.resolve();await captureTask;captureTask=undefined;send('drained',{requestId:data.requestId,resources:resources()});
  }else if(data.type==='streamStart'){
    if(!engine||!captureTask)throw Error('Prepare the speech runtime before microphone capture.');
    if(live&&!live.ended)throw Error('The previous recognition segment has not finished.');
    const epoch=++generation;streamId=data.sessionId;endingReason=null;engine.reset();vad.reset();features?.close();
    const segmentFeatures=features=new LiveFeatures(128,data.featurePort),current=()=>epoch===generation&&streamId===data.sessionId;
    live=new LiveDecoder({maxContextSeconds:30,detect:pcm=>vad.process(pcm),infer:async(pcm,timeOffset)=>{
      const start=Math.round(timeOffset*16000),prepared=await segmentFeatures.compute(start,start+pcm.length);
      send('inferenceStart',{sessionId:data.sessionId,start,end:start+pcm.length,featureFrames:prepared.T});
      return engine.transcribe(pcm,16000,{returnTimestamps:true,timeOffset,precomputedFeatures:prepared});
    },update:result=>{if(current()){const snapshot=live.merger.snapshot();send('partial',{sessionId:data.sessionId,...result,
      words:[...snapshot.stable,...snapshot.draft],naturalPause:!!result.paused&&!endingReason});}},
    finish:async result=>{segmentFeatures.close();if(current())send('result',{sessionId:data.sessionId,...result,endReason:endingReason,resources:resources()});},
    error:error=>{segmentFeatures.close();if(current())send('error',{sessionId:data.sessionId,message:error.message||String(error)});}});
    send('streamStarted',{requestId:data.requestId,sessionId:data.sessionId});
  }else if(data.type==='streamChunk'){if(data.sessionId===streamId)live?.push(data.pcm);
  }else if(data.type==='streamEnd'){if(data.sessionId===streamId){endingReason=data.reason||'rotation';live?.end(data.pcm);}
  }else if(data.type==='stats')send('stats',{requestId:data.requestId,resources:resources()});
  else throw Error('Unknown continuous speech command.');
}
function runtime(){return{...engine?.runtime,coreSegmentSeconds:20,overlapSeconds:2,modelContextSeconds:30,
  modelId:MODEL,vad:'TEN CPU/Wasm',cpuFeatureAndTextWork:true};}
