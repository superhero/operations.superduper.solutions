// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Adapted reference regressions; continuous-sources.json records runtime provenance.
import{Given,When,Then}from'quickpickle';
import{expect}from'vitest';
import{SegmentSession}from'./lib/speech/continuous/segment-session.js';
const RATE=16000;let h,outcome,error,stopPromise;
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function harness(){
  const records=new Map(),starts=[],chunks=[],ends=[],transcripts=[],errors=[];let startBarrier,writeBarrier,failWrite=false,getCalls=0;
  const store={
    async put(record){if(writeBarrier)await writeBarrier.promise;if(failWrite)throw Object.assign(Error('Speech storage quota exceeded'),{name:'QuotaExceededError'});if(records.has(record.sessionId))throw Error('Duplicate archive');records.set(record.sessionId,structuredClone(record));},
    async get(id){getCalls++;return structuredClone(records.get(id));},
    async list(){return[...records.values()].map(({pcm,...metadata})=>structuredClone(metadata));},
    async update(id,metadata){Object.assign(records.get(id),structuredClone(metadata));}
  };
  const session=new SegmentSession({recordingId:'recording-test',sessionPrefix:'segment-test',store,
    featuresFactory:()=>({push(){},connect(){return{};},close(){}}),
    transport:{async start(message){starts.push(message.sessionId);if(startBarrier)await startBarrier.promise;},chunk(message){chunks.push({sessionId:message.sessionId,pcm:structuredClone(message.pcm,{transfer:[message.pcm.buffer]})});},end(message){ends.push({...message,pcm:structuredClone(message.pcm,{transfer:[message.pcm.buffer]})});}},
    onTranscript:value=>transcripts.push(value),onError:value=>errors.push(value)});
  return{session,store,records,starts,chunks,ends,transcripts,errors,getCalls:()=>getCalls,holdStart:()=>startBarrier=deferred(),holdWrite:()=>writeBarrier=deferred(),releaseWrite:()=>{const gate=writeBarrier;writeBarrier=null;gate.resolve();},failWrite:()=>{failWrite=true;}};
}
async function feed(samples,irregular=false){
  let offset=h.session.snapshot().capturedSamples,index=0,remaining=samples;const sizes=irregular?[1,511,1607,7439,3999,128,8192]:[4000];
  while(remaining){const count=Math.min(remaining,sizes[index++%sizes.length]),pcm=Float32Array.from({length:count},(_,i)=>offset+i);await h.session.push(pcm);await tick();remaining-=count;offset+=count;}
}
async function finishActive(){
  await tick();const active=h.session.snapshot().activeId;
  expect(h.ends.some(end=>end.sessionId===active)).toBe(true);
  await h.session.onMessage({type:'result',sessionId:active,text:'recognized',words:[{text:'recognized',start_time:.1,end_time:.2}]});await tick();
}
async function drain(){
  const stopped=h.session.stop();await tick();
  for(let i=0;i<20&&h.session.snapshot().phase!=='stopped';i++)await finishActive();
  return stopped;
}
Given('a speech coordinator with a memory archive and a slow recognizer',()=>{h=harness();outcome=error=stopPromise=undefined;});
When('I capture {int} seconds without completing recognition',async(_,seconds)=>{await feed(seconds*RATE);});
Then('only the first segment has started and later audio is safely retained',()=>{const s=h.session.snapshot();expect(h.starts).toEqual(['segment-test-0']);expect(s.capturedSamples).toBe(41*RATE);expect(s.featureOwners).toBe(2);expect(s.queuedSegments).toBe(1);expect(h.records.size).toBe(2);expect(h.records.get('segment-test-1').pcm.length).toBe(22*RATE);});
When('I capture irregular packets for {int} seconds and {int} samples and drain',async(_,seconds,samples)=>{await feed(seconds*RATE+samples,true);outcome=await drain();});
Then('archived cores reconstruct every input sample exactly once',()=>{
  const rows=[...h.records.values()].sort((a,b)=>a.index-b.index);let cursor=0;
  for(const row of rows){expect(row.coreStartSample).toBe(cursor);expect(row.audioStartSample).toBe(Math.max(0,cursor-2*RATE));expect(row.pcm.length).toBe(row.endSample-row.audioStartSample);expect(row.pcm.length).toBeLessThanOrEqual(22*RATE);for(let i=0;i<row.pcm.length;i++)if(row.pcm[i]!==row.audioStartSample+i)throw Error('Lost/duplicated sample at'+i);cursor=row.endSample;expect(row.status).toBe('complete');expect(row.transcript.words).toHaveLength(1);}
  expect(cursor).toBe(65*RATE+123);expect(outcome.totalSamples).toBe(cursor);expect(h.session.snapshot().featureOwners).toBe(0);
});
Then('pending segment descriptors are durable and PCM memory stays bounded',()=>{const s=h.session.snapshot();expect(s.capturedSamples).toBe(95*RATE);expect(s.queuedSegments).toBe(3);expect(h.records.size).toBe(4);expect(s.featureOwners).toBe(2);expect(s.peakFeatureOwners).toBeLessThanOrEqual(2);expect(s.retainedPcmSamples).toBeLessThanOrEqual(44*RATE);expect(s.peakRetainedPcmSamples).toBeLessThanOrEqual(66*RATE);expect(h.session.queue.every(value=>!('pcm'in value)&&!('buffer'in value))).toBe(true);});
When('I send an out of order result then finish the first segment',async()=>{await h.session.onMessage({type:'result',sessionId:'segment-test-1',words:[]});expect(h.starts).toHaveLength(1);await finishActive();});
Then('the second segment starts from archived audio without skipping samples',()=>{expect(h.starts).toEqual(['segment-test-0','segment-test-1']);expect(h.getCalls()).toBe(1);expect(h.session.snapshot().staleIgnored).toBe(1);const replay=h.chunks.filter(chunk=>chunk.sessionId==='segment-test-1');expect(replay).toHaveLength(1);expect(replay[0].pcm.length).toBe(22*RATE);expect(replay[0].pcm[0]).toBe(18*RATE);expect(h.records.get('segment-test-0').pcm[0]).toBe(0);});
When('I capture exactly {int} seconds then stop and drain',async(_,seconds)=>{await feed(seconds*RATE);outcome=await drain();});
Then('exactly two segments finish with all features released',()=>{expect(outcome).toMatchObject({totalSamples:40*RATE,completedSegments:2});expect(h.records.size).toBe(2);expect(h.starts).toEqual(['segment-test-0','segment-test-1']);expect(h.session.snapshot()).toMatchObject({phase:'stopped',featureOwners:0,activeId:null,queuedSegments:0});});
When('I cancel during an unacknowledged segment start',async()=>{const gate=h.holdStart();await feed(RATE);await h.session.cancel();gate.resolve();await tick();await h.session.onMessage({type:'partial',sessionId:'segment-test-0',words:[]});});
Then('late messages cannot publish a transcript and the audio stays archived',()=>{expect(h.transcripts).toHaveLength(0);expect(h.chunks).toHaveLength(0);expect(h.session.snapshot()).toMatchObject({phase:'cancelled',featureOwners:0,activeId:null});expect(h.records.get('segment-test-0').pcm.length).toBe(RATE);expect(h.records.get('segment-test-0').status).toBe('cancelled');});
When('storage rejects the first sealed segment',async()=>{h.failWrite();try{await feed(20*RATE);}catch(value){error=value;}await tick();});
Then('the failure is explicit and the captured core remains recoverable',async()=>{expect(error?.name).toBe('QuotaExceededError');expect(h.errors).toHaveLength(1);expect(h.session.snapshot()).toMatchObject({phase:'error',capturedSamples:20*RATE,featureOwners:0});expect(h.session.retainedAudio()[0].pcm.length).toBe(20*RATE);await expect(h.session.push(new Float32Array(1))).rejects.toThrow('quota');await expect(h.session.stop()).rejects.toThrow('quota');});
When('a second core fills before the first archive write completes',async()=>{h.holdWrite();const first=h.session.push(Float32Array.from({length:20*RATE},(_,i)=>i));await tick();try{await h.session.push(Float32Array.from({length:20*RATE},(_,i)=>20*RATE+i));}catch(value){error=value;}h.releaseWrite();await first;await tick();});
Then('backpressure fails visibly while both captured cores remain recoverable',()=>{expect(error?.message).toMatch(/cannot keep up/);expect(h.errors).toHaveLength(1);expect(h.session.snapshot()).toMatchObject({phase:'error',capturedSamples:40*RATE,featureOwners:0});const records=h.session.retainedAudio();expect(h.records.get('segment-test-0').pcm.length).toBe(20*RATE);expect(records.some(record=>record.coreStartSample===20*RATE&&record.pcm.length===22*RATE)).toBe(true);});
When('I stop with a rotation write pending and a one second final tail',async()=>{h.holdWrite();const first=h.session.push(new Float32Array(20*RATE));await h.session.push(new Float32Array(RATE));stopPromise=h.session.stop();await tick();h.releaseWrite();await first;await tick();for(let i=0;i<5&&h.session.snapshot().phase!=='stopped';i++)await finishActive();outcome=await stopPromise;});
Then('all twenty one seconds finish without a storage backpressure error',()=>{expect(h.errors).toHaveLength(0);expect(outcome).toMatchObject({totalSamples:21*RATE,completedSegments:2});expect(h.session.snapshot().featureOwners).toBe(0);});
When('I stop without capturing audio',async()=>{outcome=await h.session.stop();});
Then('no segment or feature owner was created',()=>{expect(outcome).toMatchObject({totalSamples:0,completedSegments:0});expect(h.starts).toHaveLength(0);expect(h.records.size).toBe(0);expect(h.session.snapshot().peakFeatureOwners).toBe(0);});
When('I cancel twice while archiving a final captured tail',async()=>{await feed(RATE);h.holdWrite();const first=h.session.cancel(),second=h.session.cancel();expect(second).toBe(first);let resolved=false;second.then(()=>{resolved=true;});await tick();expect(resolved).toBe(false);h.releaseWrite();await first;await second;});
Then('both cancellation calls wait for one durable audio archive',()=>{expect(h.records.size).toBe(1);expect(h.records.get('segment-test-0').pcm.length).toBe(RATE);expect(h.session.snapshot().featureOwners).toBe(0);});
When('I stop an idle active stream while its final archive is held',async()=>{await feed(RATE);await tick();expect(h.session.active.ready).toBe(true);expect(h.session.active.sending).toBe(false);expect(h.chunks.reduce((n,chunk)=>n+chunk.pcm.length,0)).toBe(RATE);h.holdWrite();stopPromise=h.session.stop();await tick();expect(h.ends).toHaveLength(0);expect(h.records.size).toBe(0);h.releaseWrite();await tick();expect(h.ends).toHaveLength(1);expect(h.ends[0].reason).toBe('stop');expect(h.records.has('segment-test-0')).toBe(true);await finishActive();outcome=await stopPromise;await tick();});
Then('exactly one end follows durable storage and Stop finishes without more audio',()=>{expect(h.ends).toHaveLength(1);expect(outcome).toMatchObject({totalSamples:RATE,completedSegments:1});expect(h.session.snapshot()).toMatchObject({phase:'stopped',featureOwners:0,activeId:null});});
