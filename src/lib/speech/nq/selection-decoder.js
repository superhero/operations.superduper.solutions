// Copyright (C) 2026 Erik Landvall
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and LICENSE-ADDITIONAL-TERMS.
// Adapted from llm-sds-01; continuous-sources.json preserves source provenance.
import {ResidentDecoder} from './resident-decoder.js';
const argmax=(values,start,end)=>{let best=-Infinity,index=0;for(let i=start;i<end;i++)if(values[i]>best){best=values[i];index=i-start;}return index;};
export class SelectionDecoder extends ResidentDecoder {
  constructor(session,ort,device){
    super(session,ort,device);
    const make=(name,bytes,usage)=>{const buffer=device.createBuffer({label:'selection/'+name,size:bytes,usage});this.buffers.push(buffer);return buffer;};
    this.selectionBuffer=make('compact-ids',16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
    this.selectionReadback=make('fresh-id-readback',16,GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST);
    this.selectionConstants=make('runtime-infinity-bits',16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);device.queue.writeBuffer(this.selectionConstants,0,Uint32Array.of(0xff800000,0,0,0));
    this.snapshotH=make('validation-final-h',5120,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);this.snapshotC=make('validation-final-c',5120,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
    const module=device.createShaderModule({label:'selection/first-index-token-duration',code:`
      @group(0) @binding(0) var<storage,read> logits: array<f32>;
      @group(0) @binding(1) var<storage,read_write> result: array<u32>;
      @group(0) @binding(2) var<uniform> constants: vec4<u32>;
      var<workgroup> values: array<f32,256>;var<workgroup> indices: array<u32,256>;
      @compute @workgroup_size(256) fn main(@builtin(local_invocation_index) lane:u32){
        var value=bitcast<f32>(constants.x);var index=0u;
        for(var i=lane;i<8193u;i+=256u){if(logits[i]>value){value=logits[i];index=i;}}
        values[lane]=value;indices[lane]=index;workgroupBarrier();
        for(var stride=128u;stride>0u;stride/=2u){
          if(lane<stride){let rhs=lane+stride;if(values[rhs]>values[lane]||(values[rhs]==values[lane]&&indices[rhs]<indices[lane])){values[lane]=values[rhs];indices[lane]=indices[rhs];}}
          workgroupBarrier();
        }
        if(lane==0u){
          var duration=0u;var best=bitcast<f32>(constants.x);
          for(var i=0u;i<5u;i++){if(logits[8193u+i]>best){best=logits[8193u+i];duration=i;}}
          result[0]=indices[0];result[1]=duration;result[2]=bitcast<u32>(values[0]);result[3]=0u;
        }
      }`});
    this.selectionModule=module;this.selectionPipeline=device.createComputePipeline({label:'selection/first-index-token-duration',layout:'auto',compute:{module,entryPoint:'main'}});
    this.snapshotEnabled=false;
  }
  resetState(h,c){super.resetState(h,c);this.stepTrace=[];Object.assign(this.counters,{selection_cpu_readback_bytes:0,selection_map_calls:0,selection_dispatches:0,diagnostic_logits_readback_bytes:0,validation_final_state_copy_bytes:0});}
  selectFrame(frame){this.currentFrame=frame;super.selectFrame(frame);}
  reduce(logitsBuffer){
    const group=this.device.createBindGroup({layout:this.selectionPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:logitsBuffer}},{binding:1,resource:{buffer:this.selectionBuffer}},{binding:2,resource:{buffer:this.selectionConstants}}]});
    const commands=this.device.createCommandEncoder();const pass=commands.beginComputePass();pass.setPipeline(this.selectionPipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();this.device.queue.submit([commands.finish()]);this.counters.selection_dispatches++;
  }
  async readSelection(){
    const commands=this.device.createCommandEncoder();commands.copyBufferToBuffer(this.selectionBuffer,0,this.selectionReadback,0,16);this.device.queue.submit([commands.finish()]);
    this.counters.selection_map_calls++;await this.selectionReadback.mapAsync(GPUMapMode.READ);const bytes=this.selectionReadback.getMappedRange();const u=new Uint32Array(bytes.slice(0)),f=new Float32Array(bytes.slice(0));this.selectionReadback.unmap();this.counters.selection_cpu_readback_bytes+=16;
    return {token:u[0],duration:u[1],maxLogit:f[2]};
  }
  async execute(feeds,validation=false){
    if(feeds.encoder_outputs!==this.frameTensor)throw Error('Selection decoder needs resident GPU frame');
    this.adoptStatePair(feeds.input_states_1,feeds.input_states_2);this.device.queue.writeBuffer(this.input.targets.buffer,0,feeds.targets.data);this.counters.control_upload_bytes+=4;
    const output=await this.session.run(Object.fromEntries(Object.entries(this.input).map(([name,slot])=>[name,slot.tensor])));this.counters.decoder_calls++;
    if(output.outputs.location!=='gpu-buffer')throw Error('Selection logits fell off GPU');this.reduce(output.outputs.gpuBuffer);const selection=await this.readSelection();
    this.stepTrace.push({frame:this.currentFrame,token:selection.token,duration:selection.duration});
    let logits;
    if(validation){
      const commands=this.device.createCommandEncoder();commands.copyBufferToBuffer(output.outputs.gpuBuffer,0,this.logitsReadback,0,32792);this.device.queue.submit([commands.finish()]);await this.logitsReadback.mapAsync(GPUMapMode.READ);logits=new Float32Array(this.logitsReadback.getMappedRange().slice(0,32792));this.logitsReadback.unmap();this.counters.diagnostic_logits_readback_bytes+=32792;
      if(selection.token!==argmax(logits,0,8193)||selection.duration!==argmax(logits,8193,8198))throw Error('GPU selection differs from original strict first-index argmax');
    }
    output.outputs.dispose();return {selection,...(validation?{outputs:new this.ort.Tensor('float32',logits,[1,1,1,8198])}:{}),output_states_1:this.manageState(output.output_states_1),output_states_2:this.manageState(output.output_states_2)};
  }
  async run(feeds){return this.execute(feeds,false);}
  async runValidation(feeds){return this.execute(feeds,true);}
  retainFinalState(state){
    if(!this.snapshotEnabled)return;
    const h=state?.state1?.location==='gpu-buffer'?state.state1.gpuBuffer:this.input.input_states_1.buffer,c=state?.state2?.location==='gpu-buffer'?state.state2.gpuBuffer:this.input.input_states_2.buffer;
    const commands=this.device.createCommandEncoder();commands.copyBufferToBuffer(h,0,this.snapshotH,0,5120);commands.copyBufferToBuffer(c,0,this.snapshotC,0,5120);this.device.queue.submit([commands.finish()]);this.counters.validation_final_state_copy_bytes+=10240;
  }
  async readFinalState(){return this.readStates({gpuBuffer:this.snapshotH},{gpuBuffer:this.snapshotC});}
  async validateArgmax(){
    const compilation=await this.selectionModule.getCompilationInfo();const errors=compilation.messages.filter(message=>message.type==='error');if(errors.length)throw Error('GPU selection shader failed: '+errors[0].message);
    const fixture=this.device.createBuffer({label:'selection/untimed-adversarial-logits',size:32800,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});const cases=[];
    const specs=[{name:'first index tie across lanes',tokens:[[17,4],[273,4]],durations:[[0,2]]},{name:'blank ties earlier nonblank',tokens:[[8191,6],[8192,6]],durations:[[0,1],[4,1]]},{name:'blank and duration zero',tokens:[[8192,8]],durations:[[0,3]]},{name:'positive duration',tokens:[[5,2]],durations:[[4,7]]},{name:'signed zero first index',tokens:[[0,-0],[1,0]],durations:[[0,0],[1,0]]}];
    for(const spec of specs){const values=new Float32Array(8198).fill(-1000);for(const [i,v] of spec.tokens)values[i]=v;for(const [i,v] of spec.durations)values[8193+i]=v;this.device.queue.writeBuffer(fixture,0,values);this.reduce(fixture);const actual=await this.readSelection(),expected={token:argmax(values,0,8193),duration:argmax(values,8193,8198)};if(actual.token!==expected.token||actual.duration!==expected.duration)throw Error('Adversarial GPU argmax mismatch: '+spec.name);cases.push({name:spec.name,actual,expected});}
    fixture.destroy();return cases;
  }
}
