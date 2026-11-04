// Local compatibility graph. Original INT8 initializers are retained byte-for-byte;
// dynamic activation quantization is replaced by FP32 GPU arithmetic.
const fs=require('node:fs'), crypto=require('node:crypto');
const {onnx}=require('./onnx.cjs');
const source=process.argv[2]||'/work/decoder.int8.onnx';
const target=process.argv[3]||'/work/artifacts/decoder-single-step.int8-fp32.onnx';
const bytes=fs.readFileSync(source), sha=crypto.createHash('sha256').update(bytes).digest('hex');
if(sha!=='eea7483ee3d1a30375daedc8ed83e3960c91b098812127a0d99d1c8977667a70')throw Error('Unexpected source decoder');
const model=onnx.ModelProto.decode(bytes), graph=model.graph;
const originalPins=graph.initializer.map(t=>({name:t.name,sha256:crypto.createHash('sha256').update(onnx.TensorProto.encode(t).finish()).digest('hex')}));
const nodes=[], constants=[];
function n(op,inputs,outputs,attrs=[]){nodes.push(onnx.NodeProto.create({name:'gpu/'+outputs[0],opType:op,input:inputs,output:outputs,attribute:attrs}));return outputs[0]}
const ai=(name,value)=>onnx.AttributeProto.create({name,type:2,i:value});
const ais=(name,value)=>onnx.AttributeProto.create({name,type:7,ints:value});
function ints(name,values){constants.push(onnx.TensorProto.create({name,dataType:7,dims:[values.length],int64Data:values}));return name;}
function reshape(input,name,shape){return n('Reshape',[input,ints(name+'/shape',shape)],[name]);}
function dequant(name,axis){return n('DequantizeLinear',[name+'_quantized',name+'_scale',name+'_zero_point'],[name+'/fp32'],axis===undefined?[]:[ai('axis',axis)]);}
function matmul(input,weight,name){return n('MatMul',[input,weight],[name]);}
const emb=dequant('decoder.prediction.embed.weight');
const embedded=n('Gather',[emb,'targets'],['token_embedding'],[ai('axis',0)]);
let x=reshape(embedded,'layer_input',[1,640]);
const hs=[],cs=[];
for(let layer=0;layer<2;layer++){
 const prefix='lstm'+layer;
 const wi=layer===0?'onnx::LSTM_205':'onnx::LSTM_225';
 const ri=layer===0?'onnx::LSTM_206':'onnx::LSTM_226';
 const bi=layer===0?'onnx::LSTM_207':'onnx::LSTM_227';
 const w=reshape(dequant(wi,0),prefix+'/W',[640,2560]);
 const r=reshape(dequant(ri,0),prefix+'/R',[640,2560]);
 const h0=reshape(n('Gather',['input_states_1',ints(prefix+'/index',[layer])],[prefix+'/h_slice'],[ai('axis',0)]),prefix+'/h0',[1,640]);
 const c0=reshape(n('Gather',['input_states_2',prefix+'/index'],[prefix+'/c_slice'],[ai('axis',0)]),prefix+'/c0',[1,640]);
 const b0=prefix+'/b0',b1=prefix+'/b1';
 n('Split',[bi,ints(prefix+'/bias_split',[2560,2560])],[b0,b1],[ai('axis',1)]);
 const gates=n('Add',[n('Add',[matmul(x,w,prefix+'/xW'),matmul(h0,r,prefix+'/hR')],[prefix+'/sum']),n('Add',[b0,b1],[prefix+'/bias'])],[prefix+'/gates']);
 const gateNames=['i','o','f','g'].map(g=>prefix+'/'+g+'_pre');
 n('Split',[gates,ints(prefix+'/gate_split',[640,640,640,640])],gateNames,[ai('axis',1)]);
 const i=n('Sigmoid',[gateNames[0]],[prefix+'/i']),o=n('Sigmoid',[gateNames[1]],[prefix+'/o']),f=n('Sigmoid',[gateNames[2]],[prefix+'/f']),g=n('Tanh',[gateNames[3]],[prefix+'/g']);
 const c=n('Add',[n('Mul',[f,c0],[prefix+'/forget']),n('Mul',[i,g],[prefix+'/input'])],[prefix+'/c']);
 const h=n('Mul',[o,n('Tanh',[c],[prefix+'/tanh_c'])],[prefix+'/h']);
 hs.push(reshape(h,prefix+'/state_h',[1,1,640]));cs.push(reshape(c,prefix+'/state_c',[1,1,640]));x=h;
}
n('Concat',hs,['output_states_1'],[ai('axis',0)]);n('Concat',cs,['output_states_2'],[ai('axis',0)]);
const enc=reshape('encoder_outputs','encoder_frame',[1,1024]);
const encProj=n('Add',[matmul(enc,dequant('onnx::MatMul_228'),'encoder_projection'),'joint.enc.bias'],['encoder_biased']);
const predProj=n('Add',[matmul(x,dequant('onnx::MatMul_229'),'prediction_projection'),'joint.pred.bias'],['prediction_biased']);
const joint=n('Relu',[n('Add',[encProj,predProj],['joint_sum'])],['joint_relu']);
const logits=n('Add',[matmul(joint,dequant('onnx::MatMul_230'),'logits_matmul'),'joint.joint_net.2.bias'],['logits_flat']);
reshape(logits,'outputs',[1,1,1,8198]);
function vi(name,dtype,dims){return onnx.ValueInfoProto.create({name,type:{tensorType:{elemType:dtype,shape:{dim:dims.map(dimValue=>({dimValue}))}}}})}
graph.node=nodes;graph.name='parakeet-v3-fixed-single-step-int8-storage-fp32-gpu';graph.docString='Local compatibility graph: original INT8 initializers, FP32 activation arithmetic; batch=1, target_length=1 only. Not an official export or bit-identical dynamic-INT8 inference.';
graph.initializer.push(...constants);graph.valueInfo=[];
graph.input=[vi('encoder_outputs',1,[1,1024,1]),vi('targets',6,[1,1]),vi('input_states_1',1,[2,1,640]),vi('input_states_2',1,[2,1,640])];
graph.output=[vi('outputs',1,[1,1,1,8198]),vi('output_states_1',1,[2,1,640]),vi('output_states_2',1,[2,1,640])];
model.opsetImport=[onnx.OperatorSetIdProto.create({domain:'',version:17})];
for(const pin of originalPins){const t=graph.initializer.find(t=>t.name===pin.name);if(crypto.createHash('sha256').update(onnx.TensorProto.encode(t).finish()).digest('hex')!==pin.sha256)throw Error('Initializer changed: '+pin.name);}
const output=onnx.ModelProto.encode(model).finish();fs.mkdirSync(require('path').dirname(target),{recursive:true});fs.writeFileSync(target,output);
const receipt={source_sha256:sha,output_sha256:crypto.createHash('sha256').update(output).digest('hex'),source_bytes:bytes.length,output_bytes:output.length,stored_weights:'Original UINT8/INT8 and FP32 initializer encodings unchanged',activation_math:'FP32; original dynamic activation quantization omitted',all_original_initializer_sha256:originalPins,nodes:graph.node.length,ops:[...new Set(graph.node.map(n=>n.opType))],constraints:{batch:1,frames:1,tokens:1,layers:2,hidden:640},not_official:true,model_inference_executed:false};
fs.writeFileSync(target+'.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
