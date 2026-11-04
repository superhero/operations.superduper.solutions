// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import {createLongSpeech} from './continuous/capture.js';
import {saveRecording} from './storage.js';
import {acquireModelUse} from '../assistant/model-storage/storage.ts';
export {recoverRecordings,recordingAudio,inactiveRecording,removeArchivedRecording} from './continuous/recordings.js';
export class ContinuousSpeechController {
  constructor(parent){this.parent=parent;this.epoch=0;}
  async load(){
    const p=this.parent,epoch=++this.epoch,base=new URL('./speech/',p.dependencies.assetBase??document.baseURI);
    p.loadStages=[];p.downloadStarted=Date.now();p.update({phase:'downloading',error:'',status:'Saving and verifying continuous speech files…'});
    this.lifetime=new AbortController();
    try{this.releaseLogical=await(p.dependencies.acquireModelUse??acquireModelUse)('speech:parakeet-continuous',this.lifetime.signal);this.lifetime.signal.throwIfAborted();
    const featuresURL=new URL('features.js',base).href;
    this.long=(p.dependencies.createContinuous??createLongSpeech)({config:{workerURL:new URL('continuous-worker.js',base).href,
      featuresURL,captureURL:new URL('capture-worklet.js',base).href},
      createWorker:url=>p.workerFactory(url===featuresURL?'features':'continuous'),
      onState:state=>{if(epoch!==this.epoch)return;p.update({seconds:(state.session?.capturedSamples??0)/16000,queuedSegments:state.session?.queuedSegments??0});
        if(state.lastError){clearTimeout(p.timer);if(this.record?.metadata?.continuous)this.record.status='error';p.update({phase:'unloaded',error:state.lastError,status:'Speech stopped; export recovery audio before leaving.'});
          void this.save().catch(storage=>p.update({storageError:storage.message}));void this.unload().catch(cleanup=>p.update({storageError:cleanup.message}));}},
      onEvent:event=>{if(epoch!==this.epoch)return;
        if(event.type==='stage'){p.update({status:event.text});p.timeout(120000,'Continuous speech stopped making progress. Reload to retry.');}
        if(event.type==='capturePrepared'){if(event.runtime){p.runtime=event.runtime;if(this.record)this.record.metadata.runtime=event.runtime;}clearTimeout(p.timer);if(p.record?.metadata.source==='microphone'){p.update({status:'Allow microphone access to dictate…'});p.timeout(30000,'Microphone permission timed out. Retry when ready.');}}
        if(event.type==='captureStarted'){clearTimeout(p.timer);p.update({phase:'recording',status:'Listening · audio segments are saved locally.'});}
        if(event.type==='injectedCaptureStarted')clearTimeout(p.timer);
        if(event.type==='suspended'&&p.state.phase==='ready')p.update({status:'Speech paused. It will restore before dictation.'});},
      onTranscript:data=>{if(epoch===this.epoch)this.transcript(data);},
      onCancelled:async result=>{if(this.record?.id===result.recordingId){if(this.record.status!=='error')this.record.status='cancelled';await this.save();}},
      onArchived:async result=>{if(epoch!==this.epoch)throw new DOMException('Speech unloaded.','AbortError');
        this.record.final={text:result.text};this.record.status='complete';this.record.metadata.continuousResult=result;p.update({seconds:result.seconds});
        await this.save();},
    });
    p.recoverySources.add(this.long);
    const result=await this.long.load();if(epoch!==this.epoch)return;clearTimeout(p.timer);p.runtime=result.runtime;
      p.preferencesChanged({loaded:true});p.update({phase:'ready',status:'Continuous speech ready · GPU model, CPU features and TEN speech detection.'});}
    catch(error){await this.releaseLogical?.();this.releaseLogical=undefined;if(epoch===this.epoch){clearTimeout(p.timer);p.update({phase:'unloaded',error:error.message,status:'Continuous speech failed. Reload to retry.'});}throw error;}
  }
  async save(){
    const p=this.parent,active=this.record;if(!active?.metadata?.continuous)return;
    const record=structuredClone({...active,audio:new Blob([]),signal:{samples:Math.round(p.state.seconds*16000)}});
    p.writing=p.writing.catch(()=>{}).then(()=>(p.dependencies.saveRecording??saveRecording)(record));
    await p.writing;await p.refreshRecordings();
  }
  transcript(data){
    const p=this.parent;if(data.recordingId!==p.record?.id)return;
    const delta=data.stableDelta;
    if(delta?.text&&delta.sequence>this.sequence){
      if(delta.sequence!==this.sequence+1){const error=Error('A confirmed speech update was missed; recorded audio is retained.');this.record.status='error';p.update({phase:'unloaded',error:error.message,status:'Reload speech; recovery audio is retained.'});void this.unload().catch(cleanup=>p.update({storageError:cleanup.message}));return;}
      this.sequence=delta.sequence;this.confirmed+=delta.text;
      p.text({sessionId:p.record.id,confirmed:this.confirmed,final:!!data.final});
    }
    p.record.partials=[{text:this.confirmed+(data.draftText?' '+data.draftText:'')}];
    if(data.final)p.record.final={text:this.confirmed};
    p.update({provisional:data.final?'':data.draftText||''});
  }
  begin(source){const p=this.parent;this.sequence=0;this.confirmed='';const id=p.startRecord(source,true);this.record=p.record;return id;}
  async start(){
    const p=this.parent,epoch=this.epoch,id=this.begin('microphone'),long=this.long,current=()=>epoch===this.epoch&&long===this.long&&p.record?.id===id;
    p.update({phase:'requesting',status:'Preparing continuous speech before microphone access…'});
    try{if(!long.snapshot().ready)await long.load();if(!current())return;await long.startRecord({recordingId:id});}
    catch(error){if(current()&&p.state.phase==='requesting'){
      p.record.status='error';await this.save().catch(storage=>p.update({storageError:storage.message}));
      if(!long.snapshot().workerAlive){await this.releaseLogical?.();this.releaseLogical=undefined;}
      if(current())p.update({phase:long.snapshot().ready?'ready':'unloaded',error:error.message,status:'Microphone stopped. Saved audio remains available.'});}}
  }
  async stop(){
    const p=this.parent,epoch=this.epoch,long=this.long,id=this.record?.id,current=()=>epoch===this.epoch&&long===this.long&&p.record?.id===id;
    if(p.state.phase==='requesting'){
      p.update({phase:'finalizing',status:'Cancelling microphone access and saving captured audio…'});
      try{await long.cancel();if(!current())return;this.record.status='cancelled';await this.save();if(!current())return;
        clearTimeout(p.timer);p.update({phase:'ready',status:'Microphone request cancelled.',provisional:''});}
      catch(error){if(current())p.update({phase:'unloaded',error:error.message});}return;
    }
    if(p.state.phase!=='recording')return;
    p.update({phase:'finalizing',status:'Draining recognition and saving every audio segment…'});
    try{const result=await long.stopRecord();if(!current())return;clearTimeout(p.timer);p.update({phase:'ready',provisional:'',
      status:result.text?'Transcript added to your draft.':'No speech detected. Your draft is unchanged.'});}
    catch(error){if(current()){clearTimeout(p.timer);p.update({phase:'unloaded',error:error.message,status:'Speech stopped; recorded segments remain available.'});}}
  }
  async file(file){
    if(!file)return;const p=this.parent,epoch=this.epoch,id=this.begin('file'),long=this.long,current=()=>epoch===this.epoch&&long===this.long&&p.record?.id===id;p.update({phase:'finalizing',status:'Reading audio file…'});
    try{
      if(file.size>10485760)throw Error('Choose an audio file up to10MiB and60seconds.');
      const audio=await new OfflineAudioContext(1,16000,16000).decodeAudioData(await file.arrayBuffer());
      if(!current())return;if(audio.duration<.1||audio.duration>60)throw Error('Choose audio between0.1and60seconds.');
      const pcm=new Float32Array(audio.length);for(let ch=0;ch<audio.numberOfChannels;ch++){const data=audio.getChannelData(ch);for(let i=0;i<pcm.length;i++)pcm[i]+=data[i]/audio.numberOfChannels;}
      if(!long.snapshot().ready)await long.load();if(!current())return;await long.startInjected({recordingId:id});if(!current())return;
      for(let at=0;at<pcm.length;at+=4000){if(!current())return;await long.pushPcm(pcm.subarray(at,at+4000));}
      const result=await long.finishInjected();if(!current())return;clearTimeout(p.timer);p.update({phase:'ready',provisional:'',status:result.text?'Transcript added to your draft.':'No speech detected.'});
    }catch(error){if(current()){this.record.status='error';await this.save().catch(()=>{});if(current())p.update({phase:long.snapshot().ready?'ready':'unloaded',error:error.message});}}
  }
  unload(){
    if(this.disposal)return this.disposal;++this.epoch;this.lifetime?.abort(new DOMException('Speech unloaded.','AbortError'));
    return this.disposal=(async()=>{try{await this.long?.unload();}
      catch(error){error.workerTerminated=!this.long?.snapshot().workerAlive;throw error;}
      finally{await this.releaseLogical?.();this.releaseLogical=undefined;if(!this.long?.getRecoveryAudio().length)this.parent.recoverySources.delete(this.long);}})();
  }
}
