export function inspectPlacement(logs){
 const text=logs.join('\n'),offload=text.match(/offloaded (\d+)\/(\d+) layers to GPU/);
 const audits=[...text.matchAll(/GPU_ONLY_AUDIT cpu_compute_ops=(\d+) gpu_compute_ops=(\d+)/g)]
  .map(match=>({cpu_compute_ops:Number(match[1]),gpu_compute_ops:Number(match[2])}));
 return {device_without_f16:text.includes('FP32_COMPAT device shader_f16=0'),
  gpu_matrix_pipeline:/FP32_COMPAT pipeline mul_mat/i.test(text),
  all_layers_offloaded:!!offload&&offload[1]===offload[2]&&Number(offload[1])>0,
  model_gpu_only:text.includes('GPU_ONLY_MODEL input=GPU no_cpu_weight_fallback=1'),
  layers:offload?{gpu:Number(offload[1]),total:Number(offload[2])}:null,
  audits,cpu_compute_ops:audits.reduce((sum,row)=>sum+row.cpu_compute_ops,0),
  gpu_compute_ops:audits.reduce((sum,row)=>sum+row.gpu_compute_ops,0),
  cpu_op_lines:logs.filter(line=>line.includes('GPU_ONLY_CPU_OP')),
  cpu_graph_lines:logs.filter(line=>!line.includes('GPU_ONLY_AUDIT')&&/CPU.*(?:compute|graph|model buffer)|(?:compute|graph|model buffer).*CPU/i.test(line))};
}

export function requireGpuPlacement(logs,{requireCompute=true}={}){
 const placement=inspectPlacement(logs);
 if(placement.cpu_compute_ops||placement.cpu_op_lines.length)throw Error('Native audit observed CPU model computation');
 if(!placement.device_without_f16||!placement.all_layers_offloaded||!placement.model_gpu_only)
  throw Error('Native GPU device/full-layer/input-embedding placement was not proved');
 if(requireCompute&&(!placement.audits.length||!placement.gpu_compute_ops||!placement.gpu_matrix_pipeline))
  throw Error('Actual GPU model computation was not proved');
 return placement;
}
