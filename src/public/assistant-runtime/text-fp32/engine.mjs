// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// Ported from the qualified brave-chat-gpu runtime; see reference-sources.json.
import {samplingOptions} from '../settings.js';
import {abortableGeneration} from '../execution.js';
import {splitLFM3Reasoning} from './lfm3-reasoning.js';
function mergeToolDeltas(calls,deltas=[]) {
 for(const delta of deltas){const index=delta.index??0;calls[index]??={id:'',type:'function',function:{name:'',arguments:''}};
  const call=calls[index];if(delta.id)call.id=delta.id;call.function.name+=delta.function?.name??'';call.function.arguments+=delta.function?.arguments??'';}
}
export function nativeMessages(messages) {return messages.map(message=>({...message,...(message.tool_calls?{tool_calls:message.tool_calls.map(call=>({...call,function:{...call.function,arguments:typeof call.function.arguments==='string'?call.function.arguments:JSON.stringify(call.function.arguments)}}))}:{})}));}


import {inspectPlacement,requireGpuPlacement} from './placement.mjs';
export {inspectPlacement,requireGpuPlacement};

const PINS = [
 ['openbmb/MiniCPM5-2B-GGUF','2079a22f3beaa4e306449978533478fe0522f4b3','MiniCPM5-2B-Q4_K_M.gguf',1561318368,'ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd','standard-fp32-gpu','upstream'],
 ['ornith-ai/Ornith-1.5-9B-GGUF','abdd624b12ebf020b767fff532ff44fe552b28c3','Ornith-1.5-9B-Q4_K_M.gguf',5780090816,'70c112196e0b7023803c9762752e46d29e612a92c83f995bc3ba1ceb07e8fab6','standard-fp32-gpu','upstream'],
 ['ornith-ai/Ornith-1.5-9B-GGUF','abdd624b12ebf020b767fff532ff44fe552b28c3','Ornith-1.5-9B-Q8_0.gguf',9786060384,'22086870b009dbe9815ee752c48a82de930118a7c5ce5599590892ae03b8b010','standard-fp32-gpu','upstream'],
 ['LiquidAI/LFM3-1.7B-GGUF','bad5729bba61d076fff20d2548e62526665af215','LFM3-1.7B-QAD-Q4_0.gguf',1049615680,'43a7d09a0e9cba91b63eb7052488b9564569bddfd65754d2e426465e572a7452','lfm3-fp32-gpu','lfm3-upstream'],
];

export async function loadFp32Chat(profile,onProgress=()=>{},options={}){
 const asset=path=>new URL(path,new URL('text-fp32/',options.assetBase)).href;
 const pin=PINS.find(([model,revision,file,bytes,sha,variant])=>profile.model===model&&profile.revision===revision&&profile.file===file&&profile.weight_bytes===bytes&&profile.weight_sha256===sha&&profile.native_variant===variant);
 if(!pin)throw Error('Unqualified compatible text profile or native runtime pair.');
 const lfm3=pin[5]==='lfm3-fp32-gpu';
 if(Object.keys(profile.native_load_options??{}).length)throw Error('Compatible text does not allow native load overrides.');
 if(!['auto','gpu'].includes(options.mode??'gpu'))throw Error('Compatible text requires full GPU execution.');
 if(profile.settings.context_tokens>4096||profile.settings.max_new_tokens>256||profile.settings.thinking||profile.settings.prefix_cache||profile.settings.sampling_mode!=='greedy')throw Error('Compatible text exceeds its qualified configuration.');
 if(profile.settings.execution_mode!=='gpu'||profile.settings.gpu_layers!==99)throw Error('This attempt has no CPU/hybrid model fallback');
 const adapter=await (options.gpu??globalThis.navigator?.gpu)?.requestAdapter({powerPreference:'high-performance'});
 if(!adapter)throw Error('A usable WebGPU adapter is required');
 const folder=pin[6],moduleURL=asset('./'+folder+'/index.js');
 const [{Wllama},{RangeSource,RangeBlob}]=await Promise.all([
  options.Wllama?{Wllama:options.Wllama}:import(/* @vite-ignore */ `${moduleURL}`),
  options.ranges??import('../ornith/range-blob.mjs'),
 ]);
 const logs=[],auditLogs=[],sources=[],proof=[],cpuFailures=[];
 const auditTotals={cpu_compute_ops:0,gpu_compute_ops:0,rows:0};
 const allLogs=()=>[...proof,...logs,...cpuFailures.filter(line=>!auditLogs.includes(line)),...auditLogs];
 const log=(...args)=>{
  const line=args.map(value=>typeof value==='string'?value:JSON.stringify(value)).join(' ').slice(0,2400);
  if(/FP32_COMPAT device|FP32_COMPAT pipeline mul_mat|offloaded \d+\/\d+ layers|GPU_ONLY_MODEL/.test(line)&&proof.length<32)proof.push(line);
  if(/GPU_ONLY_AUDIT|GPU_ONLY_CPU_OP/.test(line)){
   auditLogs.push(line);if(auditLogs.length>512)auditLogs.shift();
   const row=line.match(/GPU_ONLY_AUDIT cpu_compute_ops=(\d+) gpu_compute_ops=(\d+)/);
   if(row){auditTotals.rows++;auditTotals.cpu_compute_ops+=Number(row[1]);auditTotals.gpu_compute_ops+=Number(row[2]);}
   if((line.includes('GPU_ONLY_CPU_OP')||row&&Number(row[1])>0)&&cpuFailures.length<16)cpuFailures.push(line);
  }
  else{logs.push(line);if(logs.length>6000)logs.shift();}
  if(/offload|buffer|backend|GPU_ONLY_CPU_OP|GPU_ONLY_MODEL|error|failed/i.test(line))onProgress({phase:'native',message:line});
 };
 const raw=new Wllama({default:asset('./'+folder+'/wllama.wasm')},{parallelDownloads:1,
  logger:Object.fromEntries(['debug','log','warn','error'].map(level=>[level,log]))});
 const abort=new AbortController(),s=profile.settings;
 const source=new RangeSource(`https://huggingface.co/${profile.model}/resolve/${profile.revision}/${profile.file}`,
  profile.weight_bytes,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(s.load_timeout_ms),...(options.signal?[options.signal]:[])]),
   fetch:options.fetch,chunkBytes:s.range_chunk_bytes,cacheBytes:s.range_lru_bytes_per_file,parallel:s.range_parallel,
   onProgress:event=>onProgress({phase:'weights',message:'Streaming official GGUF ranges',...event})});
 sources.push(source);
 let disposed=false,disposal;
 const dispose=()=>disposal??=(async()=>{disposed=true;abort.abort();try{await raw.exit();}finally{for(const item of sources)item.clear();}})();
 try{
  options.signal?.throwIfAborted();
  await raw.loadModel([new RangeBlob(source)],{n_gpu_layers:99,n_threads:s.cpu_threads,n_ctx:s.context_tokens,
   n_batch:s.batch_tokens,n_ubatch:s.micro_batch_tokens,n_parallel:1,flash_attn:false,
   cache_type_k:'f32',cache_type_v:'f32',ctx_shift:false,jinja:true,reasoning:false,
   default_template_kwargs:{enable_thinking:false},warmup:true,cache_idle_slots:false,cont_batching:false,seed:s.seed});
  options.signal?.throwIfAborted();
  const context=raw.getLoadedContextInfo(),placement=requireGpuPlacement(allLogs(),{requireCompute:false});
  if(!(context.n_ctx>=s.context_tokens&&context.n_layer>0))throw Error('Native context does not satisfy the requested profile');
  return {kind:'wllama-fp32',invalidated:false,info:{engine:'wllama',family:profile.family,runtime_source:profile.runtime_source,
   context_tokens:context.n_ctx,context,projector:null,input_modalities:['text'],requested_settings:s,
   execution:{mode:'gpu',cpu_fallback:false,label:'FP32 WebGPU; CPU model kernels forbidden'},
   adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,features:[...adapter.features]},
   placement,audit_totals:{...auditTotals},chat_template:raw.getChatTemplate()},
   contextLimit:Math.min(s.context_tokens,context.n_ctx),logs:()=>allLogs(),auditLogs:()=>auditLogs.slice(),reset(){},dispose,
   async generate(messages,{tools=[],signal,maxTokens=s.smoke_max_new_tokens,onText=()=>{},onThinking=()=>{},generation=s}={}){
    if(disposed)throw Error('Model was unloaded');
    if(generation!==s)throw Error('Compatible text generation uses the frozen model settings.');
    signal??=new AbortController().signal;
    if(!Number.isInteger(maxTokens)||maxTokens<1||maxTokens>256)throw Error('Compatible text output must fit within256 tokens.');
    const calls=[];let text='',reasoning='',finish=null,usage={},timings={},first=null,firstRaw=null;
    const started=performance.now();
    signal.throwIfAborted();
    const before={...auditTotals};
    try {await abortableGeneration(()=>raw.createChatCompletion({messages:nativeMessages(messages),tools,tool_choice:tools.length?'auto':'none',stream:true,
     ...samplingOptions(generation,'wllama'),max_tokens:maxTokens,cache_prompt:false,
     chat_template_kwargs:{enable_thinking:false},abortSignal:signal,
     onData(chunk){const delta=chunk.choices?.[0]?.delta;
      if(delta?.content){firstRaw??=performance.now();text+=delta.content;if(!lfm3){first??=firstRaw;onText(delta.content);}}
      if(delta?.reasoning_content){reasoning+=delta.reasoning_content;if(!lfm3)onThinking(delta.reasoning_content);}
      mergeToolDeltas(calls,delta?.tool_calls);finish=chunk.choices?.[0]?.finish_reason||finish;
      usage=chunk.usage||usage;timings=chunk.timings||timings;
     }}),signal,async()=>{this.invalidated=true;await dispose();});}
    finally {if(signal.aborted){this.invalidated=true;await dispose();}}
    const delta={cpu_compute_ops:auditTotals.cpu_compute_ops-before.cpu_compute_ops,gpu_compute_ops:auditTotals.gpu_compute_ops-before.gpu_compute_ops};
    if(!signal.aborted&&(delta.cpu_compute_ops!==0||delta.gpu_compute_ops<=0))throw Error('This completion did not prove current-turn GPU model work.');
    const placement={...requireGpuPlacement(allLogs()),current_turn:delta};
    const rawLfm3=lfm3?{content:text,reasoning_content:reasoning}:null;
    if(lfm3){
     const parsed=splitLFM3Reasoning(text,reasoning);text=parsed.text;reasoning=parsed.reasoning;
     try {
      if(!signal.aborted&&reasoning)onThinking(reasoning);
      if(!signal.aborted&&text){first??=performance.now();onText(text);}
     } finally {if(signal.aborted){this.invalidated=true;await dispose();}}
    }
    return {message:{role:'assistant',content:text,...(reasoning?{reasoning_content:reasoning}:{}),
      ...(calls.length?{tool_calls:calls.filter(Boolean)}:{})},finish_reason:signal?.aborted?'cancelled':finish,
     ...(lfm3?{raw_lfm3:rawLfm3}:{}),
     usage,timings:{...timings,browser_first_text_ms:first===null?null:first-started},
     wall_ms:performance.now()-started,audit_totals:{...auditTotals},native_settings:{...samplingOptions(generation,'wllama'),
      enable_thinking:false,cache_prompt:false},placement};
   }};
 }catch(error){error.native_logs=allLogs();error.placement=inspectPlacement(allLogs());await dispose().catch(()=>{});throw error;}
}
