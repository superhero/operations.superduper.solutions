// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Adapted from llm-sds-01; continuous-sources.json preserves source provenance.
// Uncaptured GPU transport. Upstream Parakeet decides whether to keep each state.
export class ResidentDecoder {
  constructor(session,ort,device){
    this.session=session;this.ort=ort;this.device=device;this.buffers=[];this.liveStates=new Set();this.input={};
    const make=(name,type,dims,bytes)=>{
      const buffer=device.createBuffer({label:'resident/'+name,size:Math.ceil(bytes/16)*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
      const tensor=ort.Tensor.fromGpuBuffer(buffer,{dataType:type,dims});this.input[name]={buffer,tensor,bytes};this.buffers.push(buffer);return tensor;
    };
    this.frameTensor=make('encoder_outputs','float32',[1,1024,1],4096);make('targets','int32',[1,1],4);make('input_states_1','float32',[2,1,640],5120);make('input_states_2','float32',[2,1,640],5120);
    this.uniform=device.createBuffer({label:'resident/frame-control',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.buffers.push(this.uniform);
    this.logitsReadback=device.createBuffer({label:'resident/logits-readback',size:32800,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});this.buffers.push(this.logitsReadback);
    this.stateReadback=device.createBuffer({label:'resident/validation-only-state-readback',size:10240,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});this.buffers.push(this.stateReadback);
    const module=device.createShaderModule({label:'resident/layout-only-frame-gather',code:`
      @group(0) @binding(0) var<storage,read> encoded: array<f32>;
      @group(0) @binding(1) var<storage,read_write> frame: array<f32>;
      @group(0) @binding(2) var<uniform> control: vec4<u32>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3<u32>){
        let d=id.x;if(d<control.z){frame[d]=encoded[d*control.y+control.x];}
      }`});
    this.pipeline=device.createComputePipeline({label:'resident/layout-only-frame-gather',layout:'auto',compute:{module,entryPoint:'main'}});
    this.resetState();
  }
  resetState(h=new Float32Array(1280),c=new Float32Array(1280)){
    this.initial={input_states_1:h.slice(),input_states_2:c.slice()};this.lastState={};this.initialCpu={};
    this.counters={encoder_output_cpu_readback_bytes:0,encoder_frame_cpu_upload_bytes:0,recurrent_state_cpu_readback_bytes:0,recurrent_state_initial_upload_bytes:10240,recurrent_state_device_copy_bytes:0,control_upload_bytes:0,logits_cpu_readback_bytes:0,frame_gather_dispatches:0,decoder_calls:0,validation_state_readback_bytes:0};
    for(const name of ['input_states_1','input_states_2'])this.device.queue.writeBuffer(this.input[name].buffer,0,this.initial[name]);
  }
  bindEncoder(tensor){
    if(this.encoded)throw Error('Previous resident encoder still retained');
    if(tensor.location!=='gpu-buffer'||tensor.dims.length!==3||tensor.dims[0]!==1||tensor.dims[1]!==1024)throw Error('Resident encoder shape/location differs');
    this.encoded=tensor;this.frames=tensor.dims[2];this.resetState();this.counters.encoder_output_retained_gpu_bytes=1024*this.frames*4;
    this.bindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:tensor.gpuBuffer}},{binding:1,resource:{buffer:this.input.encoder_outputs.buffer}},{binding:2,resource:{buffer:this.uniform}}]});
  }
  selectFrame(frame){
    if(!this.encoded||!Number.isInteger(frame)||frame<0||frame>=this.frames)throw Error('Resident frame is out of range');
    this.device.queue.writeBuffer(this.uniform,0,Uint32Array.of(frame,this.frames,1024,0));this.counters.control_upload_bytes+=16;
    const encoder=this.device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);pass.dispatchWorkgroups(16);pass.end();this.device.queue.submit([encoder.finish()]);this.counters.frame_gather_dispatches++;
  }
  adoptStatePair(h,c){
    let commands;
    for(const [name,value] of [['input_states_1',h],['input_states_2',c]]){
      if(!value||value.dims.join(',')!=='2,1,640')throw Error('Resident state shape differs');
      if(value.location==='gpu-buffer'){
        if(this.lastState[name]!==value&&value.gpuBuffer!==this.input[name].buffer){commands||=this.device.createCommandEncoder();commands.copyBufferToBuffer(value.gpuBuffer,0,this.input[name].buffer,0,5120);this.counters.recurrent_state_device_copy_bytes+=5120;}
        this.lastState[name]=value;
      }else{
        if(this.lastState[name])throw Error('Unexpected CPU recurrent state after GPU commitment');
        if(this.initialCpu[name]!==value){const data=value.data,expected=this.initial[name];if(data.length!==1280||data.some((x,i)=>x!==expected[i]))throw Error('Resident initial CPU state differs');this.initialCpu[name]=value;}
      }
    }
    if(commands)this.device.queue.submit([commands.finish()]);
  }
  manageState(tensor){
    if(tensor.location!=='gpu-buffer')throw Error('Resident recurrent output fell off GPU');
    this.liveStates.add(tensor);const dispose=tensor.dispose.bind(tensor);let disposed=false;
    tensor.dispose=()=>{if(disposed)return;disposed=true;this.liveStates.delete(tensor);dispose();};return tensor;
  }
  async run(feeds){
    if(feeds.encoder_outputs!==this.frameTensor)throw Error('Resident decoder did not receive its GPU frame');
    this.adoptStatePair(feeds.input_states_1,feeds.input_states_2);
    this.device.queue.writeBuffer(this.input.targets.buffer,0,feeds.targets.data);this.counters.control_upload_bytes+=4;
    const neural=Object.fromEntries(Object.entries(this.input).map(([name,slot])=>[name,slot.tensor]));
    const output=await this.session.run(neural);this.counters.decoder_calls++;
    if(output.outputs.location!=='gpu-buffer')throw Error('Resident logits fell off GPU');
    const encoder=this.device.createCommandEncoder();encoder.copyBufferToBuffer(output.outputs.gpuBuffer,0,this.logitsReadback,0,32792);this.device.queue.submit([encoder.finish()]);
    await this.logitsReadback.mapAsync(GPUMapMode.READ);const logits=new Float32Array(this.logitsReadback.getMappedRange().slice(0,32792));this.logitsReadback.unmap();this.counters.logits_cpu_readback_bytes+=32792;output.outputs.dispose();
    return {outputs:new this.ort.Tensor('float32',logits,[1,1,1,8198]),output_states_1:this.manageState(output.output_states_1),output_states_2:this.manageState(output.output_states_2)};
  }
  async readStates(h=this.input.input_states_1.tensor,c=this.input.input_states_2.tensor){
    const encoder=this.device.createCommandEncoder();encoder.copyBufferToBuffer(h.gpuBuffer,0,this.stateReadback,0,5120);encoder.copyBufferToBuffer(c.gpuBuffer,0,this.stateReadback,5120,5120);this.device.queue.submit([encoder.finish()]);
    await this.stateReadback.mapAsync(GPUMapMode.READ);const bytes=this.stateReadback.getMappedRange();const result=[new Float32Array(bytes.slice(0,5120)),new Float32Array(bytes.slice(5120,10240))];this.stateReadback.unmap();this.counters.validation_state_readback_bytes+=10240;return result;
  }
  releaseEncoder(){if(this.encoded){this.encoded.dispose();this.encoded=null;this.bindGroup=null;}}
  async release(){this.releaseEncoder();for(const tensor of [...this.liveStates])tensor.dispose();await this.session.release();for(const slot of Object.values(this.input))slot.tensor.dispose();for(const buffer of this.buffers)buffer.destroy();}
}
