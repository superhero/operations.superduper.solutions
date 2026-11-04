// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Adapted from llm-sds-01; continuous-sources.json preserves source provenance.
import {SelectionDecoder} from './selection-decoder.js';
export class GroupedDecoder extends SelectionDecoder {
  constructor(session,ort,device){
    super(session,ort,device);this.groupSize=4;this.pending=[];
    const make=(name,bytes,usage)=>{const b=device.createBuffer({label:'grouped/'+name,size:bytes,usage});this.buffers.push(b);return b;};
    this.control=make('gpu-loop-state',32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
    this.records=make('bounded-step-log',750*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
    this.statusReadback=make('group-status-readback',32,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    this.recordsReadback=make('final-step-log-readback',750*16,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    const gather=device.createShaderModule({label:'grouped/gpu-controlled-frame',code:`
      @group(0) @binding(0) var<storage,read> encoded:array<f32>;
      @group(0) @binding(1) var<storage,read_write> frame:array<f32>;
      @group(0) @binding(2) var<uniform> params:vec4<u32>;
      @group(0) @binding(3) var<storage,read> state:array<u32>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
        let d=id.x;if(d<params.z&&state[3]==0u&&state[0]<params.y){frame[d]=encoded[d*params.y+state[0]];}
      }`});
    this.groupGather=device.createComputePipeline({label:'grouped/gpu-controlled-frame',layout:'auto',compute:{module:gather,entryPoint:'main'}});
    const commit=device.createShaderModule({label:'grouped/blank-state-frame-control',code:`
      @group(0) @binding(0) var<storage,read> selection:array<u32>;
      @group(0) @binding(1) var<storage,read_write> state:array<u32>;
      @group(0) @binding(2) var<storage,read_write> records:array<u32>;
      @group(0) @binding(3) var<storage,read_write> input_h:array<f32>;
      @group(0) @binding(4) var<storage,read_write> input_c:array<f32>;
      @group(0) @binding(5) var<storage,read> output_h:array<f32>;
      @group(0) @binding(6) var<storage,read> output_c:array<f32>;
      @group(0) @binding(7) var<storage,read_write> next_token:array<i32>;
      @group(0) @binding(8) var<uniform> params:vec4<u32>;
      @compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane:u32){
        let is_live=state[3]==0u;let token=selection[0];let duration=selection[1];
        // Commit the final active nonblank BEFORE frame advance/done. Padded calls never touch H/C.
        if(is_live&&token!=8192u){for(var i=lane;i<1280u;i+=256u){input_h[i]=output_h[i];input_c[i]=output_c[i];}}
        storageBarrier();
        if(lane==0u){
          state[7]+=1u;if(!is_live){return;}
          let count=state[4];if(count>=750u){state[5]=1u;state[3]=1u;return;}
          records[count*4u]=token;records[count*4u+1u]=duration;records[count*4u+2u]=state[0];records[count*4u+3u]=state[2];
          state[4]+=1u;
          if(token!=8192u){state[1]=token;state[2]+=1u;state[6]+=1u;next_token[0]=i32(token);}
          if(duration>0u){state[0]+=duration;state[2]=0u;}
          else if(token==8192u||state[2]>=10u){state[0]+=1u;state[2]=0u;}
          if(state[0]>=params.y){state[3]=1u;}
        }
      }`});
    this.commitModule=commit;this.commitPipeline=device.createComputePipeline({label:'grouped/blank-state-frame-control',layout:'auto',compute:{module:commit,entryPoint:'main'}});this.resetState();
  }
  resetState(h,c){
    super.resetState(h,c);Object.assign(this.counters,{group_status_map_calls:0,group_status_cpu_readback_bytes:0,final_log_map_calls:0,final_log_cpu_readback_bytes:0,submitted_steps:0,active_steps:0,padded_steps:0,control_dispatches:0,group_completion_waits:[]});
    if(this.control){this.device.queue.writeBuffer(this.control,0,Uint32Array.of(0,8192,0,0,0,0,0,0));this.device.queue.writeBuffer(this.input.targets.buffer,0,Int32Array.of(8192));this.counters.control_upload_bytes+=36;}
  }
  bindEncoder(tensor){
    super.bindEncoder(tensor);this.device.queue.writeBuffer(this.uniform,0,Uint32Array.of(0,this.frames,1024,750));this.counters.control_upload_bytes+=16;
    this.groupBind=this.device.createBindGroup({layout:this.groupGather.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:tensor.gpuBuffer}},{binding:1,resource:{buffer:this.input.encoder_outputs.buffer}},{binding:2,resource:{buffer:this.uniform}},{binding:3,resource:{buffer:this.control}}]});
  }
  dispatchCommit(h,c){
    const buffers=[this.selectionBuffer,this.control,this.records,this.input.input_states_1.buffer,this.input.input_states_2.buffer,h,c,this.input.targets.buffer,this.uniform];
    const bind=this.device.createBindGroup({layout:this.commitPipeline.getBindGroupLayout(0),entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
    const commands=this.device.createCommandEncoder(),pass=commands.beginComputePass();pass.setPipeline(this.commitPipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(1);pass.end();this.device.queue.submit([commands.finish()]);this.counters.control_dispatches++;
  }
  async submitStep(){
    const commands=this.device.createCommandEncoder(),pass=commands.beginComputePass();pass.setPipeline(this.groupGather);pass.setBindGroup(0,this.groupBind);pass.dispatchWorkgroups(16);pass.end();this.device.queue.submit([commands.finish()]);this.counters.frame_gather_dispatches++;
    const output=await this.session.run(Object.fromEntries(Object.entries(this.input).map(([name,slot])=>[name,slot.tensor])));this.counters.decoder_calls++;this.counters.submitted_steps++;
    for(const tensor of Object.values(output))if(tensor.location!=='gpu-buffer')throw Error('Grouped decoder output fell off GPU');
    this.reduce(output.outputs.gpuBuffer);this.dispatchCommit(output.output_states_1.gpuBuffer,output.output_states_2.gpuBuffer);this.pending.push(output);
  }
  async readStatus(){
    const commands=this.device.createCommandEncoder();commands.copyBufferToBuffer(this.control,0,this.statusReadback,0,32);this.device.queue.submit([commands.finish()]);
    this.counters.group_status_map_calls++;await this.statusReadback.mapAsync(GPUMapMode.READ);const data=new Uint32Array(this.statusReadback.getMappedRange().slice(0));this.statusReadback.unmap();this.counters.group_status_cpu_readback_bytes+=32;
    return {frame:data[0],target:data[1],emitted_at_frame:data[2],done:data[3],active:data[4],error:data[5],tokens:data[6],submitted:data[7]};
  }
  async readRecords(count){
    const bytes=count*16;if(!bytes)return[];const commands=this.device.createCommandEncoder();commands.copyBufferToBuffer(this.records,0,this.recordsReadback,0,bytes);this.device.queue.submit([commands.finish()]);
    this.counters.final_log_map_calls++;await this.recordsReadback.mapAsync(GPUMapMode.READ,0,bytes);const data=new Uint32Array(this.recordsReadback.getMappedRange(0,bytes).slice(0));this.recordsReadback.unmap();this.counters.final_log_cpu_readback_bytes+=bytes;
    return Array.from({length:count},(_,i)=>({token:data[4*i],duration:data[4*i+1],frame:data[4*i+2],emitted_before:data[4*i+3]}));
  }
  async runGrouped(){
    const maxGroups=Math.ceil(this.frames*10/this.groupSize);
    for(let group=0;group<maxGroups;group++){
      for(let i=0;i<this.groupSize;i++)await this.submitStep();
      const status=await this.readStatus();this.counters.group_completion_waits.push({after_submitted:status.submitted,active_steps:status.active,done:!!status.done});
      // Keep output buffers alive through the group. Status readback completes their dependent GPU work.
      for(const output of this.pending)for(const tensor of Object.values(output))tensor.dispose();this.pending=[];
      if(status.error)throw Error('Bounded GPU control overflow');
      if(status.done){
        if(status.active>this.frames*10||status.submitted!==this.counters.submitted_steps)throw Error('GPU grouped control bounds differ');
        this.counters.active_steps=status.active;this.counters.padded_steps=status.submitted-status.active;this.counters.recurrent_state_device_copy_bytes=status.tokens*10240;
        const records=await this.readRecords(status.active);this.stepTrace=records.map(({frame,token,duration})=>({frame,token,duration}));return {records,status};
      }
    }
    throw Error('GPU grouped loop exceeded semantic frame*10 bound');
  }
  retainFinalState(){super.retainFinalState({state1:{location:'gpu-buffer',gpuBuffer:this.input.input_states_1.buffer},state2:{location:'gpu-buffer',gpuBuffer:this.input.input_states_2.buffer}});}
  async validateControl(){
    const info=await this.commitModule.getCompilationInfo();const errors=info.messages.filter(x=>x.type==='error');if(errors.length)throw Error('GPU control shader failed: '+errors[0].message);
    const candidateH=this.device.createBuffer({label:'grouped/untimed-candidate-h',size:5120,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),candidateC=this.device.createBuffer({label:'grouped/untimed-candidate-c',size:5120,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});const tests=[];
    const setup=frames=>{const buffer=this.device.createBuffer({label:'grouped/untimed-dummy-encoder',size:1024*frames*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});this.bindEncoder(this.ort.Tensor.fromGpuBuffer(buffer,{dataType:'float32',dims:[1,1024,frames]}));return buffer;};
    const execute=(token,duration,value)=>{this.device.queue.writeBuffer(this.selectionBuffer,0,Uint32Array.of(token,duration,0,0));this.device.queue.writeBuffer(candidateH,0,new Float32Array(1280).fill(value));this.device.queue.writeBuffer(candidateC,0,new Float32Array(1280).fill(-value));this.dispatchCommit(candidateH,candidateC);};
    let bank=setup(5);const sequence=[[8192,0,1,1,0],[17,0,2,1,2],[18,2,3,3,3],[19,4,4,7,4],[99,0,99,7,4]];
    for(let i=0;i<sequence.length;i++){
      const [token,duration,value,frame,stateValue]=sequence[i];execute(token,duration,value);const status=await this.readStatus(),states=await this.readStates();
      if(status.frame!==frame||states[0].some(x=>x!==stateValue)||states[1].some(x=>x!==-stateValue)||status.active!==Math.min(i+1,4))throw Error('GPU blank/final/padded state control fixture failed');
      tests.push({case:['blank duration0 retains','nonblank duration0 commits','positive duration advances','final active nonblank commits before done','padded step cannot mutate final state'][i],status,state_value:stateValue,passed:true});
    }
    this.releaseEncoder();bank.destroy();bank=setup(1);
    for(let i=0;i<10;i++)execute(20+i,0,i+1);execute(99,0,99);execute(100,0,100);
    const status=await this.readStatus(),states=await this.readStates();if(status.active!==10||status.submitted!==12||status.frame!==1||!status.done||states[0].some(x=>x!==10)||states[1].some(x=>x!==-10))throw Error('GPU maxTokensPerStep10/final-padding fixture failed');
    tests.push({case:'max10 then padded no-ops',status,state_value:10,passed:true});this.releaseEncoder();bank.destroy();candidateH.destroy();candidateC.destroy();return tests;
  }
  async release(){for(const output of this.pending)for(const tensor of Object.values(output))tensor.dispose();this.pending=[];await super.release();}
}
