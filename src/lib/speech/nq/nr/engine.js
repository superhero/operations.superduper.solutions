// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Adapted from llm-sds-01; continuous-sources.json preserves source provenance.
import * as ort from 'onnxruntime-web/webgpu';
import {JsPreprocessor,ParakeetModel} from 'parakeet.js';
import {ParakeetTokenizer} from 'parakeet-tokenizer';
import {VariableGroupedDecoder} from 'variable-grouped-decoder';
import {SelectionDecoder} from '../selection-decoder.js';
import {ParakeetModel as GroupedModel} from 'grouped-parakeet-model';
import {ParakeetModel as SelectionModel} from 'selection-parakeet-model';
const required=['encoder','externalData','decoder','vocab'];
const digest=async arrays=>{const bytes=new Uint8Array(arrays.reduce((n,a)=>n+a.byteLength,0));let offset=0;for(const a of arrays){bytes.set(new Uint8Array(a.buffer,a.byteOffset,a.byteLength),offset);offset+=a.byteLength;}return[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');};

// Assets are explicit verified URL/blob maps owned by the caller. No discovery,
// hardcoded host, manifest request or CPU reference is needed for the NQ path.
export async function createNqSpeech(options){return createEngine({...options,profile:'nq'});}
export async function createQualificationReference(options){return createEngine(options);}
async function createEngine({assets,ortPaths,profile='nq',stage=()=>{}}){
  for(const name of required)if(typeof assets?.[name]!=='string'||!assets[name])throw Error('Missing verified speech asset URL: '+name);
  if(!ortPaths)throw Error('Explicit ORT asset paths are required');
  ort.env.logLevel='warning';ort.env.debug=false;ort.env.trace=false;ort.env.wasm.trace=false;ort.env.webgpu.profiling={mode:'off'};ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=ortPaths;
  if(!navigator.gpu)throw Error('WebGPU is unavailable. Enable browser hardware acceleration and retry; no CPU encoder substitution was made.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('No WebGPU adapter. Check browser GPU support and retry; no CPU encoder substitution was made.');
  const device=await adapter.requestDevice({requiredFeatures:[]}),liveBuffers=new Map();let createdBuffers=0,destroyedBuffers=0,peakBufferBytes=0,liveBufferBytes=0;
  const create=device.createBuffer.bind(device);device.createBuffer=options=>{const buffer=create(options),destroy=buffer.destroy.bind(buffer);liveBuffers.set(buffer,options.size);createdBuffers++;liveBufferBytes+=options.size;peakBufferBytes=Math.max(peakBufferBytes,liveBufferBytes);buffer.destroy=()=>{const bytes=liveBuffers.get(buffer);if(liveBuffers.delete(buffer)){liveBufferBytes-=bytes;destroyedBuffers++;destroy();}};return buffer;};
  const gpuErrors=[];device.addEventListener('uncapturederror',event=>gpuErrors.push(event.error.message));
  const gpu={executionProviders:[{name:'webgpu',device}],graphOptimizationLevel:'all',executionMode:'sequential',logSeverityLevel:2,logVerbosityLevel:0,enableProfiling:false,enableGraphCapture:false};
  let encoder,session,decoder,model,inFlight,disposed=false,disposal;
  const stats=()=>({profile,api_live_gpu_buffers:liveBuffers.size,api_live_gpu_buffer_bytes:liveBufferBytes,api_peak_gpu_buffer_bytes:peakBufferBytes,created_buffers:createdBuffers,destroyed_buffers:destroyedBuffers,active_encoder_tensors:decoder?.encoded?1:0,pending_decoder_outputs:decoder?.pending?.length||0,retained_decoder_states:decoder?.liveStates?.size||0,private_buffers:decoder?.buffers.length||0,log_capacity:decoder?.logCapacity||null,last_inference:decoder?structuredClone(decoder.counters):null,gpu_errors:gpuErrors.slice(),in_flight:!!inFlight,disposed});
  function dispose(){
    if(disposal)return disposal;disposed=true;
    return disposal=(async()=>{await inFlight?.catch(()=>{});await decoder?.release();if(!decoder)await session?.release();await encoder?.release();await device.queue.onSubmittedWorkDone();for(const buffer of [...liveBuffers.keys()])buffer.destroy();device.destroy();return stats();})();
  }
  try{
    stage('Initializing original variable-shape FP32 GPU encoder…');
    // Original encoder deliberately retains audited CPU shape/index/layout work;
    // complete NR placement evidence, not an all-op GPU claim, owns this boundary.
    encoder=await ort.InferenceSession.create(assets.encoder,{...gpu,...(profile!=='hybrid'?{preferredOutputLocation:{outputs:'gpu-buffer'}}:{}),externalData:[{path:'encoder-model.onnx.data',data:assets.externalData}]});
    stage(profile==='hybrid'?'Initializing original INT8 CPU decoder…':'Initializing strict GPU decoder and GPU control…');
    session=await ort.InferenceSession.create(assets.decoder,profile==='hybrid'?{executionProviders:['wasm'],graphOptimizationLevel:'all',logSeverityLevel:2,logVerbosityLevel:0,enableProfiling:false}:{...gpu,preferredOutputLocation:'gpu-buffer',extra:{session:{disable_cpu_ep_fallback:'1'}}});
    const tokenizer=await ParakeetTokenizer.fromUrl(assets.vocab),preprocessor=new JsPreprocessor({nMels:128});
    if(profile==='hybrid')model=new ParakeetModel({ort,tokenizer,encoderSession:encoder,joinerSession:session,preprocessor,nMels:128});
    else{
      decoder=profile==='np'?new SelectionDecoder(session,ort,device):new VariableGroupedDecoder(session,ort,device);
      const wrapped={run:async feeds=>{const out=await encoder.run(feeds);for(const [name,tensor] of Object.entries(out))if(name!=='outputs')tensor.dispose?.();if(out.outputs.location!=='gpu-buffer')throw Error('Variable encoder output left GPU');return{outputs:out.outputs};}};
      model=new(profile==='np'?SelectionModel:GroupedModel)({ort,tokenizer,encoderSession:wrapped,joinerSession:decoder,preprocessor,nMels:128});model._residentDecoder=decoder;
    }
    const infer=async(pcm,sampleRate,options={},validation=false)=>{
      if(disposed)throw Error('Speech engine is unloaded; load a fresh inference worker');if(inFlight)throw Error('Speech inference is serial; wait for the previous request');
      if(sampleRate!==16000)throw Error('Speech input must be16kHz');
      for(const name of Object.keys(options))if(!['returnTimestamps','timeOffset','precomputedFeatures'].includes(name))throw Error('Unsupported live speech option: '+name);
      const features=options.precomputedFeatures;if(features&&(!Number.isInteger(features.T)||features.T<=0||features.melBins!==128||features.features.length!==128*features.T))throw Error('Cached speech feature shape differs');
      if(decoder)decoder.snapshotEnabled=validation;
      inFlight=(async()=>{
        const result=await model.transcribe(pcm,sampleRate,{...options,...(validation?{returnTokenIds:true,returnFrameIndices:true,returnTdtSteps:true}:{})});await device.queue.onSubmittedWorkDone();
        if(validation&&decoder){const state=await decoder.readFinalState();result.final_state_sha256=await digest(state);result.final_state_bytes=10240;result.step_trace=decoder.stepTrace.slice();}
        result.execution={...stats(),in_flight:false};return result;
      })();
      try{return await inFlight;}finally{inFlight=null;if(decoder)decoder.snapshotEnabled=false;}
    };
    return{device,transcribe:(pcm,rate,options)=>infer(pcm,rate,options,false),validate:(pcm,rate,options)=>infer(pcm,rate,options,true),reset(){model.resetMelCache();model.clearIncrementalCache();},preprocess(pcm){const p=preprocessor.process(pcm);return{features:p.features,T:p.features.length/128,validLength:p.length,melBins:128};},stats,dispose,runtime:{profile,ort:ort.env.versions,parakeetJs:'1.4.4',adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,features:[...adapter.features]},encoder:'Original dynamic FP32; GPU neural operators + explicitly audited CPU shape/index/layout',decoder:profile==='hybrid'?'Original INT8 Wasm':'Compatibility FP32 activation math, original INT8 stored initializer bytes',gpuControl:profile==='nq',cpuFeatureAndTextWork:true,assets:'Explicit caller-verified URLs/blob URLs; no network discovery'}};
  }catch(error){await dispose().catch(()=>{});throw error;}
}
