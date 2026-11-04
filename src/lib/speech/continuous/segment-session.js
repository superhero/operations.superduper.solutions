// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Adapted from llm-sds-01; continuous-sources.json preserves source provenance.
const RATE=16000;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return{promise,resolve,reject};};
const cancelled=()=>Object.assign(Error('Continuous speech recording was cancelled.'),{name:'AbortError'});

// One physical recording owns capture. This class owns bounded ASR segments,
// feature clients and durable backlog; it never opens/stops the microphone.
export class SegmentSession{
  constructor({transport,featuresFactory,store,onTranscript=()=>{},onProgress=()=>{},onError=()=>{},segmentSeconds=20,overlapSeconds=2,recordingId,sessionPrefix}={}){
    this.coreSamples=segmentSeconds*RATE;this.overlapSamples=overlapSeconds*RATE;
    if(!Number.isInteger(this.coreSamples)||this.coreSamples<=0||!Number.isInteger(this.overlapSamples)||this.overlapSamples<0||this.overlapSamples>this.coreSamples||this.coreSamples+this.overlapSamples>22*RATE)throw Error('Speech segments require integer samples and at most22s including overlap.');
    Object.assign(this,{transport,featuresFactory,store,onTranscript,onProgress,onError});
    this.created=new Date().toISOString();
    this.recordingId=recordingId||sessionPrefix||globalThis.crypto?.randomUUID?.()||('recording-'+Date.now()+'-'+Math.random().toString(16).slice(2));
    this.sessionPrefix=sessionPrefix||this.recordingId;this.phase='capturing';this.capturedSamples=0;this.completedSegments=0;
    this.queue=[];this.owners=new Set();this.current=null;this.active=null;this.write=null;this.nextIndex=0;this.epoch=0;
    this.staleIgnored=0;this.peakFeatureOwners=0;this.peakRetainedPcmSamples=0;this.cleanupErrors=[];this.recovery=[];
  }
  _notify(callback,value){try{callback(value);}catch{/* Views cannot own audio lifetime. */}}
  _metadata(segment){return{created:this.created,recordingId:this.recordingId,sessionId:segment.sessionId,index:segment.index,audioStartSample:segment.audioStartSample,coreStartSample:segment.coreStartSample,endSample:segment.coreStartSample+segment.coreLength,reason:segment.reason||null};}
  _newSegment(prefix=new Float32Array()){
    const index=this.nextIndex++,segment={index,sessionId:this.sessionPrefix+'-'+index,coreStartSample:this.capturedSamples,audioStartSample:this.capturedSamples-prefix.length,coreLength:0,length:prefix.length,buffer:new Float32Array(this.coreSamples+this.overlapSamples),owner:null,sent:0,ready:false,sealed:false};
    segment.buffer.set(prefix);return segment;
  }
  _owner(segment){
    if(!segment.owner){
      segment.owner=this.featuresFactory();this.owners.add(segment.owner);this.peakFeatureOwners=Math.max(this.peakFeatureOwners,this.owners.size);
      if(this.owners.size>2)throw Error('Speech feature ownership exceeded capture plus active inference.');
      if(segment.length)segment.owner.push(segment.buffer.subarray(0,segment.length));
    }
    return segment.owner;
  }
  _closeOwner(segment){
    if(!segment?.owner)return;const owner=segment.owner;segment.owner=null;
    try{owner.close();}catch(error){this.cleanupErrors.push(error.message||String(error));}
    this.owners.delete(owner);
  }
  _memory(){
    const buffers=new Map();
    for(const segment of [this.current,this.active])if(segment?.buffer)buffers.set(segment.buffer.buffer,segment.length);
    for(const record of [this.write?.record,...this.recovery])if(record?.pcm)buffers.set(record.pcm.buffer,Math.max(record.pcm.length,buffers.get(record.pcm.buffer)||0));
    return[...buffers.values()].reduce((a,b)=>a+b,0);
  }
  snapshot(){
    const retainedPcmSamples=this._memory();this.peakRetainedPcmSamples=Math.max(this.peakRetainedPcmSamples,retainedPcmSamples);
    return{recordingId:this.recordingId,phase:this.phase,capturedSamples:this.capturedSamples,totalSamples:this.capturedSamples,retainedPcmSamples,peakRetainedPcmSamples:this.peakRetainedPcmSamples,queuedSegments:this.queue.length,featureOwners:this.owners.size,peakFeatureOwners:this.peakFeatureOwners,activeId:this.active?.sessionId||null,completedSegments:this.completedSegments,storagePending:!!this.write,error:this.failure?.message||null,staleIgnored:this.staleIgnored,cleanupErrors:this.cleanupErrors.slice()};
  }
  _progress(){this._notify(this.onProgress,this.snapshot());}
  _fail(reason){
    if(this.phase==='cancelled'||this.phase==='error')return;
    this.failure=reason instanceof Error?reason:Error(String(reason));this.phase='error';this.epoch++;
    this._closeOwner(this.current);this._closeOwner(this.active);this.stopped?.reject(this.failure);
    this._notify(this.onError,this.failure);this._progress();
  }
  push(pcm){
    if(this.phase!=='capturing')return Promise.reject(this.failure||Error('Speech capture is no longer accepting audio.'));
    if(!(pcm instanceof Float32Array))return Promise.reject(Error('Speech capture requires Float32Array16kHz PCM.'));
    const writes=[];let offset=0;
    try{
      while(offset<pcm.length){
        const segment=this.current||(this.current=this._newSegment());this._owner(segment);
        const count=Math.min(pcm.length-offset,this.coreSamples-segment.coreLength),part=pcm.subarray(offset,offset+count);
        segment.buffer.set(part,segment.length);segment.owner.push(part);segment.length+=count;segment.coreLength+=count;this.capturedSamples+=count;offset+=count;
        this._kick();this._flush(this.active);
        if(segment.coreLength===this.coreSamples){
          const prefix=segment.buffer.slice(segment.length-this.overlapSamples,segment.length);
          writes.push(this._seal(segment,'rotation'));this.current=this._newSegment(prefix);
        }
      }
      this._progress();
      return Promise.all(writes).then(()=>this.snapshot());
    }catch(error){
      // Preserve the remainder of this already-delivered packet on storage failure.
      if(offset<pcm.length){this.recovery.push({recordingId:this.recordingId,sessionId:this.sessionPrefix+'-unarchived',audioStartSample:this.capturedSamples,coreStartSample:this.capturedSamples,endSample:this.capturedSamples+pcm.length-offset,pcm:pcm.slice(offset)});this.capturedSamples+=pcm.length-offset;}
      this._fail(error);return Promise.reject(error);
    }
  }
  _seal(segment,reason){
    if(segment.sealed)return segment.persist;
    if(this.write)throw Error('Speech storage cannot keep up. Capture stopped before another segment could be discarded; retain/retry the buffered audio.');
    segment.sealed=true;segment.reason=reason;
    const record={...this._metadata(segment),status:'pending',pcm:segment.buffer.subarray(0,segment.length)};
    const pending={record,segment};this.write=pending;
    if(segment!==this.active){this._closeOwner(segment);this.queue.push({...this._metadata(segment)});segment.buffer=null;}
    segment.persist=Promise.resolve().then(()=>this.store.put(record)).then(()=>{
      segment.persisted=true;if(this.write===pending)this.write=null;this._kick();this._flush(this.active);this._progress();this._maybeFinish();return this._metadata(segment);
    }).catch(error=>{this._fail(error);throw error;});
    segment.persist.catch(()=>{});pending.promise=segment.persist;
    // Stop can seal an already-idle active stream: no later PCM push will wake
    // its sender. Assign the durable promise first; the end barrier awaits it.
    if(segment===this.active)this._flush(segment);
    return segment.persist;
  }
  _kick(){
    if(this.active||!['capturing','draining'].includes(this.phase))return;
    const descriptor=this.queue.shift();let segment;
    if(descriptor)segment={...descriptor,coreLength:descriptor.endSample-descriptor.coreStartSample,sealed:true,length:descriptor.endSample-descriptor.audioStartSample,sent:0,owner:null,buffer:null};
    else if(this.current?.coreLength)segment=this.current;
    if(!segment){this._maybeFinish();return;}
    this.active=segment;const epoch=this.epoch;
    (async()=>{
      if(!segment.buffer){
        if(this.write?.record.sessionId===segment.sessionId)await this.write.promise;
        const record=await this.store.get(segment.sessionId);
        if(epoch!==this.epoch)return;
        if(!(record?.pcm instanceof Float32Array)||record.pcm.length!==segment.length)throw Error('Pending speech PCM is missing or incomplete; no samples were skipped.');
        segment.buffer=record.pcm;segment.persisted=true;segment.persist=Promise.resolve();
      }
      if(epoch!==this.epoch)return;
      const owner=this._owner(segment);
      await this.transport.start({sessionId:segment.sessionId,featurePort:owner.connect()});
      if(epoch!==this.epoch||this.active!==segment)return;
      segment.ready=true;this._flush(segment);this._progress();
    })().catch(error=>this._fail(error));
  }
  _flush(segment){
    if(!segment?.ready||segment.sending||!['capturing','draining'].includes(this.phase))return;
    segment.sending=true;const epoch=this.epoch;
    (async()=>{
      while(epoch===this.epoch&&this.active===segment){
        if(segment.sent<segment.length){const end=segment.length,pcm=segment.buffer.slice(segment.sent,end);segment.sent=end;await this.transport.chunk({sessionId:segment.sessionId,pcm});continue;}
        if(segment.sealed&&!segment.endSent){await segment.persist;if(epoch!==this.epoch)return;segment.endSent=true;await this.transport.end({sessionId:segment.sessionId,pcm:segment.buffer.slice(0,segment.length),reason:segment.reason});}
        break;
      }
    })().catch(error=>this._fail(error)).finally(()=>{segment.sending=false;if(epoch===this.epoch&&this.active===segment&&(segment.sent<segment.length||segment.sealed&&!segment.endSent))this._flush(segment);});
  }
  onMessage(message){
    const segment=this.active;
    if(!segment||message.sessionId!==segment.sessionId||!['capturing','draining'].includes(this.phase)){this.staleIgnored++;return Promise.resolve(false);}
    if(message.type==='error'){this._fail(Error(message.message||'Segment recognition failed.'));return Promise.resolve(false);}
    if(message.type==='partial'){this._notify(this.onTranscript,{...message,segment:this._metadata(segment)});return Promise.resolve(true);}
    if(message.type!=='result'||segment.completing)return Promise.resolve(false);
    if(!segment.endSent){this._fail(Error('Speech segment returned a final result before its end barrier.'));return Promise.resolve(false);}
    segment.completing=true;const epoch=this.epoch;
    const completed=(async()=>{
      await segment.persist;
      await this.store.update(segment.sessionId,{status:'complete',transcript:{text:message.text||'',words:message.words||[]}});
      if(epoch!==this.epoch||this.active!==segment)return false;
      this._notify(this.onTranscript,{...message,segment:this._metadata(segment)});
      this._closeOwner(segment);segment.buffer=null;this.active=null;this.completedSegments++;this._kick();this._progress();this._maybeFinish();return true;
    })().catch(error=>{this._fail(error);return false;});
    return completed;
  }
  stop(){
    if(this.stopped)return this.stopped.promise;
    if(this.phase==='error'||this.phase==='cancelled')return Promise.reject(this.failure||cancelled());
    this.stopped=deferred();this.phase='draining';
    const epoch=this.epoch;
    (async()=>{
      // Capture has stopped: wait for the bounded prior write rather than turn
      // an ordinary Stop immediately after rotation into a backpressure error.
      await this.write?.promise;if(epoch!==this.epoch)return;
      const segment=this.current;
      if(segment?.coreLength)this._seal(segment,'stop');else this._closeOwner(segment);
      this.current=null;this._kick();this._progress();this._maybeFinish();
    })().catch(error=>this._fail(error));
    return this.stopped.promise;
  }
  _maybeFinish(){
    if(this.phase==='draining'&&!this.active&&!this.queue.length&&!this.write&&!this.current?.coreLength){this.phase='stopped';this.stopped.resolve({recordingId:this.recordingId,totalSamples:this.capturedSamples,completedSegments:this.completedSegments});this._progress();}
  }
  cancel(){
    if(this.cancelling)return this.cancelling;
    const tail=this.current?.coreLength&&!this.current.sealed?{...this._metadata(this.current),reason:'cancel',status:'cancelled',pcm:this.current.buffer.subarray(0,this.current.length)}:null;
    const pending=this.write;this.phase='cancelled';this.epoch++;this.stopped?.reject(cancelled());this._closeOwner(this.current);this._closeOwner(this.active);this.current=null;this.active=null;this.queue=[];
    this.cancelling=(async()=>{
      try{await pending?.promise;if(tail)await this.store.put(tail);}
      catch(error){if(tail)this.recovery.push(tail);if(this.failure!==error)this._notify(this.onError,error);this.failure=error;throw error;}
      finally{this._progress();}
      return this.snapshot();
    })();
    this.cancelling.catch(()=>{});return this.cancelling;
  }
  retainedAudio(){
    const records=[...this.recovery];
    if(this.write?.record)records.push(this.write.record);
    if(this.current?.coreLength&&this.current.buffer&&!this.current.persisted&&!records.some(record=>record.sessionId===this.current.sessionId))records.push({...this._metadata(this.current),pcm:this.current.buffer.subarray(0,this.current.length)});
    return records.map(record=>({...record,pcm:record.pcm.slice()}));
  }
}
