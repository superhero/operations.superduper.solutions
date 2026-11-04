// NR adapts only the GPU control log allocation/bound to actual encoder Tenc.
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const original=await readFile(new URL('./grouped-decoder.js',import.meta.url),'utf8');let source=original;
source=source.replace("from './selection-decoder.js'","from '../selection-decoder.js'").replace('export class GroupedDecoder','export class VariableGroupedDecoder');
if(source.split('if(count>=750u)').length!==2)throw Error('NR GPU bound anchor differs');source=source.replace('if(count>=750u)','if(count>=params.w)');
source=source.replace("this.records=make('bounded-step-log'","this.logCapacity=750;this.records=make('bounded-step-log'");
const binding='super.bindEncoder(tensor);this.device.queue.writeBuffer(this.uniform,0,Uint32Array.of(0,this.frames,1024,750));';
if(!source.includes(binding))throw Error('NR encoder binding anchor differs');
source=source.replace(binding,'super.bindEncoder(tensor);this.ensureLogCapacity(this.frames*10);this.device.queue.writeBuffer(this.uniform,0,Uint32Array.of(0,this.frames,1024,this.frames*10));this.counters.log_capacity=this.logCapacity;this.counters.semantic_step_bound=this.frames*10;this.counters.encoded_frames=this.frames;');
source=source.replace('  bindEncoder(tensor){',`  ensureLogCapacity(required){
    if(required<=this.logCapacity)return;
    if(this.pending.length)throw Error('Cannot grow GPU log during pending work');
    const capacity=Math.max(required,this.logCapacity*2),bytes=capacity*16;
    if(bytes>this.device.limits.maxStorageBufferBindingSize||bytes>this.device.limits.maxBufferSize)throw Error('GPU control log exceeds this device buffer limits');
    const old=[this.records,this.recordsReadback];for(const buffer of old)buffer.destroy();this.buffers=this.buffers.filter(buffer=>!old.includes(buffer));
    this.records=this.device.createBuffer({label:'nr/growing-step-log',size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
    this.recordsReadback=this.device.createBuffer({label:'nr/growing-step-readback',size:bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
    this.buffers.push(this.records,this.recordsReadback);this.logCapacity=capacity;
  }
  bindEncoder(tensor){`);
await writeFile(new URL('./.runtime/variable-grouped-decoder.js',import.meta.url),source);
const attempt=new URL('../../../attempts/nr-browser-parakeet-live-gpu/',import.meta.url);await mkdir(attempt,{recursive:true});await writeFile(new URL('adapter-proof.json',attempt),JSON.stringify({source:'NQ grouped-decoder.js',nq_source_sha256:hash(original),nr_source_sha256:hash(source),patches:['GPU semantic bound=params.w=actual Tenc*10','Grow only log/readback buffers between completed windows, bounded by real device limits','No fixed6s/30s model cap; existing caller UI limits stay separate'],neural_graph_or_weights_changed:false,original_dynamic_encoder:'98a74b21b4cc0017c1e7030319a4a96f4a9506e50f0708f3a516d02a77c96bb1'},null,2)+'\n');
