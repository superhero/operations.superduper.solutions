// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Adapted from llm-sds-01; continuous-sources.json preserves source provenance.
// Audio and lightweight metadata are separate stores: listing a long recording
// must not deserialize all its PCM into browser memory.
export function createSegmentStore({name='parakeet-long-stream-v1',indexedDB=globalThis.indexedDB}={}){
  if(!indexedDB)throw Error('IndexedDB is required to preserve pending speech audio.');
  const opened=new Promise((resolve,reject)=>{
    const request=indexedDB.open(name,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      db.createObjectStore('audio',{keyPath:'sessionId'});
      db.createObjectStore('metadata',{keyPath:'sessionId'}).createIndex('recordingId','recordingId');
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||Error('Cannot open speech audio storage.'));
    request.onblocked=()=>reject(Error('Speech audio storage is blocked by another tab. Close it and retry.'));
  });
  async function transaction(names,mode,work){
    const db=await opened;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(names,mode);let result;
      tx.oncomplete=()=>{try{resolve(typeof result==='function'?result():result);}catch(error){reject(error);}};
      tx.onerror=tx.onabort=()=>reject(tx.error||Error('Speech storage transaction failed. Audio has not been discarded.'));
      try{result=work(Object.fromEntries(names.map(key=>[key,tx.objectStore(key)])));}
      catch(error){tx.abort();reject(error);}
    });
  }
  return{
    async put(record){
      if(!record?.sessionId||!record.recordingId||!(record.pcm instanceof Float32Array))throw Error('Invalid speech segment archive.');
      const {pcm,...metadata}=record;
      return transaction(['audio','metadata'],'readwrite',stores=>{
        stores.audio.add({sessionId:record.sessionId,pcm});stores.metadata.add(metadata);return metadata;
      });
    },
    async get(sessionId){
      return transaction(['audio','metadata'],'readonly',stores=>{
        let audio,metadata;
        stores.audio.get(sessionId).onsuccess=event=>{audio=event.target.result;};
        stores.metadata.get(sessionId).onsuccess=event=>{metadata=event.target.result;};
        return()=>metadata&&audio?{...metadata,pcm:audio.pcm}:null;
      });
    },
    async list(recordingId){
      return transaction(['metadata'],'readonly',stores=>{
        let rows=[];
        const request=recordingId?stores.metadata.index('recordingId').getAll(recordingId):stores.metadata.getAll();
        request.onsuccess=()=>{rows=request.result;};
        return()=>rows.sort((a,b)=>a.coreStartSample-b.coreStartSample);
      });
    },
    async update(sessionId,patch){
      if('pcm' in patch||('sessionId' in patch&&patch.sessionId!==sessionId))throw Error('Transcript metadata cannot replace archived PCM/identity.');
      return transaction(['metadata'],'readwrite',stores=>{
        let updated;
        const request=stores.metadata.get(sessionId);
        request.onsuccess=()=>{
          if(!request.result)return;
          updated={...request.result,...patch};stores.metadata.put(updated);
        };
        return()=>{if(!updated)throw Error('Archived speech segment is missing.');return updated;};
      });
    },
    async removeRecording(recordingId){
      if(typeof recordingId!=='string'||!recordingId)throw Error('Choose a recording to remove.');
      return transaction(['audio','metadata'],'readwrite',stores=>{
        const request=stores.metadata.index('recordingId').getAllKeys(recordingId);
        request.onsuccess=()=>{for(const id of request.result){stores.audio.delete(id);stores.metadata.delete(id);}};
      });
    },
    async close(){(await opened).close();}
  };
}
