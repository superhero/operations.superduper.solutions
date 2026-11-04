// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// The parent owns the model lease; this child owns ORT and its device.
export class Decider {
  constructor({profile,onEvent=()=>{},createWorker=url=>new Worker(url,{type:'module'})}) {
    this.worker=createWorker(new URL('../strands-fp32-worker.js',import.meta.url));
    this.pending=new Map();this.nextId=0;
    const fail=error=>{this.failed=error;for(const item of this.pending.values())item.reject(error);this.pending.clear();};
    this.worker.onmessage=({data})=>{
      const item=this.pending.get(data.id);
      if(data.type==='progress'){onEvent(data.progress);return;}
      if(!item)return;this.pending.delete(data.id);
      data.type==='error'?item.reject(Error(data.error?.message??'Native Strands failed.')):item.resolve(data.result);
    };
    this.worker.onerror=event=>{event.preventDefault?.();fail(Error(event.message||'Native Strands worker failed.'));};
    this.worker.onmessageerror=()=>fail(Error('Could not read the native Strands response.'));
    const base=new URL('./vendor/strands-native-device/ort/',import.meta.url);
    this.ready=this.request({type:'load',profile,modelId:'decision:strands-fp32',
      ortPaths:{mjs:new URL('ort-wasm-simd-threaded.asyncify.mjs',base).href,wasm:new URL('ort-wasm-simd-threaded.asyncify.wasm',base).href}});
  }
  request(data) {
    if(this.failed||this.closing)return Promise.reject(this.failed??Error('Native Strands is unloading.'));
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});try{this.worker.postMessage({...data,id});}catch(error){this.pending.delete(id);reject(error);}});
  }
  decide(state,question){return this.request({type:'decide',state,question});}
  dispose(){
    if(this.disposal)return this.disposal;
    const done=this.request({type:'dispose'});this.closing=true;
    return this.disposal=done.then(()=>{this.worker.terminate();});
  }
}
