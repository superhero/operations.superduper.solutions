// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Adapted from llm-sds-01; continuous-sources.json preserves source provenance.
import {LiveFeatures} from '../live-features.js';
import {SegmentSession} from './segment-session.js';
import {createSegmentStore} from './segment-store.js';
import {createTranscriptMerger} from './transcript-merger.js';
import {acquireRecordingUse} from './recordings.js';

const RATE=16000;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return{promise,resolve,reject};};
const joinText=(a,b)=>[a,b].filter(Boolean).join(' ').replace(/\s+([,.!?;:])/g,'$1').trim();
export function createLongSpeech({config,onState=()=>{},onTranscript=()=>{},onEvent=()=>{},createWorker=url=>new Worker(url,{type:'module'}),createStore=createSegmentStore,onArchived=async()=>{},onCancelled=async()=>{},acquireRecording=acquireRecordingUse}){
 let failing,cancelling,operationGeneration=0,needsFreshWorker=false,worker,epoch=0,requestId=0,current,lastSession,store,ready=false,loading=false,lastResult=null,lastError=null;
 const pending=new Map(),endTimers=new Map(),contexts=new Set(),tracks=new Set();
 const events=[];
 const getStore=()=>{store ||= createStore({name:'operations-speech-segments-v1'});return store;};
 const event=(type,data={})=>{const item={type,at:performance.now(),...data};events.push(item);if(events.length>500)events.shift();onEvent(item);};
 const snapshot=()=>({ready,loading,recording:!!current?.accepting,finishing:!!current?.stopping,recordingId:current?.id||lastResult?.recordingId||lastSession?.id||null,workerAlive:!!worker,pendingRequests:pending.size,audioContexts:contexts.size,liveTracks:[...tracks].filter(t=>t.readyState==='live').length,lastError,needsFreshWorker,session:current?.coordinator?.snapshot()||lastSession?.coordinator?.snapshot()||null,transcript:current?.merger.getState()||lastSession?.merger.getState()||null,partialCount:current?.partialCount||lastSession?.partialCount||0,completed:lastResult?.completedSegments||0});
 const emit=()=>onState(snapshot());
 function terminate(reason){epoch++;worker?.terminate();worker=null;ready=false;loading=false;for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error(reason));}pending.clear();for(const timer of endTimers.values())clearTimeout(timer);endTimers.clear();}
 function rpc(data,transfer=[],timeout=120000){
  if(!worker)return Promise.reject(Error('Load the speech model first'));
  const id=++requestId;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(data.type+' timed out'));},timeout);pending.set(id,{resolve,reject,timer});worker.postMessage({...data,requestId:id},transfer);});
 }
 async function closeMic(session){
  session?.source?.disconnect();session?.node?.disconnect();
  for(const track of session?.stream?.getTracks()||[]){track.stop();tracks.delete(track);}
  if(session?.context){const context=session.context;session.context=null;await context.close().catch(()=>{});contexts.delete(context);}
 }
 function drainProgress(session){
  clearTimeout(session.drainTimer);
  if(session.stopping&&current===session)session.drainTimer=setTimeout(()=>fail(Error('Queued recognition made no progress for180seconds; recorded segments remain available')),180000);
 }
 function fail(error,expectedSession=current,expectedWorker=worker){
  if(failing)return failing;
  if(current!==expectedSession||worker!==expectedWorker||(!expectedSession&&!expectedWorker))return Promise.resolve();
  const task=(async()=>{
   lastError=error.message||String(error);event('failure',{message:lastError});
   const session=current;current=null;clearTimeout(session?.drainTimer);session?.flush?.reject(error);
   const cleanup=session?.coordinator.cancel();cleanup?.catch(()=>{});terminate(lastError);const closedEpoch=epoch;
   await closeMic(session);await cleanup?.catch(()=>{});await session?.releaseRecording?.();
   if(epoch===closedEpoch&&!worker)emit();
  })();failing=task;void task.finally(()=>{if(failing===task)failing=undefined;}).catch(()=>{});return task;
 }
 const transcriptText=session=>joinText(session.fragments.join(''),session.draftText);
 function acceptTranscript(session,data){
  if(current!==session)return;
  const segment=data.segment;
  let delta;try{delta=session.merger.update({segmentId:segment.sessionId,audioStartSample:segment.audioStartSample,
    decodedThroughSeconds:data.decodedThroughSeconds??data.seconds??((segment.endSample-segment.audioStartSample)/RATE),
    reason:data.type==='result'?segment.reason:'partial',naturalPause:!!data.naturalPause,words:data.words||[]});}
  catch(error){fail(error);return;}
  drainProgress(session);
  if(delta.stableDelta.text)session.fragments.push(delta.stableDelta.text);
  session.draftText=delta.draftText;session.partialCount++;
  if(!session.firstPartialAt&&(delta.draftText||delta.stableDelta.text))session.firstPartialAt=performance.now();
  try{onTranscript({...delta,segment,recordingId:session.id,final:false});}catch(error){void fail(error,session);return;}
  event(data.type==='result'?'segmentFinal':'partial',{segmentId:segment.sessionId,segmentIndex:segment.index,
    capturedSamples:session.coordinator.snapshot().capturedSamples,stableSequence:delta.stableDelta.sequence,
    stableWordsAdded:delta.stableDelta.words.length,draftWords:delta.draftText?delta.draftText.split(/\s+/).length:0,
    ...(data.type==='result'?{resources:data.resources}:{}),featureOwners:session.coordinator.snapshot().featureOwners});
  emit();
 }
 function spawn(){
  const activeEpoch=epoch;needsFreshWorker=false;worker=createWorker(config.workerURL);
  worker.onmessage=({data})=>{
   if(activeEpoch!==epoch)return;
   if(data.type==='result'||data.type==='error'){clearTimeout(endTimers.get(data.sessionId));endTimers.delete(data.sessionId);}
   if(data.type==='suspended'){needsFreshWorker=true;event('suspended',data);emit();return;}
   if(['partial','result','error'].includes(data.type)&&data.sessionId&&!data.requestId){current?.coordinator?.onMessage(data);if(data.type==='error')return;}
   const request=pending.get(data.requestId);
   if(request){pending.delete(data.requestId);clearTimeout(request.timer);data.type==='error'?request.reject(Object.assign(Error(data.message),{code:data.code})):request.resolve(data);}
   else if(data.type==='error')fail(Error(data.message));
   if(data.type==='stage')event('stage',{text:data.text});
   if(data.type==='inferenceStart')event('inferenceStart',{segmentId:data.sessionId,start:data.start,end:data.end});
  };
  worker.onerror=error=>{if(activeEpoch===epoch)void fail(Error(error.message||'Speech worker failed'));};
  worker.onmessageerror=()=>{if(activeEpoch===epoch)void fail(Error('Speech worker returned unreadable data'));};
 }
 async function load(){
  const disposing=(worker||cancelling||failing)?unload():undefined,requestGeneration=++operationGeneration;await disposing;
  if(requestGeneration!==operationGeneration)throw Object.assign(Error('Speech loading was cancelled'),{name:'AbortError'});
  lastError=null;loading=true;emit();spawn();const loadingEpoch=epoch;
  try{const result=await rpc({type:'load',assets:config.assets,ortPaths:config.ortPaths,vad:config.vad,vadAssets:config.vadAssets},[],120000);if(loadingEpoch!==epoch||requestGeneration!==operationGeneration)throw Object.assign(Error('Speech loading was replaced'),{name:'AbortError'});ready=true;loading=false;event('modelReady',{runtime:result.runtime,resources:result.resources});emit();return result;}
  catch(error){if(loadingEpoch===epoch&&requestGeneration===operationGeneration)await fail(error);throw error;}
 }
 async function begin({recordingId=crypto.randomUUID(),segmentSeconds=config.segmentSeconds||20,overlapSeconds=config.overlapSeconds||2,injected=false}={}){
  if(!ready||!worker)throw Error('Load the speech model first');if(current)throw Error('Finish or cancel the current recording first');
  const beforeStore=epoch,requestGeneration=operationGeneration;store=getStore();await store.list(recordingId);
  if(beforeStore!==epoch||requestGeneration!==operationGeneration||!ready||!worker)throw Object.assign(Error('Recording preparation was cancelled'),{name:'AbortError'});
  const session={id:recordingId,fragments:[],draftText:'',merger:createTranscriptMerger({overlapSeconds}),partialCount:0,startedAt:performance.now(),injected,accepting:true};
  const transport={
   start:({sessionId,featurePort})=>rpc({type:'streamStart',sessionId,featurePort},[featurePort],30000),
   chunk:({sessionId,pcm})=>{if(!worker)throw Error('Speech worker is unavailable');worker.postMessage({type:'streamChunk',sessionId,pcm},[pcm.buffer]);},
   end:({sessionId,pcm,reason})=>{if(!worker)throw Error('Speech worker is unavailable');endTimers.set(sessionId,setTimeout(()=>fail(Error('Recognition segment stalled for180seconds')),180000));worker.postMessage({type:'streamEnd',sessionId,pcm,reason},[pcm.buffer]);}
  };
  session.coordinator=new SegmentSession({transport,featuresFactory:()=>new LiveFeatures(128,null,()=>createWorker(config.featuresURL)),store,recordingId,
   segmentSeconds,overlapSeconds,onTranscript:data=>acceptTranscript(session,data),
   onProgress:progress=>{if(current!==session)return;event('queue',{...progress});emit();},onError:error=>{if(current===session)fail(error);}});
  current=lastSession=session;lastResult=null;lastError=null;
  try{session.releaseRecording=await acquireRecording(session.id);if(current!==session){await session.releaseRecording();throw Object.assign(Error('Recording cancelled'),{name:'AbortError'});}emit();
  const prepare=()=>rpc({type:'prepareCapture',sessionId:session.id},[],120000);let prepared;
  if(needsFreshWorker){terminate('Restoring speech after native handoff');spawn();needsFreshWorker=false;}
  try{prepared=await prepare();}catch(error){
   if(error.code!=='NeedsFreshSpeechWorker'||current!==session)throw error;
   terminate('Restoring speech after native handoff');spawn();needsFreshWorker=false;prepared=await prepare();
  }
  if(current!==session)throw Object.assign(Error('Recording cancelled'),{name:'AbortError'});
  ready=true;event('capturePrepared',{recordingId:session.id,runtime:prepared?.runtime});return session;
  }catch(error){if(current===session)await fail(error,session);else await session.releaseRecording?.();throw error;}
 }
 function pushPcm(pcm){
  if(!current?.accepting)throw Error('No active capture session');
  const session=current,work=session.coordinator.push(pcm);Promise.resolve(work).catch(error=>{if(current===session)fail(error);});return work;
 }
 async function startRecord(options={}){
  const session=await begin(options);
  try{
   session.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,sampleRate:RATE,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});
   if(current!==session){session.stream.getTracks().forEach(t=>t.stop());throw Error('Recording cancelled');}
   for(const track of session.stream.getTracks())tracks.add(track);
   session.context=new AudioContext({sampleRate:RATE});contexts.add(session.context);
   if(session.context.sampleRate!==RATE)throw Error('This device cannot capture16kHz audio');
   await session.context.audioWorklet.addModule(config.captureURL);await session.context.resume();
   if(current!==session)throw Error('Recording cancelled');
   session.node=new AudioWorkletNode(session.context,'pcm-capture');session.source=session.context.createMediaStreamSource(session.stream);
   session.node.port.onmessage=({data})=>{if(current!==session)return;if(data.type==='flushed'){session.flush?.resolve();return;}if(data.type==='pcm'){try{pushPcm(data.pcm);}catch(error){fail(error);}}};
   session.source.connect(session.node);session.node.connect(session.context.destination);
   event('captureStarted',{recordingId:session.id,rate:RATE,trackSettings:session.stream.getAudioTracks()[0].getSettings()});emit();return{recordingId:session.id};
  }catch(error){if(current===session)await fail(error);else await closeMic(session);throw error;}
 }
 async function finish(session){
  if(session.finishPromise)return session.finishPromise;
  session.finishPromise=(async()=>{
   try{
    drainProgress(session);const result=await session.coordinator.stop();clearTimeout(session.drainTimer);
    if(current!==session)throw Error('Recording cancelled');
    const delta=session.merger.finish();if(delta.stableDelta.text)session.fragments.push(delta.stableDelta.text);session.draftText=delta.draftText;
    const text=transcriptText(session);onTranscript({...delta,recordingId:session.id,final:true});
    const archived=await store.list();if(current!==session)throw Object.assign(Error('Recording cancelled'),{name:'AbortError'});const segments=archived.filter(item=>item.recordingId===session.id||String(item.id||item.sessionId).startsWith(session.id));
    lastResult={...result,recordingId:session.id,text,seconds:result.totalSamples/RATE,partialCount:session.partialCount,
     firstPartialMs:session.firstPartialAt?session.firstPartialAt-session.startedAt:null,session:session.coordinator.snapshot(),segments,
     resources:worker?(await rpc({type:'stats'})).resources:null};
    if(current!==session)throw Object.assign(Error('Recording cancelled'),{name:'AbortError'});
    await onArchived(lastResult);if(current!==session)throw Object.assign(Error('Recording cancelled'),{name:'AbortError'});
    await rpc({type:'finishCapture',sessionId:session.id},[],120000);if(current!==session)throw Object.assign(Error('Recording cancelled'),{name:'AbortError'});await session.releaseRecording?.();if(current!==session)throw Object.assign(Error('Recording cancelled'),{name:'AbortError'});
    current=null;event('recordingFinished',{recordingId:session.id,seconds:lastResult.seconds,segments:segments.length});emit();return lastResult;
   }catch(error){if(current===session)await fail(error);throw error;}
  })();return session.finishPromise;
 }
 async function stopRecord(){
  const session=current;if(!session)throw Error('No active recording');if(session.stop)return session.stop.promise;
  session.stop=deferred();session.stopping=true;emit();
  try{
   session.source?.disconnect();session.stream?.getTracks().forEach(t=>t.stop());
   if(session.node){session.flush=deferred();session.node.port.postMessage('flush');const timer=setTimeout(()=>session.flush.reject(Error('Final capture packet timed out')),3000);try{await session.flush.promise;}finally{clearTimeout(timer);}}
   session.accepting=false;await closeMic(session);emit();const result=await finish(session);session.stop.resolve(result);return result;
  }catch(error){session.stop.reject(error);if(current===session)await fail(error);throw error;}
 }
 async function startInjected(options={}){const session=await begin({...options,injected:true});event('injectedCaptureStarted',{recordingId:session.id});return{recordingId:session.id};}
 async function finishInjected(){const session=current;if(!session)throw Error('No injected capture');session.stopping=true;session.accepting=false;return finish(session);}
 function cancel(){
  operationGeneration++;ready=false;loading=false;if(failing)return failing;if(cancelling)return cancelling;
  const task=(async()=>{
   const session=current;current=null;clearTimeout(session?.drainTimer);session?.flush?.reject(Error('Recording cancelled'));
   const cleanup=session?.coordinator.cancel();cleanup?.catch(error=>{lastError=error.message;emit();});await closeMic(session);
   try{await cleanup;if(session)await onCancelled({recordingId:session.id});if(worker)await rpc({type:'unload'},[],10000);}
   finally{terminate('Speech capture cancelled; reload before retrying');await session?.releaseRecording?.();}
   event('cancelled',{recordingId:session?.id});emit();return snapshot();
  })();cancelling=task;void task.finally(()=>{if(cancelling===task)cancelling=undefined;}).catch(()=>{});return task;
 }
 async function unload(){operationGeneration++;ready=false;loading=false;if(failing)return failing;if(cancelling)return cancelling;if(current)return cancel();let result;try{if(worker)result=(await rpc({type:'unload'},[],10000)).resources;}finally{terminate('Speech unloaded');}event('unloaded',{resources:result});emit();return result;}
 async function listSegments(){return getStore().list();}
 async function getSegment(id){return getStore().get(id);}
 return{load,startRecord,stopRecord,startInjected,pushPcm,finishInjected,cancel,unload,snapshot,listSegments,getSegment,
  getTranscript:()=>current?transcriptText(current):lastResult?.text||(lastSession?transcriptText(lastSession):''),getResult:()=>lastResult,getEvents:()=>events.slice(),getRecoveryAudio:()=>lastSession?.coordinator.retainedAudio()||[],
  stats:()=>worker?rpc({type:'stats'}).then(x=>x.resources):Promise.resolve({unloaded:true})};
}
