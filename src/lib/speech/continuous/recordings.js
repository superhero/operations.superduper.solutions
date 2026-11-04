// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
import {createSegmentStore} from './segment-store.js';
import {createTranscriptMerger} from './transcript-merger.js';
import {wav} from '../diagnostics.js';
export const segmentDatabase='operations-speech-segments-v1';
const opened=()=>createSegmentStore({name:segmentDatabase});
const lockName=id=>'operations-speech-recording-v1:'+id;
export async function acquireRecordingUse(id){
  let release,entered;const held=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
  const task=navigator.locks.request(lockName(id),{mode:'shared'},async()=>{entered();await held;});
  await Promise.race([ready,task]);return async()=>{release();await task;};
}
export async function removeArchivedRecording(id){
  const store=opened();try{await store.removeRecording(id);}finally{await store.close();}
}
export async function inactiveRecording(id,work,skipBusy=false){
  if(!globalThis.navigator?.locks)return work();
  return navigator.locks.request(lockName(id),{ifAvailable:true},async lock=>{
    if(!lock&&skipBusy)return;
    if(!lock)throw Error('Stop dictation in every tab before deleting this recording.');return work();
  });
}
/** Inspect only lightweight metadata. PCM is read only for explicit playback/export. */
export async function recoverRecordings(records){
  const store=opened();try{
    const rows=await store.list(),groups=new Map(),result=new Map(records.map(record=>[record.id,record]));
    for(const row of rows){if(!groups.has(row.recordingId))groups.set(row.recordingId,[]);groups.get(row.recordingId).push(row);}
    for(const[id,segments]of groups){
      const previous=result.get(id);if(previous?.final)continue;
      const merger=createTranscriptMerger({overlapSeconds:2}),fragments=[];let latest;
      for(const row of segments){if(row.status!=='complete')continue;
        const delta=latest=merger.update({segmentId:row.sessionId,audioStartSample:row.audioStartSample,
          decodedThroughSeconds:(row.endSample-row.audioStartSample)/16000,reason:row.reason??'rotation',words:row.transcript?.words??[]});
        if(delta.stableDelta.text)fragments.push(delta.stableDelta.text);
      }
      const complete=segments.every(row=>row.status==='complete')&&segments.at(-1).reason==='stop';
      const final=complete?merger.finish():null;if(final?.stableDelta.text)fragments.push(final.stableDelta.text);
      const draft=(final??latest)?.draftText??'',text=(fragments.join('')+(draft?' '+draft:'')).trim();
      result.set(id,{id,created:segments[0].created??new Date(0).toISOString(),status:'recovered',expected:'',audio:new Blob([]),events:[],signal:{},
        ...previous,metadata:{...previous?.metadata,continuous:true,recovered:true},partials:[{text}],final:complete?{text}:previous?.final??null});
    }
    return[...result.values()].sort((a,b)=>b.created.localeCompare(a.created));
  }finally{await store.close();}
}
/** Reconstruct every unique PCM core exactly once, excluding replay overlap. */
export async function recordingAudio(record,recovery=[]){
  if(!record.metadata.continuous)return record.audio;
  const store=opened();try{
    const rows=await store.list(record.id),memory=new Map(recovery.filter(row=>row.recordingId===record.id).map(row=>[row.sessionId,row]));
    for(const row of memory.values())if(!rows.some(saved=>saved.sessionId===row.sessionId))rows.push(row);rows.sort((a,b)=>a.coreStartSample-b.coreStartSample);
    let expected=0;const parts=[];
    for(const row of rows){
      if(row.coreStartSample!==expected)throw Error('Saved audio has a missing core; available segments remain in recovery storage.');
      const data=await store.get(row.sessionId)??memory.get(row.sessionId),offset=row.coreStartSample-row.audioStartSample,length=row.endSample-row.coreStartSample;
      if(!data||offset<0||length<0||offset+length>data.pcm.length)throw Error('Saved audio is incomplete; remaining segments have not been removed.');
      const bytes=new ArrayBuffer(length*4),view=new DataView(bytes);for(let i=0;i<length;i++)view.setFloat32(i*4,data.pcm[offset+i],true);
      parts.push(bytes);expected=row.endSample;
    }
    if(!rows.length)throw Error('No archived audio is available yet.');
    if(expected*4+36>0xffffffff)throw Error('This recording exceeds the WAV format limit; export its individual recovery segments.');
    const header=await wav([]).arrayBuffer(),view=new DataView(header);view.setUint32(4,36+expected*4,true);view.setUint32(40,expected*4,true);
    return new Blob([header,...parts],{type:'audio/wav'});
  }finally{await store.close();}
}
